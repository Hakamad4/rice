import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TranscriptSink, type SinkFs } from '../../src/main/store/transcript-sink';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** FS em memória: `mode` diz como a pasta principal responde. */
function fakeFs() {
  const files = new Map<string, string>();
  const state = { mode: 'ok' as 'ok' | 'full' | 'gone' | 'unmounted' };
  const err = (code: string) => Object.assign(new Error(code), { code });
  const fs: SinkFs = {
    appendFile: async (path, data) => {
      if (!path.startsWith('/spool')) {
        if (state.mode === 'full') throw err('ENOSPC');
        if (state.mode === 'gone' || state.mode === 'unmounted') throw err('ENOENT');
      }
      files.set(path, (files.get(path) ?? '') + data);
    },
    mkdir: async (path) => {
      if (!path.startsWith('/spool') && state.mode === 'unmounted') throw err('EIO');
      if (state.mode === 'gone' && !path.startsWith('/spool')) state.mode = 'ok'; // criar a pasta de novo funciona
    },
    rm: async (path) => { files.delete(path); },
  };
  return { fs, files, state };
}

test('caminho feliz: grava na hora e a fila fica vazia', async () => {
  const f = fakeFs();
  const sink = new TranscriptSink({ path: '/rec/t.md', fs: f.fs });
  await sink.append('a\n');
  await sink.append('b\n');
  expect(f.files.get('/rec/t.md')).toBe('a\nb\n');
  expect(sink.pending).toBe(false);
});

test('disco cheio: avisa uma vez, guarda na memória e na cópia local, e regrava tudo em ordem quando há espaço', async () => {
  const f = fakeFs();
  const failures: string[] = [];
  let recovered = 0;
  const sink = new TranscriptSink({ path: '/rec/t.md', spoolPath: '/spool/t.md', fs: f.fs, retryMs: 5000, onFailure: (k) => failures.push(k), onRecovered: () => recovered++ });
  await sink.append('um\n');
  f.state.mode = 'full';
  await sink.append('dois\n');
  await sink.append('três\n');
  expect(failures).toEqual(['full']);
  expect(f.files.get('/spool/t.md')).toBe('dois\ntrês\n');
  expect(sink.pending).toBe(true);
  await vi.advanceTimersByTimeAsync(5000); // continua cheio: tenta de novo sem avisar de novo
  expect(failures).toEqual(['full']);
  f.state.mode = 'ok';
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.files.get('/rec/t.md')).toBe('um\ndois\ntrês\n');
  expect(sink.pending).toBe(false);
  expect(recovered).toBe(1);
  expect(f.files.has('/spool/t.md')).toBe(false); // cópia local removida depois de gravar
});

test('pasta apagada: recria na hora e não perde nada', async () => {
  const f = fakeFs();
  const failures: string[] = [];
  const sink = new TranscriptSink({ path: '/rec/t.md', fs: f.fs, onFailure: (k) => failures.push(k) });
  f.state.mode = 'gone';
  await sink.append('x\n');
  expect(f.files.get('/rec/t.md')).toBe('x\n');
  expect(failures).toEqual([]);
});

test('volume desmontado: fica na cópia local; ao final sem volta, close devolve o caminho da cópia', async () => {
  const f = fakeFs();
  const failures: string[] = [];
  const sink = new TranscriptSink({ path: '/rec/t.md', spoolPath: '/spool/t.md', fs: f.fs, onFailure: (k) => failures.push(k) });
  f.state.mode = 'unmounted';
  await sink.append('a\n');
  await sink.append('b\n');
  expect(failures).toEqual(['unavailable']);
  expect(await sink.close()).toEqual({ complete: false, spoolPath: '/spool/t.md' });
  expect(f.files.get('/spool/t.md')).toBe('a\nb\n');
});

test('volume que volta antes do fim: close grava o que faltava e confirma', async () => {
  const f = fakeFs();
  const sink = new TranscriptSink({ path: '/rec/t.md', spoolPath: '/spool/t.md', fs: f.fs });
  f.state.mode = 'unmounted';
  await sink.append('a\n');
  f.state.mode = 'ok';
  expect(await sink.close()).toEqual({ complete: true });
  expect(f.files.get('/rec/t.md')).toBe('a\n');
});
