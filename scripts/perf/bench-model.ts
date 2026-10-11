// Uso: npx tsx scripts/perf/bench-model.ts <modelo.bin> <audio.wav> <texto-referencia.txt>
// Sobe o whisper-server com o modelo, mede footprint (carregado / depois da inferência), tempo de
// carga a frio, tempo de inferência (RTF) e WER contra o texto de referência.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { WhisperServer } from '../../src/main/asr/whisper-server';
import { whisperServerBinary } from '../../src/main/asr/config';
import { pcmToWav, readWav } from '../../src/shared/wav';
import { wer } from '../../tests/helpers/wer';

const [model, wavPath, refPath] = process.argv.slice(2);
if (!model || !wavPath || !refPath) throw new Error('uso: bench-model.ts modelo.bin audio.wav ref.txt');
const reference = readFileSync(refPath, 'utf8').trim();
const { pcm } = readWav(readFileSync(wavPath));
const seconds = pcm.length / 2 / 16000;
const wav = pcmToWav(pcm);

function footprintMb(pid: number): number {
  const out = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8' });
  const m = /phys_footprint:\s+([\d.]+)\s+(KB|MB|GB)/.exec(out);
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2] === 'GB' ? v * 1024 : m[2] === 'KB' ? v / 1024 : v;
}

const server = new WhisperServer({ binary: whisperServerBinary(), modelPath: model });
const t0 = Date.now();
await server.start();
const coldMs = Date.now() - t0;
const pid = (server as unknown as { child: { pid: number } }).child.pid;
// o pid do wrapper é o sh; o servidor é o filho dele
const real = Number(execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim().split('\n')[0]);
const loaded = footprintMb(real);
const runs: number[] = [];
let text = '';
for (let i = 0; i < 3; i++) {
  const s = Date.now();
  text = await server.transcribe(wav, { language: 'pt' });
  runs.push(Date.now() - s);
}
const after = footprintMb(real);
await server.dispose();
const best = Math.min(...runs);
console.log(JSON.stringify({
  model: model.split('/').pop(), diskMb: Math.round(statSync(model).size / 1048576), coldLoadMs: coldMs,
  footprintLoadedMb: Math.round(loaded), footprintAfterInferenceMb: Math.round(after),
  audioSeconds: Math.round(seconds), inferenceMs: runs, rtf: Number((best / 1000 / seconds).toFixed(3)),
  wer: Number(wer(reference, text).toFixed(3)), text: text.trim(),
}, null, 1));
