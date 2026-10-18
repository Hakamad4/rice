import { afterEach, describe, expect, test, vi } from 'vitest';
import { AsrPipeline } from '../../src/main/asr/pipeline';
import { partialsWanted } from '../../src/main/asr/partials-gate';
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

/** Fala contínua de `speechSeconds`; `onSecond(i)` roda antes de cada segundo (para virar a janela oculta/visível no meio). */
async function run(speechSeconds: number, wanted: () => boolean, onSecond: (second: number) => void = () => {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0, 0));
  const calls: Array<{ at: number; bytes: number }> = [];
  const transcriber: Transcriber = {
    async transcribe(wav) {
      calls.push({ at: Date.now(), bytes: wav.length });
      vi.setSystemTime(Date.now() + 300);
      return `texto de ${wav.length} bytes`;
    },
    async restart() {},
  };
  const pipeline = new AsrPipeline({ createDetector: loudDetector, transcriber, backoffMs: [0, 0, 0], partialsWanted: wanted });
  const segments: Segment[] = [];
  const partials: Array<{ at: number }> = [];
  pipeline.on('segment', (s) => segments.push(s));
  pipeline.on('partial', () => partials.push({ at: Date.now() }));
  let t = 0;
  for (let i = 0; i < 10; i++, t += 100) pipeline.pushFrame(frame(t, false));
  for (let i = 0; i < speechSeconds * 10; i++, t += 100) {
    if (i % 10 === 0) onSecond(i / 10);
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
  return { calls, segments, partials };
}

describe('parciais pausam com a janela oculta', () => {
  test('visível: parciais acontecem (linha de base)', async () => {
    const { partials } = await run(10, () => true);
    expect(partials.length).toBeGreaterThanOrEqual(2);
  });

  test('oculta durante toda a fala: nenhum parcial, só a chamada do trecho final', async () => {
    const { calls, partials, segments } = await run(10, () => false);
    expect(partials).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(segments).toHaveLength(1);
  });

  test('o trecho final é idêntico com a janela oculta e visível (mesmo áudio, mesmo texto, mesmo tempo)', async () => {
    const visible = await run(12, () => true);
    const hidden = await run(12, () => false);
    expect(hidden.segments.map((s) => [s.text, s.startMs, s.endMs])).toEqual(visible.segments.map((s) => [s.text, s.startMs, s.endMs]));
    expect(hidden.calls.at(-1)!.bytes).toBe(visible.calls.at(-1)!.bytes);
  });

  test('ao voltar a ficar visível os parciais retomam na hora (sem esperar o próximo ciclo)', async () => {
    let hidden = true;
    let backAt = 0;
    const { partials } = await run(14, () => !hidden, (second) => {
      if (second === 8) {
        hidden = false;
        backAt = Date.now();
      }
    });
    expect(backAt).toBeGreaterThan(0);
    expect(partials.filter((p) => p.at < backAt)).toHaveLength(0); // oculta: nenhum
    const first = partials.find((p) => p.at >= backAt);
    expect(first).toBeDefined();
    expect(first!.at - backAt).toBeLessThanOrEqual(1000); // volta no primeiro parcial, não depois de um intervalo cheio
  });

  test('oculta no meio da fala: para de pedir parciais e o final continua inteiro', async () => {
    let hidden = false;
    let hiddenAt = 0;
    const { partials, segments, calls } = await run(14, () => !hidden, (second) => {
      if (second === 6) {
        hidden = true;
        hiddenAt = Date.now();
      }
    });
    expect(partials.some((p) => p.at < hiddenAt)).toBe(true);
    expect(partials.filter((p) => p.at > hiddenAt + 1000)).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(calls.at(-1)!.bytes).toBeGreaterThanOrEqual(14 * 32000); // final com os 14 s inteiros
  });
});

describe('quem vê parciais', () => {
  test('janela visível, ou painel expandido do nub mesmo com a janela oculta', () => {
    expect(partialsWanted(true, false)).toBe(true);
    expect(partialsWanted(false, true)).toBe(true); // nub expandido mantém
    expect(partialsWanted(false, false)).toBe(false);
  });

  test('com o nub expandido a janela oculta não pausa os parciais (porta ligada ao gate real)', async () => {
    const { partials } = await run(10, () => partialsWanted(false, true));
    expect(partials.length).toBeGreaterThanOrEqual(2);
  });
});
