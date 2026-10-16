import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { MeetingSession } from '../../src/main/session/meeting-session';
import { AudioCapture } from '../../src/main/session/audio-capture';
import type { AudioFrame } from '../../src/shared/frames';
import { makeTmpDir } from '../helpers/tmp';

// Helper de captura de verdade (processo filho) com o rice-audio falso: depois de parar a sessão NENHUM processo pode sobrar vivo.
const FAKE = resolve(__dirname, '../fixtures/fake-rice-audio.mjs');
const spawned: AudioCapture[] = [];
const alive = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidOf = (c: AudioCapture): number | undefined => (c as unknown as { child: { pid?: number } | null }).child?.pid;
const pids = new Set<number>();

class FakePipeline extends EventEmitter {
  frames = 0;
  pushFrame(_f: AudioFrame) { this.frames++; }
  async finish() {}
  async flush() {}
  retry() {}
}

async function setup(restartDelayMs = 1) {
  const root = await makeTmpDir();
  const pipeline = new FakePipeline();
  const session = new MeetingSession({
    root: async () => root,
    createCapture: () => {
      const c = new AudioCapture(FAKE);
      spawned.push(c);
      const start = c.start.bind(c);
      c.start = () => { start(); const p = pidOf(c); if (p) pids.add(p); };
      return c;
    },
    createPipeline: async () => pipeline as never,
    generateNotes: async () => {},
    keepAudio: () => false,
    restartDelayMs,
    encode: async () => {},
    finishDeadlineMs: 500,
  } as never);
  return { session, pipeline };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitDead = async (ms = 3000) => {
  const t0 = Date.now();
  while ([...pids].some(alive) && Date.now() - t0 < ms) await sleep(25);
  return [...pids].filter(alive);
};

afterAll(() => {
  for (const p of pids) if (alive(p)) process.kill(p, 'SIGKILL'); // limpeza do próprio teste
});

test('suspend/resume e reinícios em sequência (inclusive rajadas e parar no meio): ao parar, nenhum helper sobra vivo e nenhum frame entra depois', async () => {
  for (let round = 0; round < 12; round++) {
    const { session, pipeline } = await setup();
    await session.start({ title: `Orfãos ${round}`, trigger: 'manual' });
    await sleep(60);
    const ops = [
      () => session.suspend(),
      () => session.resume(),
      () => { session.suspend(); session.resume(); },
      () => (spawned.at(-1) as unknown as EventEmitter).emit('event', { event: 'error', source: 'sys', fatal: true, message: 'x' }), // fonte perdida com o processo vivo
      () => (spawned.at(-1) as unknown as { child: { kill(s: string): void } | null }).child?.kill('SIGKILL'), // helper morre sozinho
      () => session.switchMic(round % 2 ? 'uid-a' : undefined),
    ];
    for (let i = 0; i < 14; i++) {
      ops[(round * 7 + i * 3) % ops.length]!();
      await sleep((i * 13 + round * 5) % 40);
    }
    if (round % 3 === 0) session.resume(); // sem esperar o fim da rajada
    await session.stop();
    const framesAtStop = pipeline.frames;
    expect(await waitDead()).toEqual([]);
    await sleep(150);
    expect(pipeline.frames).toBe(framesAtStop); // nada chega depois de parar
  }
}, 120_000);
