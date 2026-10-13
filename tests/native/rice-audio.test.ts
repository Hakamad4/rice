import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, test } from 'vitest';
import { FrameDecoder, type AudioFrame } from '../../src/shared/frames';

const run = promisify(execFile);
const PKG = resolve(__dirname, '../../native/rice-audio');
const BIN = resolve(PKG, '.build/release/rice-audio');
// O Swift do rice-audio liga a lib WebRTC de native/third_party (scripts/build-webrtc-apm.sh). Sem ela (ex.: runner do CI) o
// build não existe, então a suíte inteira é pulada em vez de falhar.
const hasWebrtc = process.platform === 'darwin' && existsSync(resolve(PKG, '../third_party/webrtc-apm/lib/libwebrtc-audio-processing-2.a'));
const describeIf = describe.skipIf(!hasWebrtc);

beforeAll(async () => {
  if (!hasWebrtc) return;
  await run('swift', ['build', '-c', 'release', '--package-path', PKG], { maxBuffer: 64 * 1024 * 1024 });
}, 600_000);

function samplesOf(frames: AudioFrame[]): Int16Array {
  const all = Buffer.concat(frames.map((f) => f.pcm));
  return new Int16Array(all.buffer, all.byteOffset, all.length / 2);
}

function zeroCrossings(s: Int16Array): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1]! < 0) !== (s[i]! < 0)) n++;
  return n;
}

function rms(s: Int16Array): number {
  let sum = 0;
  for (const v of s) sum += v * v;
  return Math.sqrt(sum / s.length);
}

describeIf('rice-audio --selftest-tone', () => {
  let frames: AudioFrame[];

  beforeAll(async () => {
    if (!hasWebrtc) return;
    const { stdout } = await run(BIN, ['--selftest-tone'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    frames = new FrameDecoder().push(stdout);
  });

  test('emite frames das duas fontes no contrato', () => {
    const mic = frames.filter((f) => f.source === 'mic');
    const sys = frames.filter((f) => f.source === 'sys');
    expect(mic.length).toBeGreaterThanOrEqual(9);
    expect(mic.length).toBeLessThanOrEqual(10);
    expect(sys.length).toBeGreaterThanOrEqual(9);
    expect(sys.length).toBeLessThanOrEqual(10);
    for (const f of [...mic.slice(0, -1), ...sys.slice(0, -1)]) expect(f.pcm.length).toBe(3200);
  });

  test('timestamps avançam 100 ms por frame em cada fonte', () => {
    for (const source of ['mic', 'sys'] as const) {
      const ts = frames.filter((f) => f.source === source).map((f) => f.timestampMs);
      ts.slice(1).forEach((t, i) => expect(t - ts[i]!).toBe(100));
    }
  });

  test('reamostra para 16 kHz preservando a frequência', () => {
    const mic = samplesOf(frames.filter((f) => f.source === 'mic'));
    const sys = samplesOf(frames.filter((f) => f.source === 'sys'));
    const perSecond = (s: Int16Array) => zeroCrossings(s) / (s.length / 16_000);
    expect(perSecond(mic)).toBeGreaterThan(880 * 0.95);
    expect(perSecond(mic)).toBeLessThan(880 * 1.05);
    expect(perSecond(sys)).toBeGreaterThan(1760 * 0.95);
    expect(perSecond(sys)).toBeLessThan(1760 * 1.05);
  });

  test('downmix estéreo→mono preserva amplitude sem clipping', () => {
    const mic = samplesOf(frames.filter((f) => f.source === 'mic'));
    // seno de amplitude 0.5 → RMS ≈ 0.354 * 32767 ≈ 11585
    expect(rms(mic)).toBeGreaterThan(9000);
    expect(rms(mic)).toBeLessThan(14000);
    expect(Math.max(...mic)).toBeLessThan(32767);
  });
});

describeIf('rice-audio modo controle', () => {
  test('EOF no stdin encerra o processo em até 3 s e não escreve no stdout', async () => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const chunks: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
      child.stdin.end();
      const code = await Promise.race([exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000))]);
      expect(code).toBe(0);
      expect(Buffer.concat(chunks).length).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('stop sem start encerra com código 0', async () => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
      child.stdin.write('{"cmd":"stop"}\n');
      const code = await Promise.race([exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000))]);
      expect(code).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('comando desconhecido gera evento de erro no stderr e o processo segue vivo', async () => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d: string) => (stderr += d));
      child.stdin.write('{"cmd":"dançar"}\n');
      await new Promise((r) => setTimeout(r, 500));
      expect(child.exitCode).toBeNull();
      const exited = new Promise((res) => child.once('exit', res));
      child.stdin.end();
      await exited;
      expect(stderr).toContain('"event":"error"');
      expect(stderr).toContain('unknown command');
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describeIf('rice-audio --selftest-gap', () => {
  test('buraco de 1 s no relógio vira silêncio: ~3 s de áudio e timestamps de 100 ms', async () => {
    const { stdout, stderr } = await run(BIN, ['--selftest-gap'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    const mic = new FrameDecoder().push(stdout).filter((f) => f.source === 'mic');
    const samples = samplesOf(mic);
    expect(Math.abs(samples.length / 16 - 3000)).toBeLessThanOrEqual(100);
    const ts = mic.map((f) => f.timestampMs);
    ts.slice(1).forEach((t, i) => expect(t - ts[i]!).toBe(100));
    // o trecho do buraco (1,0 s a 2,0 s) é silêncio
    const gap = samples.subarray(16_500, 31_500);
    expect(Math.max(...gap.map(Math.abs))).toBe(0);
    expect(rms(samples.subarray(0, 16_000))).toBeGreaterThan(9000);
    expect(stderr.toString()).toContain('"event":"gap"');
  });
});

describeIf('rice-audio --selftest-aec', () => {
  test('o AEC3 remove ≥ 15 dB do eco do áudio do sistema no microfone', async () => {
    const { stdout } = await run(BIN, ['--selftest-aec']);
    const result = JSON.parse(stdout.trim()) as { inDb: number; outDb: number; reductionDb: number };
    expect(result.reductionDb).toBeGreaterThanOrEqual(15);
  }, 60_000);
});
