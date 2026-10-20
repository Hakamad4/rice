import { afterEach, describe, expect, test, vi } from 'vitest';
import { AsrPipeline, PARTIAL_DUTY, PARTIAL_MAX_GAP_MS } from '../../src/main/asr/pipeline';
import type { VoiceDetector } from '../../src/main/asr/silero-vad';
import type { Transcriber } from '../../src/main/asr/whisper-server';
import type { AudioFrame } from '../../src/shared/frames';
import type { Segment } from '../../src/shared/types';

afterEach(() => vi.useRealTimers());

const loudDetector = (): VoiceDetector => ({
  reset() {},
  async probability(w) {
    let sum = 0;
    for (const v of w) sum += Math.abs(v);
    return sum / w.length > 0.1 ? 0.95 : 0.01;
  },
});

const frame = (t: number, speech: boolean): AudioFrame => {
  const pcm = Buffer.alloc(3200);
  if (speech) for (let i = 0; i < 1600; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 4) * 12000), i * 2);
  return { source: 'sys', timestampMs: t, pcm };
};
const settle = () => new Promise<void>((r) => setImmediate(r));

/**
 * Relógio falso só para Date: cada frame de 100 ms avança o relógio 100 ms e cada chamada ao whisper "custa" `costMs` nele (como o
 * tempo real de decodificação). Devolve quantas chamadas parciais e quantos finais houve.
 */
async function run(speechSeconds: number, costMs: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 17, 10, 0, 0));
  const calls: Array<{ at: number; bytes: number }> = [];
  const transcriber: Transcriber = {
    async transcribe(wav) {
      calls.push({ at: Date.now(), bytes: wav.length });
      vi.setSystemTime(Date.now() + costMs);
      return `chamada ${calls.length}`;
    },
    async restart() {},
  };
  const pipeline = new AsrPipeline({ createDetector: loudDetector, transcriber, backoffMs: [0, 0, 0] });
  const segments: Segment[] = [];
  pipeline.on('segment', (s) => segments.push(s));
  let t = 0;
  for (let i = 0; i < 10; i++, t += 100) pipeline.pushFrame(frame(t, false)); // pré-roll
  for (let i = 0; i < speechSeconds * 10; i++, t += 100) {
    pipeline.pushFrame(frame(t, true));
    vi.setSystemTime(Date.now() + 100);
    await settle();
  }
  for (let i = 0; i < 20; i++, t += 100) {
    pipeline.pushFrame(frame(t, false));
    vi.setSystemTime(Date.now() + 100);
    await settle();
  }
  await pipeline.finish();
  // a última chamada é a do trecho final (as anteriores são parciais)
  return { calls, partialStarts: calls.slice(0, -1).map((c) => c.at), final: calls.at(-1)!, segments };
}

describe('parciais com teto de ocupação do whisper', () => {
  test('fala contínua de 20 s com parcial de 1,2 s: no máximo ~um parcial a cada 4 s (antes: um a cada ~1 s, whisper ~96% ocupado)', async () => {
    const { partialStarts, segments, final, calls } = await run(20, 1200);
    expect(partialStarts.length).toBeGreaterThanOrEqual(4); // continua atualizando na tela
    expect(partialStarts.length).toBeLessThanOrEqual(9); // sem o teto seriam ~19
    for (let i = 1; i < partialStarts.length; i++) {
      const gap = partialStarts[i]! - partialStarts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(1200 * (1 / PARTIAL_DUTY - 1) - 1); // o intervalo cresce com o custo de cada parcial
      expect(gap).toBeLessThanOrEqual(1200 + PARTIAL_MAX_GAP_MS + 1500); // e continua dentro do prazo em que o parcial expira na tela (6 s)
    }
    expect(segments).toHaveLength(1); // o trecho FINAL é o mesmo: uma frase, transcrita inteira
    expect(segments[0]!.text).toBe(`chamada ${calls.length}`);
    expect(final.bytes).toBeGreaterThanOrEqual(20 * 32000); // o final leva os 20 s inteiros (não só a cauda nova)
  });

  test('parcial barato (50 ms) não é segurado além da cadência de ~1 s', async () => {
    const { partialStarts } = await run(10, 50);
    expect(partialStarts.length).toBeGreaterThanOrEqual(6);
  });

  test('o teto vale para os dois canais juntos (um whisper só)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 17, 10, 0, 0));
    const starts: number[] = [];
    const transcriber: Transcriber = {
      async transcribe() {
        starts.push(Date.now());
        vi.setSystemTime(Date.now() + 1200);
        return 'texto';
      },
      async restart() {},
    };
    const pipeline = new AsrPipeline({ createDetector: loudDetector, transcriber, backoffMs: [0, 0, 0] });
    let t = 0;
    for (let i = 0; i < 100; i++, t += 100) {
      pipeline.pushFrame({ ...frame(t, true), source: 'mic' });
      pipeline.pushFrame({ ...frame(t, true), source: 'sys' });
      vi.setSystemTime(Date.now() + 100);
      await settle();
    }
    await pipeline.finish();
    expect(starts.length - 2).toBeLessThanOrEqual(5); // 10 s de fala em dois canais (menos os 2 finais): sem teto seriam ~18
  });
});
