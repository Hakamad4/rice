import { describe, expect, test } from 'vitest';
import { SpeechSegmenter, type SpeechChunk } from '../../src/main/asr/segmenter';

const W = 512;
/** Valores antigos (anteriores), fixados explicitamente nos testes de comportamento legado. */
const OLD = { minSilenceMs: 500, shortSpeechMs: 2000, shortSilenceMs: 1000, maxSegmentMs: 10_000, padMs: 192 };
type Step = [count: number, probability: number];

function feed(steps: Step[], seg = new SpeechSegmenter(OLD)): { chunks: SpeechChunk[]; seg: SpeechSegmenter } {
  const chunks: SpeechChunk[] = [];
  let index = 0;
  for (const [count, p] of steps) {
    for (let i = 0; i < count; i++) {
      chunks.push(...seg.push(new Int16Array(W).fill(index % 30000), p));
      index++;
    }
  }
  return { chunks, seg };
}

/** Números das janelas contidas no trecho. */
const windowsOf = (c: SpeechChunk) => Array.from({ length: c.pcm.length / W }, (_, i) => c.pcm[i * W]!);
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe('SpeechSegmenter', () => {
  test('fala de 3 s entre silêncios vira um trecho com 6 janelas de margem', () => {
    const { chunks } = feed([[31, 0], [94, 0.9], [40, 0]]);
    expect(chunks).toHaveLength(1);
    expect(windowsOf(chunks[0]!)).toEqual(range(25, 6 + 94 + 6));
    expect(chunks[0]!.startSample).toBe(25 * W);
    expect(chunks[0]!.endSample).toBe((25 + 106) * W);
  });

  test('fala longa + 700 ms de pausa + fala longa = dois trechos', () => {
    const { chunks } = feed([[10, 0], [94, 0.9], [22, 0], [94, 0.9], [40, 0]]);
    expect(chunks).toHaveLength(2);
  });

  test('frase curta seguida de pausa de 1 s junta com a próxima', () => {
    const { chunks } = feed([[10, 0], [31, 0.9], [31, 0], [31, 0.9], [63, 0]]);
    expect(chunks).toHaveLength(1);
    expect(windowsOf(chunks[0]!)[0]).toBe(4);
  });

  test('clique de 160 ms é descartado', () => {
    const { chunks, seg } = feed([[10, 0], [5, 0.9], [63, 0]]);
    expect(chunks).toEqual([]);
    expect(seg.flush()).toEqual([]);
  });

  test('probabilidade intermediária mantém a fala (histerese)', () => {
    const { chunks } = feed([[10, 0], [31, 0.9], [31, 0.4], [63, 0]]);
    expect(chunks).toHaveLength(1);
    expect(windowsOf(chunks[0]!)).toEqual(range(4, 6 + 31 + 31 + 6));
  });

  test('65 s de fala contínua viram trechos de até 30 s, contíguos', () => {
    const { chunks, seg } = feed([[2, 0], [2032, 0.9]], new SpeechSegmenter({ ...OLD, maxSegmentMs: 30_000 }));
    chunks.push(...seg.flush());
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.pcm.length).toBeLessThanOrEqual(Math.ceil(30_000 / 32) * W);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.startSample).toBe(chunks[i - 1]!.endSample);
    const total = chunks.reduce((n, c) => n + c.pcm.length, 0);
    expect(total).toBe((2 + 2032) * W);
  });

  test('25 s de fala contínua viram trechos de até 10 s (padrão)', () => {
    const { chunks, seg } = feed([[2, 0], [782, 0.9]]);
    chunks.push(...seg.flush());
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.pcm.length / 16).toBeLessThanOrEqual(10_016);
  });

  test('flush durante a fala devolve o trecho aberto', () => {
    const { chunks, seg } = feed([[10, 0], [40, 0.9]]);
    expect(chunks).toEqual([]);
    const rest = seg.flush();
    expect(rest).toHaveLength(1);
    expect(windowsOf(rest[0]!)).toEqual(range(4, 6 + 40));
  });

  test('corte forçado seguido de fala curta não perde a continuação', () => {
    const { chunks } = feed([[938, 0.9], [5, 0.9], [63, 0]], new SpeechSegmenter({ ...OLD, maxSegmentMs: 30_000, minSilenceMs: 600 }));
    expect(chunks).toHaveLength(2);
    const [first, last] = chunks as [SpeechChunk, SpeechChunk];
    expect(first.pcm.length).toBe(938 * W);
    expect(last.startSample).toBe(first.endSample);
    // 943 janelas de fala (938 + 5) + 6 de margem final.
    const total = chunks.reduce((n, c) => n + c.pcm.length, 0);
    expect(total).toBe((943 + 6) * W);
  });

  test('corte forçado exatamente no fim da fala não gera trecho só de silêncio', () => {
    const { chunks, seg } = feed([[938, 0.9], [63, 0]], new SpeechSegmenter({ ...OLD, maxSegmentMs: 30_000, minSilenceMs: 600 }));
    chunks.push(...seg.flush());
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pcm.length).toBe(938 * W);
  });

  test('após corte forçado, a continuação fecha com 600 ms de silêncio', () => {
    const seg = new SpeechSegmenter({ ...OLD, maxSegmentMs: 30_000, minSilenceMs: 600 });
    let closedAt = -1;
    let index = 0;
    const steps: Step[] = [[938, 0.9], [5, 0.9], [63, 0]];
    for (const [count, p] of steps) {
      for (let i = 0; i < count; i++) {
        const out = seg.push(new Int16Array(W).fill(index % 30000), p);
        if (out.some((c) => c.startSample === 938 * W)) closedAt = index;
        index++;
      }
    }
    // Silêncio começa na janela 943; 19 janelas (600 ms) fecham o trecho na janela 961.
    expect(closedAt).toBe(943 + 18);
  });

  test('pré-rolagem curta: começa na primeira janela disponível', () => {
    const { chunks } = feed([[2, 0], [94, 0.9], [40, 0]]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startSample).toBe(0);
    expect(windowsOf(chunks[0]!)).toEqual(range(0, 2 + 94 + 6));
  });

  test('duas frases separadas por 800 ms ficam em trechos distintos, sem sobreposição', () => {
    const { chunks } = feed([[10, 0], [94, 0.9], [25, 0], [94, 0.9], [40, 0]]);
    expect(chunks).toHaveLength(2);
    const [a, b] = chunks as [SpeechChunk, SpeechChunk];
    // Segunda fala começa na janela 129; a margem de 6 janelas começa na 123.
    expect(b.startSample).toBe((10 + 94 + 25 - 6) * W);
    expect(a.endSample).toBeLessThanOrEqual(b.startSample);
  });

  describe('padrões atuais', () => {
    test('25 s de fala contínua viram um trecho de até 25 016 ms', () => {
      const { chunks, seg } = feed([[781, 0.9]], new SpeechSegmenter());
      chunks.push(...seg.flush());
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.pcm.length / 16).toBeLessThanOrEqual(25_016);
    });

    test('pausa de exatamente 800 ms (25 janelas) fecha o trecho; 24 janelas não', () => {
      const closes = (silence: number) => {
        const { chunks } = feed([[10, 0], [10, 0.9], [silence, 0]], new SpeechSegmenter());
        return chunks.length;
      };
      expect(closes(24)).toBe(0);
      expect(closes(25)).toBe(1);
    });

    test('fala curta usa o mesmo silêncio de 800 ms (sem regra de fala curta)', () => {
      const { chunks } = feed([[10, 0], [31, 0.9], [25, 0], [31, 0.9], [40, 0]], new SpeechSegmenter());
      expect(chunks).toHaveLength(2);
    });

    test('pré-roll de 8 janelas (256 ms)', () => {
      const { chunks } = feed([[20, 0], [40, 0.9], [40, 0]], new SpeechSegmenter());
      expect(chunks[0]!.startSample).toBe(12 * W);
    });
  });

  describe('peekOpen', () => {
    test('null sem fala; devolve pré-roll + fala sem fechar o trecho', () => {
      const seg = new SpeechSegmenter();
      expect(seg.peekOpen()).toBeNull();
      feed([[10, 0], [20, 0.9]], seg);
      const open = seg.peekOpen()!;
      expect(open.startSample).toBe(2 * W);
      expect(open.pcm.length).toBe((8 + 20) * W);
      expect(seg.openSpeechWindows).toBe(20);
      expect(seg.flush()).toHaveLength(1);
      expect(seg.peekOpen()).toBeNull();
    });
  });
});
