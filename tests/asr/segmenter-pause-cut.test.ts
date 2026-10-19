import { afterEach, describe, expect, test, vi } from 'vitest';
import { AsrPipeline } from '../../src/main/asr/pipeline';
import { SpeechSegmenter, type SpeechChunk } from '../../src/main/asr/segmenter';
import type { VoiceDetector } from '../../src/main/asr/silero-vad';
import type { Transcriber } from '../../src/main/asr/whisper-server';
import type { AudioFrame } from '../../src/shared/frames';
import type { Segment } from '../../src/shared/types';

afterEach(() => vi.useRealTimers());

const W = 512;
// teto de 10 s (313 janelas) e busca de 4 s (125 janelas) para os testes ficarem curtos; o resto é o padrão
const SHORT = { maxSegmentMs: 10_000, cutLookbackMs: 4000 };
type Step = [count: number, probability: number];

function feed(steps: Step[], options: ConstructorParameters<typeof SpeechSegmenter>[0] = SHORT) {
  const seg = new SpeechSegmenter(options);
  const chunks: SpeechChunk[] = [];
  let index = 0;
  for (const [count, p] of steps) {
    for (let i = 0; i < count; i++) chunks.push(...seg.push(new Int16Array(W).fill(index++ % 30000), p));
  }
  return { seg, chunks };
}
const windowsOf = (c: SpeechChunk) => Array.from({ length: c.pcm.length / W }, (_, i) => c.pcm[i * W]!);
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe('corte no melhor respiro ao atingir o teto', () => {
  test('corta no meio do respiro e carrega as janelas seguintes para o próximo trecho', () => {
    // 313 janelas = teto de 10 s; respiro de 5 janelas em 250..254 (meio = 252)
    const { chunks, seg } = feed([[250, 0.9], [5, 0.1], [58, 0.9]]);
    expect(chunks).toHaveLength(1);
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 252));
    expect(chunks[0]!.startSample).toBe(0);
    expect(chunks[0]!.endSample).toBe(252 * W);
    // o trecho aberto continua: começa exatamente onde o anterior terminou, com o áudio já recebido
    expect(seg.isOpen).toBe(true);
    const open = seg.peekOpen()!;
    expect(open.startSample).toBe(252 * W);
    expect(Array.from({ length: open.pcm.length / W }, (_, i) => open.pcm[i * W]!)).toEqual(range(252, 61));
    expect(seg.openSpeechWindows).toBe(58); // as 3 janelas de respiro que passaram para o próximo trecho (prob 0,1) não contam como fala
  });

  test('empate de respiros: o mais tarde', () => {
    const { chunks } = feed([[200, 0.9], [5, 0.1], [55, 0.9], [5, 0.1], [48, 0.9]]); // 313 janelas; respiros em 200 e 260
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 262));
  });

  test('o respiro mais longo vence, mesmo mais cedo', () => {
    const { chunks } = feed([[200, 0.9], [8, 0.1], [62, 0.9], [4, 0.1], [39, 0.9]]);
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 204)); // meio do respiro de 8 (200..207)
  });

  test('sem respiro na janela de busca: corte duro no teto, como antes', () => {
    const { chunks, seg } = feed([[100, 0.9], [5, 0.1], [208, 0.9]]); // o respiro (100) fica fora dos últimos 4 s
    expect(chunks).toHaveLength(1);
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 313));
    expect(seg.isOpen).toBe(true);
    expect(seg.peekOpen()).toBeNull(); // o próximo trecho começa na janela seguinte
  });

  test('respiro curto demais (2 janelas) não conta', () => {
    const { chunks } = feed([[200, 0.9], [2, 0.1], [111, 0.9]]);
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 313));
  });

  test('cutLookbackMs 0 desliga: corte duro mesmo com respiro', () => {
    const { chunks } = feed([[250, 0.9], [5, 0.1], [58, 0.9]], { ...SHORT, cutLookbackMs: 0 });
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 313));
  });

  test('fala com pausas naturais (>= 800 ms) sai idêntica a antes: o novo corte nem é usado', () => {
    const steps: Step[] = [[10, 0], [500, 0.9], [3, 0.1], [200, 0.9], [40, 0], [500, 0.9], [40, 0], [300, 0.9], [60, 0]];
    const withCut = feed(steps, {});
    const old = feed(steps, { cutLookbackMs: 0 });
    expect(withCut.chunks).toHaveLength(3);
    expect(withCut.chunks.map((c) => [c.startSample, c.endSample, windowsOf(c)])).toEqual(old.chunks.map((c) => [c.startSample, c.endSample, windowsOf(c)]));
  });

  test('3000 janelas de fala com respiros de 4 janelas: cobertura contígua, sem perder nem duplicar, trechos <= teto', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 33; i++) steps.push([86, 0.9], [4, 0.1]);
    steps.push([30, 0.9]);
    const total = 33 * 90 + 30;
    const { chunks, seg } = feed(steps, {});
    chunks.push(...seg.flush());
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.flatMap(windowsOf)).toEqual(range(0, total));
    for (let i = 0; i + 1 < chunks.length; i++) expect(chunks[i]!.endSample).toBe(chunks[i + 1]!.startSample);
    for (const c of chunks) expect(c.pcm.length / W).toBeLessThanOrEqual(Math.ceil(25_000 / 32));
  });
});

describe('no pipeline: id do trecho e linha do tempo', () => {
  const loud = (): VoiceDetector => ({
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

  test('30 s de fala com um respiro de 300 ms aos 20 s: dois finais contíguos, ids distintos, áudio todo transcrito uma vez', async () => {
    const bytes: number[] = [];
    const transcriber: Transcriber = {
      async transcribe(wav) {
        bytes.push(wav.length - 44);
        return `trecho ${bytes.length}`;
      },
      async restart() {},
    };
    const pipeline = new AsrPipeline({ createDetector: loud, transcriber, partials: false, backoffMs: [0, 0, 0] });
    const segments: Segment[] = [];
    pipeline.on('segment', (s) => segments.push(s));
    for (let i = 0; i < 300; i++) {
      pipeline.pushFrame(frame(i * 100, !(i >= 200 && i < 203)));
      await settle();
    }
    for (let i = 300; i < 330; i++) pipeline.pushFrame(frame(i * 100, false));
    await pipeline.finish();
    expect(segments).toHaveLength(2);
    expect(segments[0]!.endMs).toBe(segments[1]!.startMs); // contíguos
    expect(segments[0]!.endMs).toBeGreaterThan(20_000);
    expect(segments[0]!.endMs).toBeLessThan(20_400); // cortou no respiro, não aos 25 s
    expect(segments[0]!.segmentId).not.toBe(segments[1]!.segmentId);
    const seconds = bytes.reduce((a, b) => a + b, 0) / 32000;
    expect(seconds).toBeGreaterThan(29.9);
    expect(seconds).toBeLessThan(30.6); // 30 s de fala + margens; nada duplicado
  });
});
