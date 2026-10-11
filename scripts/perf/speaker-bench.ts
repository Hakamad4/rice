// Uso: npx tsx scripts/perf/speaker-bench.ts
// Fala 12 frases com 3 vozes (`say`), calcula embeddings com o pipeline do Rice (fbank + CAM++ no onnxruntime-node) e mede
// separação (similaridade de cosseno), acerto do clustering online, tempo e memória (footprint do processo).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelsDir } from '../../src/main/asr/config';
import { ensureModel, SPEAKER_MODEL } from '../../src/main/asr/model-download';
import { OnlineSpeakerClusterer } from '../../src/main/asr/speaker-cluster';
import { OnnxSpeakerEmbedder } from '../../src/main/asr/speaker-embedder';

const VOICES = ['Luciana', 'Eddy (Português (Brasil))', 'Daniel'];
const LINES: Array<[number, string]> = [
  [0, 'Bom dia pessoal, vamos começar a reunião de planejamento revisando as metas do trimestre.'],
  [1, 'Bom dia, eu preparei os números do orçamento e queria apresentar primeiro os custos de infraestrutura.'],
  [2, 'Thanks everyone for joining, I will share the roadmap for the new release after the budget review.'],
  [0, 'Perfeito, então podemos seguir com o orçamento e depois falar do roadmap da próxima versão.'],
  [1, 'O custo de infraestrutura subiu dez por cento, principalmente por causa do novo banco de dados.'],
  [2, 'On the roadmap side, we plan to ship the reporting module in March, but the ERP integration needs more time.'],
  [0, 'Entendi, vamos cortar a integração desse ciclo e priorizar o módulo de relatórios para os clientes.'],
  [1, 'Concordo, e eu sugiro revisar as premissas de custo até sexta para fechar o valor final.'],
  [2, 'Sounds good, I will update the plan and send it to the whole team by the end of the week.'],
  [0, 'Ótimo, alguém tem mais algum ponto antes de encerrarmos a reunião de hoje?'],
  [1, 'Só um aviso, a auditoria de segurança encontrou três pontos críticos que precisamos corrigir logo.'],
  [2, 'I can help with the security fixes, just send me the list of the critical issues after the meeting.'],
];
const footprintMb = (): number => {
  const m = /phys_footprint:\s+([\d.]+)\s+(KB|MB|GB)/.exec(execFileSync('footprint', ['-p', String(process.pid)], { encoding: 'utf8' }))!;
  return Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1));
};
const dir = mkdtempSync(join(tmpdir(), 'spk-'));
const wavs = LINES.map(([v, text], i) => {
  const base = join(dir, `${i}`);
  execFileSync('say', ['-v', VOICES[v]!, '-o', `${base}.aiff`, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', `${base}.aiff`, `${base}.wav`]);
  return readFileSync(`${base}.wav`).subarray(44);
});
const truth = LINES.map(([v]) => v);
const cos = (a: ArrayLike<number>, b: ArrayLike<number>) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]!; } return d / Math.sqrt(x * y); };
const stat = (a: number[]) => ({ min: +Math.min(...a).toFixed(2), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), max: +Math.max(...a).toFixed(2) });

const model = await ensureModel(SPEAKER_MODEL, modelsDir());
const before = footprintMb();
const embedder = await OnnxSpeakerEmbedder.create(model);
const afterLoad = footprintMb();

type Variant = { name: string; crop?: number; phone?: boolean };
const variants: Variant[] = [{ name: 'trechos inteiros' }, { name: 'só 1,5 s de cada', crop: 1.5 }, { name: 'só 1 s de cada', crop: 1 }, { name: 'banda telefônica 8 kHz + ruído', phone: true }];
const results: unknown[] = [];
let computeMs = 0, audioS = 0;
for (const v of variants) {
  const embs: number[][] = [];
  for (const pcm of wavs) {
    let s = Int16Array.from(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2));
    if (v.crop) s = s.slice(0, Math.floor(v.crop * 16000));
    if (v.phone) {
      const g = new Float32Array(s.length);
      for (let i = 0; i + 1 < s.length; i += 2) g[i] = g[i + 1] = (s[i]! + s[i + 1]!) / 2;
      const rms = Math.sqrt(g.reduce((a, x) => a + x * x, 0) / g.length);
      const sigma = rms / Math.pow(10, 15 / 20);
      s = Int16Array.from(g, (x) => Math.max(-32768, Math.min(32767, x + sigma * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random()))));
    }
    const t0 = performance.now();
    embs.push(await embedder.embed(Buffer.from(s.buffer, s.byteOffset, s.byteLength)));
    computeMs += performance.now() - t0;
    audioS += s.length / 16000;
  }
  const same: number[] = [], diff: number[] = [];
  for (let i = 0; i < embs.length; i++) for (let j = i + 1; j < embs.length; j++) (truth[i] === truth[j] ? same : diff).push(cos(embs[i]!, embs[j]!));
  const c = new OnlineSpeakerClusterer();
  const pred = embs.map((e, i) => c.assign(e, (wavs[i]!.length / 2 / 16000) * 1000 * (v.crop ? Math.min(1, v.crop / (wavs[i]!.length / 32000)) : 1)));
  const groups = new Map<number, number[]>();
  pred.forEach((p, i) => groups.set(p ?? 0, [...(groups.get(p ?? 0) ?? []), truth[i]!]));
  let ok = 0;
  for (const g of groups.values()) ok += Math.max(...[0, 1, 2].map((x) => g.filter((y) => y === x).length));
  results.push({ variante: v.name, mesmaVoz: stat(same), vozesDiferentes: stat(diff), pessoasEncontradas: groups.size, acerto: +(ok / truth.length).toFixed(2) });
}
const afterRun = footprintMb();
await embedder.close();
await new Promise((r) => setTimeout(r, 500));
const afterRelease = footprintMb();
console.log(JSON.stringify({ footprintMb: { before, afterLoad, afterRun, afterRelease }, deltaCarregado: afterLoad - before, deltaAposUso: afterRun - before, rtf: +(computeMs / 1000 / audioS).toFixed(4), ms: Math.round(computeMs), audioSegundos: +audioS.toFixed(1), results }, null, 1));
