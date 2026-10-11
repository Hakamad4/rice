import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { concatM4a, encodeM4a, StereoWavWriter } from '../../src/main/session/wav-writer';
import type { AudioFrame } from '../../src/shared/frames';
import { makeTmpDir } from '../helpers/tmp';

const frame = (source: 'mic' | 'sys', ts: number, value: number, samples = 1600): AudioFrame => {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(value, i * 2);
  return { source, timestampMs: ts, pcm };
};

async function readStereo(path: string) {
  const buf = await readFile(path);
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.readUInt16LE(22)).toBe(2);
  expect(buf.readUInt32LE(24)).toBe(16000);
  expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
  const dataSize = buf.readUInt32LE(40);
  expect(dataSize).toBe(buf.length - 44);
  const L: number[] = [];
  const R: number[] = [];
  for (let o = 44; o < buf.length; o += 4) {
    L.push(buf.readInt16LE(o));
    R.push(buf.readInt16LE(o + 2));
  }
  return { L, R };
}

test('intercala mic à esquerda e sys à direita', async () => {
  const path = join(await makeTmpDir(), 'a.wav');
  const w = await StereoWavWriter.open(path);
  w.write(frame('mic', 0, 100));
  w.write(frame('sys', 0, -100));
  expect(await w.close()).toEqual({ durationMs: 100 });
  const { L, R } = await readStereo(path);
  expect(L).toHaveLength(1600);
  expect(new Set(L)).toEqual(new Set([100]));
  expect(new Set(R)).toEqual(new Set([-100]));
});

test('alinha por timestamp e preenche lacunas com silêncio', async () => {
  const path = join(await makeTmpDir(), 'b.wav');
  const w = await StereoWavWriter.open(path);
  w.write(frame('mic', 0, 1));
  w.write(frame('mic', 300, 2)); // lacuna 100–300 ms no mic
  w.write(frame('sys', 200, 3)); // sys começa em 200 ms
  await w.close();
  const { L, R } = await readStereo(path);
  expect(L).toHaveLength(400 * 16);
  expect(L[0]).toBe(1);
  expect(L[150 * 16]).toBe(0);
  expect(L[350 * 16]).toBe(2);
  expect(R[100 * 16]).toBe(0);
  expect(R[250 * 16]).toBe(3);
  expect(R[350 * 16]).toBe(0);
});

test('reunião longa só com mic grava em blocos sem acumular tudo', async () => {
  const path = join(await makeTmpDir(), 'c.wav');
  const w = await StereoWavWriter.open(path);
  for (let i = 0; i < 100; i++) w.write(frame('mic', i * 100, 5)); // 10 s
  expect(w.bufferedMs).toBeLessThanOrEqual(3000);
  await w.close();
  const { L, R } = await readStereo(path);
  expect(L).toHaveLength(10 * 16000);
  expect(new Set(R)).toEqual(new Set([0]));
});

test('encodeM4a gera AAC', async () => {
  const dir = await makeTmpDir();
  const w = await StereoWavWriter.open(join(dir, 'd.wav'));
  for (let i = 0; i < 20; i++) {
    w.write(frame('mic', i * 100, 1000));
    w.write(frame('sys', i * 100, -1000));
  }
  await w.close();
  await encodeM4a(join(dir, 'd.wav'), join(dir, 'd.m4a'));
  expect((await stat(join(dir, 'd.m4a'))).size).toBeGreaterThan(1000);
});

test('dados corretos em vários blocos (valor distinto a cada 100 ms)', async () => {
  const path = join(await makeTmpDir(), 'e.wav');
  const w = await StereoWavWriter.open(path);
  for (let i = 0; i < 50; i++) {
    w.write(frame('mic', i * 100, i + 1));
    w.write(frame('sys', i * 100, -(i + 1)));
  }
  await w.close();
  const { L, R } = await readStereo(path);
  expect(L).toHaveLength(5 * 16000);
  for (let i = 0; i < 50; i++) {
    expect(L[i * 1600]).toBe(i + 1);
    expect(L[i * 1600 + 1599]).toBe(i + 1);
    expect(R[i * 1600]).toBe(-(i + 1));
  }
});

test('alinha após descarga parcial (mic à frente do sys)', async () => {
  const path = join(await makeTmpDir(), 'f.wav');
  const w = await StereoWavWriter.open(path);
  for (let i = 0; i < 20; i++) w.write(frame('mic', i * 100, 1));
  for (let i = 0; i < 10; i++) w.write(frame('sys', i * 100, 2)); // flush parcial de 1 s
  for (let i = 20; i < 30; i++) w.write(frame('mic', i * 100, 1)); // defasagem de 2 s, sem forçar silêncio
  for (let i = 10; i < 50; i++) {
    w.write(frame('sys', i * 100, 4));
    if (i + 20 < 50) w.write(frame('mic', (i + 20) * 100, 3));
  }
  await w.close();
  const { L, R } = await readStereo(path);
  expect(L).toHaveLength(5 * 16000);
  for (let ms = 0; ms < 5000; ms += 50) {
    expect(L[ms * 16 + 7]).toBe(ms < 3000 ? 1 : 3);
    expect(R[ms * 16 + 7]).toBe(ms < 1000 ? 2 : 4);
  }
});

test('frame atrasado é ignorado e frame na fronteira grava só a parte nova', async () => {
  const path = join(await makeTmpDir(), 'g.wav');
  const w = await StereoWavWriter.open(path);
  for (let i = 0; i < 10; i++) {
    w.write(frame('mic', i * 100, 1));
    w.write(frame('sys', i * 100, 1));
  } // 1 s gravado
  w.write(frame('mic', 500, 9)); // inteiramente antes
  w.write(frame('mic', 950, 7)); // 950–1050: só 1000–1050 é novo
  w.write(frame('sys', 1000, 8)); // 1000–1100
  await w.close();
  const { L, R } = await readStereo(path);
  expect(L).toHaveLength(1100 * 16);
  expect(L[500 * 16]).toBe(1);
  expect(L[960 * 16]).toBe(1);
  expect(L[1000 * 16]).toBe(7);
  expect(L[1049 * 16]).toBe(7);
  expect(L[1050 * 16]).toBe(0);
  expect(R[1000 * 16]).toBe(8);
});

test('close duas vezes é idempotente e write após close é ignorado', async () => {
  const path = join(await makeTmpDir(), 'h.wav');
  const w = await StereoWavWriter.open(path);
  w.write(frame('mic', 0, 1));
  w.write(frame('sys', 0, 1));
  const [a, b] = await Promise.all([w.close(), w.close()]);
  expect(a).toEqual({ durationMs: 100 });
  expect(b).toEqual(a);
  const before = await readFile(path);
  w.write(frame('mic', 100, 5));
  expect(await w.close()).toEqual(a);
  expect((await readFile(path)).equals(before)).toBe(true);
});

/** FileHandle falso com sistema de arquivos em memória e falhas programáveis. */
function fakeFs(opts: { failAfterBytes?: number; failCode?: string; missingDirs?: boolean } = {}) {
  const files = new Map<string, Buffer>();
  const log: string[] = [];
  let bytes = 0;
  let brokenDir = opts.missingDirs ?? false;
  let diskFull = opts.failAfterBytes !== undefined;
  const handle = (path: string) => ({
    async write(data: Buffer, offset: number, length: number, position: number) {
      if (brokenDir && !path.startsWith('/spool')) throw Object.assign(new Error('ENOENT: pasta sumiu'), { code: 'ENOENT' });
      if (diskFull && bytes + length > (opts.failAfterBytes ?? 0)) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: opts.failCode ?? 'ENOSPC' });
      bytes += length;
      const cur = files.get(path) ?? Buffer.alloc(0);
      const next = Buffer.alloc(Math.max(cur.length, position + length));
      cur.copy(next);
      data.copy(next, position, offset, offset + length);
      files.set(path, next);
      return { bytesWritten: length, buffer: data };
    },
    async close() {},
  });
  return {
    files,
    log,
    freeDisk: () => { diskFull = false; },
    fixDir: () => { brokenDir = false; },
    fs: {
      open: async (path: string) => {
        if (brokenDir && !path.startsWith('/spool')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        log.push(`open ${path}`);
        files.set(path, Buffer.alloc(0));
        return handle(path) as never;
      },
      mkdir: async (path: string) => {
        if (brokenDir && !path.startsWith('/spool')) throw Object.assign(new Error('EIO: volume desmontado'), { code: 'EIO' });
        log.push(`mkdir ${path}`);
      },
    },
  };
}

const feed = (w: StereoWavWriter, seconds: number, from = 0) => {
  for (let i = 0; i < seconds * 10; i++) {
    w.write(frame('mic', from + i * 100, 7));
    w.write(frame('sys', from + i * 100, 7));
  }
};

test('disco cheio: avisa uma vez na hora, descarta o áudio (silêncio) e tenta de novo depois; close não rejeita', async () => {
  const f = fakeFs({ failAfterBytes: 44 + 3 * 64_000 });
  const failures: unknown[] = [];
  let recovered = 0;
  let clock = 0;
  const w = await StereoWavWriter.open('/rec/a.wav', { fs: f.fs, onFailure: (x) => failures.push(x), onRecovered: () => recovered++, now: () => clock, retryMs: 10_000 });
  feed(w, 6);
  await w.close().catch(() => {});
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({ kind: 'full' });
  expect(w.droppedMs).toBeGreaterThan(0);

  const f2 = fakeFs({ failAfterBytes: 44 + 3 * 64_000 });
  const w2 = await StereoWavWriter.open('/rec/b.wav', { fs: f2.fs, onFailure: (x) => failures.push(x), onRecovered: () => recovered++, now: () => clock, retryMs: 10_000 });
  feed(w2, 5);
  await new Promise((r) => setTimeout(r, 20));
  expect(w2.droppedMs).toBeGreaterThan(0);
  f2.freeDisk(); // o usuário liberou espaço
  clock += 11_000;
  feed(w2, 4, 5000);
  const closed = await w2.close();
  expect(recovered).toBe(1);
  expect(closed.durationMs).toBe(9000);
  expect(f2.files.get('/rec/b.wav')!.length).toBeGreaterThan(44 + 8 * 64_000);
});

test('transcrição tem prioridade: disco cheio repetido não vira laço de avisos', async () => {
  const f = fakeFs({ failAfterBytes: 44, failCode: 'EDQUOT' });
  const failures: unknown[] = [];
  const w = await StereoWavWriter.open('/rec/c.wav', { fs: f.fs, onFailure: (x) => failures.push(x), now: () => 0 });
  feed(w, 12);
  await w.close();
  expect(failures).toHaveLength(1);
});

test('pasta que some e volta a ser criável: recria e continua no mesmo caminho', async () => {
  const f = fakeFs();
  const failures: unknown[] = [];
  const w = await StereoWavWriter.open('/rec/d.wav', { fs: f.fs, onFailure: (x) => failures.push(x) });
  feed(w, 2);
  await new Promise((r) => setTimeout(r, 10));
  // a pasta é apagada: a próxima escrita falha com ENOENT, mkdir funciona (volume ok)
  const file = (w as unknown as { file: { write: (...a: unknown[]) => Promise<unknown> } }).file;
  let first = true;
  const realWrite = file.write.bind(file);
  file.write = async (...a: unknown[]) => {
    if (first) {
      first = false;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return realWrite(...a);
  };
  feed(w, 3, 2000);
  await w.close();
  expect(failures).toEqual([expect.objectContaining({ kind: 'unavailable', fallback: false })]);
  expect(f.log.filter((l) => l.startsWith('mkdir'))).toContain('mkdir /rec');
  expect(w.path).toBe('/rec/d.wav');
});

test('volume desmontado: segue no local alternativo, avisa com fallback e devolve o caminho novo no close', async () => {
  const f = fakeFs();
  const failures: Array<{ kind: string; fallback?: boolean }> = [];
  const w = await StereoWavWriter.open('/rec/e.wav', { fs: f.fs, fallbackPath: '/spool/e.wav', onFailure: (x) => failures.push(x) });
  feed(w, 2);
  await new Promise((r) => setTimeout(r, 10));
  const broken = fakeFs({ missingDirs: true });
  // troca o fs para um volume que falha em tudo fora de /spool
  (w as unknown as { options: { fs: unknown } }).options.fs = broken.fs;
  (w as unknown as { file: unknown }).file = { write: async () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); }, close: async () => {} };
  feed(w, 3, 2000);
  const closed = await w.close();
  expect(failures).toEqual([{ kind: 'unavailable', error: expect.anything(), fallback: true }]);
  expect(closed.path).toBe('/spool/e.wav');
  expect(broken.files.get('/spool/e.wav')!.length).toBeGreaterThan(44);
});

test('sem local alternativo (ou ele também falha): "lost" uma vez, o resto é descartado sem rejeitar', async () => {
  const broken = fakeFs({ missingDirs: true });
  const failures: Array<{ kind: string }> = [];
  let headerWritten = false;
  const flaky = { write: async () => { if (!headerWritten) { headerWritten = true; return { bytesWritten: 44 }; } throw Object.assign(new Error('EIO'), { code: 'EIO' }); }, close: async () => {} };
  const w = await StereoWavWriter.open('/rec/f.wav', { fs: { open: async () => flaky as never, mkdir: broken.fs.mkdir }, onFailure: (x) => failures.push(x) });
  feed(w, 4);
  await expect(w.close()).resolves.toMatchObject({ durationMs: 4000 });
  expect(failures.map((x) => x.kind)).toEqual(['lost']);
  expect(w.droppedMs).toBeGreaterThan(0);
});

test('o cabeçalho é regravado a cada ~10 s: arquivo sem fechamento continua legível', async () => {
  const path = join(await makeTmpDir(), 'g.wav');
  const w = await StereoWavWriter.open(path);
  feed(w, 25);
  await new Promise((r) => setTimeout(r, 50)); // deixa a cadeia de escrita assentar, sem chamar close (simula queda)
  const buf = await readFile(path);
  const declared = buf.readUInt32LE(40);
  expect(declared).toBeGreaterThanOrEqual(10 * 64_000);
  expect(declared).toBeLessThanOrEqual(buf.length - 44);
  expect(buf.readUInt32LE(4)).toBe(36 + declared);
});

test('concatM4a junta dois m4a num arquivo mais longo', async () => {
  const dir = await makeTmpDir();
  for (const name of ['a', 'b']) {
    const w = await StereoWavWriter.open(join(dir, `${name}.wav`));
    for (let i = 0; i < 20; i++) w.write(frame('mic', i * 100, 1000));
    await w.close();
    await encodeM4a(join(dir, `${name}.wav`), join(dir, `${name}.m4a`));
  }
  await concatM4a(join(dir, 'a.m4a'), join(dir, 'b.m4a'), join(dir, 'out.m4a'));
  const [a, out] = await Promise.all([stat(join(dir, 'a.m4a')), stat(join(dir, 'out.m4a'))]);
  expect(out.size).toBeGreaterThan(a.size * 1.15);
  expect((await readdir(dir)).filter((f) => f.endsWith('.wav') && f.startsWith('out'))).toEqual([]);
});
