import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OnlineSpeakerClusterer } from '../../src/main/asr/speaker-cluster';
import { createClusteringIdentifier, LEGACY_VOICE_FILE, removeLegacyVoiceFiles } from '../../src/main/asr/speaker-identifier';
import type { SpeakerEmbedder } from '../../src/main/asr/speaker-embedder';
import { appendSegment, createMeeting, updateMeta, writeAnnotations, writeNotes } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

/** Embedder falso com vetores de 192 números "marcados": qualquer vazamento deles no disco é reconhecível. */
const MARK = 0.000314159265;
class MarkedEmbedder implements SpeakerEmbedder {
  async embed(pcm: Buffer) {
    const who = pcm.readInt16LE(0);
    return Array.from({ length: 192 }, (_, i) => (i % 4 === who ? 1 : 0) + MARK + i * 1e-9);
  }
  async close() {}
}
const chunk = (seconds: number, who: number) => Buffer.from(new Int16Array(16_000 * seconds).fill(who).buffer);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

describe('assinatura de voz nunca vai para o disco', () => {
  test('reunião simulada com a identificação ligada: nenhum arquivo da reunião, do userData ou do spool tem vetores de voz', async () => {
    const root = await makeTmpDir();
    const userData = await makeTmpDir();
    const spool = join(userData, 'spool');
    await mkdir(spool, { recursive: true });
    await writeFile(join(spool, 'sessao.pcm'), Buffer.from(new Int16Array(16_000).fill(7).buffer)); // o spool de áudio (a captura) segue como sempre
    const { dir } = await createMeeting(root, { title: 'Reunião com vozes', startedAt: new Date(2026, 9, 13, 10), trigger: 'manual', state: 'recording' });

    // a sessão: vários trechos de 3 pessoas e o nome dado depois
    const identifier = createClusteringIdentifier(new MarkedEmbedder());
    const assigned: Array<number | null> = [];
    for (const who of [1, 2, 1, 3, 2, 1, 3, 3]) {
      const person = await identifier.identify(chunk(3, who));
      assigned.push(person);
      await appendSegment(dir, new Date(2026, 9, 13, 10), { id: `s${assigned.length}`, source: 'Outros', startMs: assigned.length * 3000, endMs: assigned.length * 3000 + 2900, text: `fala ${assigned.length}` });
    }
    expect(assigned).toEqual([1, 2, 1, 3, 2, 1, 3, 3]); // a identificação funciona (em memória)
    await identifier.close(); // fim da sessão
    await updateMeta(dir, (m) => ({ ...m, state: 'done', speakers: { '2': 'Ana' } }));
    await writeNotes(dir, '## Decisões\n- Fechado');
    await writeAnnotations(dir, 'minhas notas');

    const files = [...(await walk(dir)), ...(await walk(userData))];
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      if (file.endsWith('.pcm')) continue; // áudio cru do spool: PCM binário, não texto
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toContain('0.0003141'); // nenhum componente dos vetores
      expect(text, file).not.toContain('"sum"');
      expect(text, file).not.toMatch(/embedding|centroid|voiceprint/i);
    }
    expect(files.some((f) => f.endsWith(LEGACY_VOICE_FILE))).toBe(false);
    // o que fica é só texto: o nome dado no meta
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    expect(meta.speakers).toEqual({ '2': 'Ana' });
    expect(Object.keys(meta).join(',')).not.toMatch(/embed|voice|vector/i);
  });

  test('guarda estática: o módulo da identificação não tem nenhuma escrita em disco', async () => {
    for (const file of ['src/main/asr/speaker-identifier.ts', 'src/main/asr/speaker-cluster.ts', 'src/main/asr/speaker-embedder.ts']) {
      const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/writeFile|appendFile|writeAtomic|createWriteStream|JSON\.stringify/);
    }
    const main = await readFile('src/main/app/main.ts', 'utf8');
    expect(main).not.toMatch(/saveClusterState|loadClusterState/);
  });

  test('o arquivo legado falantes.json (centroides de versões antigas) é apagado, e só ele', async () => {
    const root = await makeTmpDir();
    const a = (await createMeeting(root, { title: 'A', startedAt: new Date(2026, 9, 1, 10), trigger: 'manual', state: 'draft' })).dir;
    const b = (await createMeeting(root, { title: 'B', startedAt: new Date(2026, 9, 2, 10), trigger: 'manual', state: 'draft' })).dir;
    await writeFile(join(a, LEGACY_VOICE_FILE), JSON.stringify({ clusters: [{ id: 1, n: 3, sum: [0.1, 0.2] }], last: 1 }));
    await writeNotes(a, 'notas da A');
    expect(await removeLegacyVoiceFiles([a, b])).toBe(1);
    expect(await readdir(a)).not.toContain(LEGACY_VOICE_FILE);
    expect(await readFile(join(a, 'notas.md'), 'utf8')).toBe('notas da A'); // o resto fica intacto
    expect(await removeLegacyVoiceFiles([a, b])).toBe(0);
  });

  test('o clusterizador segue funcionando só com o objeto em memória (sem arquivo)', () => {
    const c = new OnlineSpeakerClusterer();
    expect(c.assign([1, 0, 0], 3000)).toBe(1);
    expect(c.assign([0, 1, 0], 3000)).toBe(2);
    expect(c.speakerCount).toBe(2);
  });
});
