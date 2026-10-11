import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { forEachStereoFrame, recoverOrphanAudio, repairWavHeader, wavDataRange } from '../../src/main/session/audio-recovery';
import { StereoWavWriter } from '../../src/main/session/wav-writer';
import type { AudioFrame } from '../../src/shared/frames';
import { makeTmpDir } from '../helpers/tmp';

const frame = (source: 'mic' | 'sys', ts: number, value: number): AudioFrame => ({ source, timestampMs: ts, pcm: Buffer.alloc(3200, 0).fill(Buffer.from(Int16Array.of(value).buffer)) });

/** Grava N segundos e NÃO fecha o writer (simula a queda): o cabeçalho final nunca é escrito. */
async function orphanWav(dir: string, seconds: number, name = 'audio.wav') {
  const w = await StereoWavWriter.open(join(dir, name));
  for (let i = 0; i < seconds * 10; i++) {
    w.write(frame('mic', i * 100, 1000));
    w.write(frame('sys', i * 100, -1000));
  }
  await new Promise((r) => setTimeout(r, 50));
  return w;
}

test('WAV sem fechamento é consertado pelo tamanho do arquivo e passa a ser legível', async () => {
  const dir = await makeTmpDir();
  await orphanWav(dir, 4);
  const path = join(dir, 'audio.wav');
  const before = await readFile(path);
  const result = await repairWavHeader(path);
  const after = await readFile(path);
  expect(after.readUInt32LE(40)).toBe(after.length - 44);
  expect(after.readUInt32LE(4)).toBe(after.length - 8);
  expect(result!.durationMs).toBe(((after.length - 44) / 4 / 16000) * 1000);
  expect(result!.durationMs).toBeGreaterThanOrEqual(3000); // até o último bloco de 1 s gravado
  expect(before.length).toBe(after.length);
});

test('arquivo só com cabeçalho ou com último quadro cortado: nada a recuperar / corta no quadro inteiro', async () => {
  const dir = await makeTmpDir();
  await writeFile(join(dir, 'a.wav'), Buffer.alloc(44));
  expect(await repairWavHeader(join(dir, 'a.wav'))).toBeNull();
  const w = await orphanWav(dir, 2, 'b.wav');
  void w;
  const buf = await readFile(join(dir, 'b.wav'));
  await writeFile(join(dir, 'b.wav'), buf.subarray(0, buf.length - 3)); // queda no meio de um quadro
  const fixed = await repairWavHeader(join(dir, 'b.wav'));
  const after = await readFile(join(dir, 'b.wav'));
  expect(after.readUInt32LE(40) % 4).toBe(0);
  expect(fixed!.durationMs).toBeGreaterThan(0);
});

test('recoverOrphanAudio codifica o órfão em audio.m4a e apaga o WAV; sem órfão não faz nada', async () => {
  const dir = await makeTmpDir();
  await orphanWav(dir, 3);
  const encode = vi.fn(async (_wav: string, m4a: string) => { await writeFile(m4a, 'm4a'); });
  const result = await recoverOrphanAudio(dir, { keepAudio: true, encode });
  expect(result.recovered).toBe(true);
  expect(result.durationMs).toBeGreaterThanOrEqual(2000);
  expect((await readdir(dir)).sort()).toEqual(['audio.m4a']);
  expect(await recoverOrphanAudio(dir, { keepAudio: true, encode })).toEqual({ recovered: false, durationMs: 0 });
});

test('já existe áudio de uma gravação anterior: o recuperado é juntado a ele, nunca o substitui', async () => {
  const dir = await makeTmpDir();
  await writeFile(join(dir, 'audio.m4a'), 'antigo');
  await orphanWav(dir, 3, 'audio-2.wav');
  const encode = async (_w: string, m4a: string) => { await writeFile(m4a, 'novo'); };
  const concat = vi.fn(async (a: string, b: string, out: string) => { await writeFile(out, `${await readFile(a, 'utf8')}+${await readFile(b, 'utf8')}`); });
  await recoverOrphanAudio(dir, { keepAudio: true, encode, concat });
  expect(await readFile(join(dir, 'audio.m4a'), 'utf8')).toBe('antigo+novo');
  expect((await readdir(dir)).sort()).toEqual(['audio.m4a']);
});

test('falha ao codificar: o WAV continua na pasta (já com cabeçalho certo) e o erro volta para quem chamou', async () => {
  const dir = await makeTmpDir();
  await orphanWav(dir, 3);
  const encode = async () => { throw new Error('afconvert falhou'); };
  const result = await recoverOrphanAudio(dir, { keepAudio: true, encode });
  expect(result).toMatchObject({ recovered: false, error: 'afconvert falhou' });
  const wav = await readFile(join(dir, 'audio.wav'));
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
});

test('keepAudio desligado: o órfão é só apagado', async () => {
  const dir = await makeTmpDir();
  await orphanWav(dir, 2);
  await recoverOrphanAudio(dir, { keepAudio: false, encode: async () => { throw new Error('não deveria codificar'); } });
  expect(await readdir(dir)).toEqual([]);
});

test('forEachStereoFrame entrega 100 ms por vez, separa mic/sys e começa onde pedido', async () => {
  const dir = await makeTmpDir();
  const w = await StereoWavWriter.open(join(dir, 'audio.wav'));
  for (let i = 0; i < 30; i++) {
    w.write(frame('mic', i * 100, i + 1));
    w.write(frame('sys', i * 100, -(i + 1)));
  }
  await w.close();
  const path = join(dir, 'audio.wav');
  expect((await wavDataRange(path)).bytes).toBe(3000 * 64);
  const seen: Array<[number, number, number]> = [];
  await forEachStereoFrame(path, 2000, (ts, mic, sys) => { seen.push([ts, mic.readInt16LE(0), sys.readInt16LE(0)]); });
  expect(seen[0]).toEqual([2000, 21, -21]);
  expect(seen).toHaveLength(10);
  expect((await stat(path)).size).toBe(44 + 3000 * 64);
});
