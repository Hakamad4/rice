import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, test } from 'vitest';
import { FrameDecoder, type AudioFrame } from '../../src/shared/frames';
import { AudioCapture } from '../../src/main/session/audio-capture';
import { DetectorClient } from '../../src/main/session/detector-client';

// Os helpers C++ (native/win) contra o contrato gravado do Swift. No CI do Windows, RICE_WIN_BIN_DIR aponta para os .exe
// compilados com MSVC; nos demais sistemas o teste compila a parte portável com o c++ do sistema (e pula se não houver).
const run = promisify(execFile);
const WIN = resolve(__dirname, '../../native/win');
const FIX = resolve(__dirname, '../fixtures/protocol');
const exe = process.platform === 'win32' ? '.exe' : '';

let audio = '';
let detector = '';
let skip = false;

beforeAll(async () => {
  const dir = process.env.RICE_WIN_BIN_DIR;
  if (dir) {
    audio = join(dir, `rice-audio${exe}`);
    detector = join(dir, `rice-detector${exe}`);
    return;
  }
  try {
    execFileSync('c++', ['--version'], { stdio: 'ignore' });
  } catch {
    skip = true;
    return;
  }
  const out = mkdtempSync(join(tmpdir(), 'rice-win-bin-')); // fica entre os testes
  const common = ['common/json', 'common/events', 'common/framing', 'common/chunker', 'common/resampler'].map((f) => `${WIN}/${f}.cpp`);
  const flags = ['-std=c++17', '-O1', '-pthread'];
  audio = join(out, 'rice-audio');
  detector = join(out, 'rice-detector');
  const core = ['echo_canceller', 'recorder', 'selftests', 'sinks', 'simulated_platform', 'output_classify', 'main'].map((f) => `${WIN}/audio/${f}.cpp`);
  await run('c++', [...flags, ...common, ...core, '-o', audio], { maxBuffer: 64 * 1024 * 1024 });
  const det = ['app_matcher', 'mic_watcher', 'mic_monitor', 'main'].map((f) => `${WIN}/detector/${f}.cpp`);
  await run('c++', [...flags, ...common, ...det, '-o', detector], { maxBuffer: 64 * 1024 * 1024 });
}, 300_000);

const bytes = (name: string) => readFileSync(join(FIX, name));
const samples = (frames: AudioFrame[]) => {
  const all = Buffer.concat(frames.map((f) => f.pcm));
  return new Int16Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.length));
};
const rms = (s: Int16Array) => Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length);

describe('testes C++ do núcleo portável', () => {
  // No Windows quem roda isto é o ctest do CI (build/win/rice_tests).
  test.skipIf(skip || process.platform === 'win32')('native/win/run-tests.sh passa', async () => {
    const { stderr } = await run('bash', [join(WIN, 'run-tests.sh')], { maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
      throw new Error(String(e.stderr ?? e));
    });
    expect(stderr).toMatch(/\d+ testes, 0 falhas/);
  }, 180_000);
});

describe('rice-audio (C++) contra o Swift', () => {
  test.skipIf(skip)('--selftest-gap é idêntico bit a bit, com o mesmo evento no stderr', async () => {
    const { stdout, stderr } = await run(audio, ['--selftest-gap'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    expect(Buffer.compare(stdout, bytes('gap.bin'))).toBe(0);
    expect(stderr.toString().trim()).toBe(bytes('gap.stderr').toString().trim());
  });

  test.skipIf(skip)('--selftest-tone: mesma estrutura de frames e o mesmo sinal que o Swift', async () => {
    const { stdout } = await run(audio, ['--selftest-tone'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    const mine = new FrameDecoder().push(stdout);
    const swift = new FrameDecoder().push(bytes('tone.bin'));
    for (const source of ['mic', 'sys'] as const) {
      const a = mine.filter((f) => f.source === source);
      const b = swift.filter((f) => f.source === source);
      expect(a.length).toBe(b.length);
      a.forEach((f, i) => expect(f.timestampMs).toBe(i * 100));
      for (const f of a.slice(0, -1)) expect(f.pcm.length).toBe(3200);
      const x = samples(a);
      const y = samples(b);
      let max = 0;
      for (let i = 100; i < Math.min(x.length, y.length) - 200; i++) max = Math.max(max, Math.abs(x[i]! - y[i]!));
      expect(max).toBeLessThan(330);
      expect(Math.abs(rms(x) - 11585)).toBeLessThan(400);
    }
  });

  test.skipIf(skip)('comandos inválidos e desconhecidos geram erro no stderr e stop sai com 0', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(audio, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.stdin.write('lixo\n{"cmd":"dançar"}\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(child.exitCode).toBeNull();
    const exited = new Promise<number | null>((res) => child.once('exit', (c) => res(c)));
    child.stdin.write('{"cmd":"stop"}\n');
    expect(await exited).toBe(0);
    expect(stderr).toContain('"message":"invalid command line"');
    expect(stderr).toContain('unknown command: dançar');
  });

  test.skipIf(skip)('o AudioCapture real do main grava com o helper simulado: frames das duas fontes, started/stopped, saída esperada', async () => {
    process.env.RICE_AUDIO_SIMULATE = '1';
    const capture = new AudioCapture(audio);
    const frames: AudioFrame[] = [];
    const events: string[] = [];
    capture.on('frame', (f: AudioFrame) => frames.push(f));
    capture.on('event', (e: { event: string }) => events.push(e.event));
    const exit = new Promise<{ code: number | null; expected: boolean }>((res) => capture.once('exit', res));
    capture.start();
    await new Promise((r) => setTimeout(r, 1500));
    await capture.stop();
    const result = await exit;
    delete process.env.RICE_AUDIO_SIMULATE;
    expect(result).toMatchObject({ code: 0, expected: true });
    expect(events).toContain('started');
    expect(events).toContain('stopped');
    for (const source of ['mic', 'sys'] as const) {
      const ts = frames.filter((f) => f.source === source).map((f) => f.timestampMs);
      expect(ts.length).toBeGreaterThanOrEqual(10);
      ts.slice(1).forEach((t, i) => expect(t - ts[i]!).toBe(100));
    }
  });
});

describe('rice-detector (C++) contra o Swift', () => {
  const doc = JSON.parse(readFileSync(join(FIX, 'detector.json'), 'utf8')) as {
    match: Array<{ input: string; output: { app: string | null } }>;
    simulateMic: Array<{ input: string[][]; output: unknown[] }>;
  };

  test.skipIf(skip)('--match dá o mesmo app para cada id gravado do Swift', async () => {
    for (const c of doc.match) {
      const { stdout } = await run(detector, ['--match', c.input]);
      expect(JSON.parse(stdout), c.input).toEqual(c.output);
    }
  });

  test.skipIf(skip)('--simulate-mic gera exatamente os eventos do Swift', async () => {
    for (const c of doc.simulateMic) {
      const { stdout } = await run(detector, ['--simulate-mic', JSON.stringify(c.input)]);
      expect(stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))).toEqual(c.output);
    }
  });

  test.skipIf(skip)('o DetectorClient real recebe mic-in-use/ended do helper simulado; agenda e lembretes respondem vazio', async () => {
    process.env.RICE_DETECTOR_FAKE_MIC_STEPS = '[["chrome.exe"],["chrome.exe"],[]]';
    process.env.RICE_DETECTOR_FAKE_MIC_INTERVAL_MS = '100';
    const client = new DetectorClient(detector, { releaseDebounceMs: 50 });
    const seen: string[] = [];
    client.on('meeting-app-started', (e: { app: string }) => seen.push(`started:${e.app}`));
    client.on('meeting-app-ended', (e: { app: string }) => seen.push(`ended:${e.app}`));
    client.start();
    try {
      await new Promise((r) => setTimeout(r, 800));
      expect(seen).toEqual(['started:Google Chrome', 'ended:Google Chrome']);
      expect(await client.currentEvent()).toBeNull();
      expect(await client.listEvents(new Date(), new Date(Date.now() + 86_400_000))).toEqual([]);
      expect(await client.listReminders()).toEqual([]);
      expect(await client.completeReminder('x')).toBe(false);
    } finally {
      client.stop();
      delete process.env.RICE_DETECTOR_FAKE_MIC_STEPS;
      delete process.env.RICE_DETECTOR_FAKE_MIC_INTERVAL_MS;
    }
  });
});
