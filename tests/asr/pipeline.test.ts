import { describe, expect, test, vi } from 'vitest';
import { AsrPipeline, type AsrStatus } from '../../src/main/asr/pipeline';
import type { VoiceDetector } from '../../src/main/asr/silero-vad';
import type { Transcriber } from '../../src/main/asr/whisper-server';
import type { AudioFrame } from '../../src/shared/frames';
import type { Segment } from '../../src/shared/types';

/** Testes anteriores à Plan 6: segmentação antiga fixada explicitamente e sem parciais. */
const LEGACY = {
  segmenter: { minSilenceMs: 500, shortSpeechMs: 2000, shortSilenceMs: 1000, maxSegmentMs: 10_000, padMs: 192 },
  partials: false,
};

/** VAD falso: fala = amplitude média alta. */
const loudDetector = (): VoiceDetector => ({
  reset() {},
  async probability(w) {
    let sum = 0;
    for (const v of w) sum += Math.abs(v);
    return sum / w.length > 0.1 ? 0.95 : 0.01;
  },
});

class FakeTranscriber implements Transcriber {
  calls = 0;
  restarts = 0;
  prompts: Array<string | undefined> = [];
  languages: Array<string | undefined> = [];
  constructor(private failures = 0, private reply: (n: number) => string = (n) => `texto ${n}`) {}
  async transcribe(wav: Buffer, opts?: { prompt?: string; language?: string }) {
    this.calls++;
    this.prompts.push(opts?.prompt);
    this.languages.push(opts?.language);
    if (this.failures > 0) {
      this.failures--;
      throw new Error('servidor caiu');
    }
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    return this.reply(this.calls);
  }
  async restart() {
    this.restarts++;
  }
}

/** Gera frames de 100 ms: `pattern` em segundos, true = fala (seno alto), false = silêncio. */
function frames(source: 'mic' | 'sys', pattern: Array<[seconds: number, speech: boolean]>, startMs = 0): AudioFrame[] {
  const out: AudioFrame[] = [];
  let t = startMs;
  for (const [seconds, speech] of pattern) {
    for (let f = 0; f < seconds * 10; f++) {
      const pcm = Buffer.alloc(3200);
      if (speech) for (let i = 0; i < 1600; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 4) * 12000), i * 2);
      out.push({ source, timestampMs: t, pcm });
      t += 100;
    }
  }
  return out;
}

function collect(p: AsrPipeline) {
  const segments: Segment[] = [];
  const statuses: AsrStatus[] = [];
  p.on('segment', (s) => segments.push(s));
  p.on('status', (s) => statuses.push(s));
  return { segments, statuses };
}

describe('AsrPipeline', () => {
  test('prompt de contexto: 2º trecho do canal recebe o texto do 1º; canais não se misturam', async () => {
    const t = new FakeTranscriber(0, (n) => `fala ${n}`);
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0] });
    const { segments } = collect(p);
    for (const f of frames('mic', [[1, false], [3, true], [2, false], [3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(segments.map((s) => s.text)).toEqual(['fala 1', 'fala 2']);
    expect(t.prompts).toEqual([undefined, 'fala 1']);

    const t2 = new FakeTranscriber(0, (n) => `fala ${n}`);
    const p2 = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t2, backoffMs: [0, 0, 0] });
    for (const f of frames('mic', [[1, false], [3, true], [2, false]])) p2.pushFrame(f);
    await p2.finish();
    for (const f of frames('sys', [[1, false], [3, true], [2, false]])) p2.pushFrame(f);
    await p2.finish();
    expect(t2.prompts).toEqual([undefined, undefined]);
  });

  test('vocabulário vai no começo do prompt de todo trecho, antes do contexto do falante', async () => {
    const t = new FakeTranscriber(0, (n) => `fala ${n}`);
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0], vocabulary: 'Uirapuru Tecnologia, OKR.' });
    for (const f of frames('mic', [[1, false], [3, true], [2, false], [3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(t.prompts).toEqual(['Uirapuru Tecnologia, OKR.', 'Uirapuru Tecnologia, OKR. fala 1']);
  });

  test('identificador de pessoas: só o canal do sistema vira "Pessoa N"; o microfone continua Eu; falha vira só "Outros"', async () => {
    const calls: number[] = [];
    const speakers = { identify: async (pcm: Buffer) => (calls.push(pcm.length), calls.length === 2 ? null : 2), close: async () => {} };
    const t = new FakeTranscriber(0, (n) => `fala ${n}`);
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0], speakers });
    const { segments } = collect(p);
    for (const f of frames('sys', [[1, false], [3, true], [2, false], [3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    for (const f of frames('mic', [[1, false], [3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(segments.map((s) => [s.source, s.speaker])).toEqual([['Outros', 2], ['Outros', undefined], ['Eu', undefined]]);
    expect(calls).toHaveLength(2); // o microfone nunca passa pelo identificador
  });

  test('prompt guarda só ~200 caracteres finais e alucinações não entram no contexto', async () => {
    const replies = ['a'.repeat(150), 'b'.repeat(150), 'Obrigado por assistir!', 'c'];
    const t = new FakeTranscriber(0, (n) => replies[n - 1]!);
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0] });
    const { segments } = collect(p);
    const pattern: Array<[number, boolean]> = [[1, false]];
    for (let i = 0; i < 4; i++) pattern.push([3, true], [2, false]);
    for (const f of frames('mic', pattern)) p.pushFrame(f);
    await p.finish();
    expect(segments.map((s) => s.text)).toEqual([replies[0], replies[1], 'c']);
    expect(t.prompts[1]).toBe(replies[0]);
    expect(t.prompts[2]).toBe(`${replies[0]} ${replies[1]}`.slice(-200));
    expect(t.prompts[2]).toHaveLength(200);
    expect(t.prompts[3]).toBe(t.prompts[2]);
  });

  test('o idioma configurado vai em toda transcrição (final e parcial); sem idioma vale pt', async () => {
    for (const [language, expected] of [[undefined, 'pt'], ['en', 'en'], ['auto', 'auto']] as const) {
      const t = new FakeTranscriber();
      const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0], ...(language ? { language } : {}) });
      collect(p);
      for (const f of frames('mic', [[1, false], [3, true], [2, false]])) p.pushFrame(f);
      await p.finish();
      expect(t.languages.length).toBeGreaterThan(0);
      expect(new Set(t.languages)).toEqual(new Set([expected]));
    }
  });

  test('fala no mic vira segmento "Eu" com tempos da gravação', async () => {
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: new FakeTranscriber(), backoffMs: [0, 0, 0] });
    const { segments, statuses } = collect(p);
    for (const f of frames('mic', [[1, false], [3, true], [2, false]], 5000)) p.pushFrame(f);
    await p.finish();
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ source: 'Eu', text: 'texto 1' });
    expect(segments[0]!.startMs).toBeGreaterThanOrEqual(5000 + 1000 - 200);
    expect(segments[0]!.startMs).toBeLessThanOrEqual(5000 + 1000);
    expect(segments[0]!.endMs).toBeGreaterThanOrEqual(5000 + 4000);
    expect(statuses.at(-1)).toEqual({ state: 'idle', queueSeconds: 0 });
  });

  test('canais independentes: mic → Eu, sys → Outros', async () => {
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: new FakeTranscriber(), backoffMs: [0, 0, 0] });
    const { segments } = collect(p);
    const mic = frames('mic', [[3, true], [2, false]]);
    const sys = frames('sys', [[1, false], [3, true], [2, false]]);
    for (let i = 0; i < Math.max(mic.length, sys.length); i++) {
      if (mic[i]) p.pushFrame(mic[i]!);
      if (sys[i]) p.pushFrame(sys[i]!);
    }
    await p.finish();
    expect(segments.map((s) => s.source).sort()).toEqual(['Eu', 'Outros']);
  });

  test('falhas temporárias reiniciam o servidor e reenviam o mesmo trecho', async () => {
    const t = new FakeTranscriber(2);
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0] });
    const { segments, statuses } = collect(p);
    for (const f of frames('mic', [[3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(t.restarts).toBe(2);
    expect(segments).toHaveLength(1);
    expect(statuses.some((s) => s.state === 'retrying')).toBe(true);
  });

  test('falha persistente vira failed, preserva a fila e retry() retoma', async () => {
    const t = new FakeTranscriber(4);
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0] });
    const { segments, statuses } = collect(p);
    for (const f of frames('mic', [[3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(segments).toEqual([]);
    expect(statuses.at(-1)).toMatchObject({ state: 'failed', error: 'servidor caiu' });
    expect(statuses.at(-1)!.queueSeconds).toBeGreaterThan(2);
    p.retry();
    await p.finish();
    expect(segments).toHaveLength(1);
    expect(statuses.at(-1)).toEqual({ state: 'idle', queueSeconds: 0 });
  });

  test('alucinação do Whisper não vira segmento', async () => {
    const p = new AsrPipeline({
      ...LEGACY,
      createDetector: loudDetector,
      transcriber: new FakeTranscriber(0, () => 'Legendas pela comunidade Amara.org'),
      backoffMs: [0, 0, 0],
    });
    const { segments } = collect(p);
    for (const f of frames('mic', [[3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(segments).toEqual([]);
  });

  test('segmentos saem na ordem em que os trechos fecharam', async () => {
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: new FakeTranscriber(), backoffMs: [0, 0, 0] });
    const { segments } = collect(p);
    for (const f of frames('mic', [[3, true], [1, false], [3, true], [2, false]])) p.pushFrame(f);
    await p.finish();
    expect(segments.map((s) => s.text)).toEqual(['texto 1', 'texto 2']);
    expect(segments[0]!.endMs).toBeLessThanOrEqual(segments[1]!.startMs);
  });

  test('erro do VAD vira warning único, sem estado failed, e a fala restante segue', async () => {
    let n = 0;
    const flaky = (): VoiceDetector => ({
      reset() {},
      async probability(w) {
        if (n++ % 50 === 7) throw new Error('onnx caiu');
        return loudDetector().probability(w);
      },
    });
    const p = new AsrPipeline({ ...LEGACY, createDetector: flaky, transcriber: new FakeTranscriber(), backoffMs: [0, 0, 0] });
    const { segments, statuses } = collect(p);
    const warnings: Array<{ source: string; message: string }> = [];
    p.on('warning', (w) => warnings.push(w));
    for (const f of frames('mic', [[1, false], [4, true], [2, false]], 1000)) p.pushFrame(f);
    await p.finish();
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(statuses.some((s) => s.state === 'failed')).toBe(false);
    expect(warnings).toEqual([{ source: 'mic', message: 'VAD: onnx caiu' }]);
    expect(segments[0]!.startMs).toBeGreaterThanOrEqual(1000 + 1000 - 200);
  });

  test('salto de timestamps (lacuna) reancora o segundo trecho', async () => {
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: new FakeTranscriber(), backoffMs: [0, 0, 0] });
    const { segments } = collect(p);
    for (const f of frames('mic', [[3, true], [2, false]], 0)) p.pushFrame(f);
    for (const f of frames('mic', [[3, true], [2, false]], 15_000)) p.pushFrame(f);
    await p.finish();
    expect(segments).toHaveLength(2);
    expect(segments[1]!.startMs).toBeGreaterThanOrEqual(15_000);
    expect(segments[1]!.endMs).toBeGreaterThanOrEqual(18_000);
  });

  test('timestamps que voltam a zero nunca fazem o tempo recuar', async () => {
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: new FakeTranscriber(), backoffMs: [0, 0, 0] });
    const { segments } = collect(p);
    for (const f of frames('mic', [[3, true], [2, false]], 0)) p.pushFrame(f);
    for (const f of frames('mic', [[3, true], [2, false]], 0)) p.pushFrame(f);
    await p.finish();
    expect(segments).toHaveLength(2);
    expect(segments[1]!.startMs).toBeGreaterThanOrEqual(segments[0]!.endMs);
    expect(segments[1]!.endMs).toBeGreaterThan(segments[1]!.startMs);
  });

  test('queueSeconds continua atualizado (com limite de 1/s) enquanto failed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: new FakeTranscriber(100), backoffMs: [0, 0, 0] });
      const { statuses } = collect(p);
      for (const f of frames('mic', [[3, true], [2, false]], 0)) p.pushFrame(f);
      await p.finish();
      const before = statuses.at(-1)!;
      expect(before.state).toBe('failed');
      vi.setSystemTime(Date.now() + 2000);
      for (const f of frames('mic', [[3, true], [2, false]], 5000)) p.pushFrame(f);
      await p.finish();
      const after = statuses.at(-1)!;
      expect(after.state).toBe('failed');
      expect(after.queueSeconds).toBeGreaterThan(before.queueSeconds);
    } finally {
      vi.useRealTimers();
    }
  });

  test('queueSeconds continua atualizado (limite de 1/s) enquanto transcreve um backlog', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let release: () => void = () => {};
      const gate = () => new Promise<void>((r) => (release = r));
      const slow: Transcriber = {
        async transcribe() {
          await gate();
          return 'texto';
        },
        async restart() {},
      };
      const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: slow, backoffMs: [0, 0, 0] });
      const { statuses } = collect(p);
      for (const f of frames('mic', [[3, true], [2, false]], 0)) p.pushFrame(f);
      await vi.waitFor(() => expect(statuses.some((s) => s.state === 'transcribing')).toBe(true));
      const first = statuses.find((s) => s.state === 'transcribing')!;
      vi.setSystemTime(Date.now() + 2000);
      for (const f of frames('mic', [[3, true], [2, false]], 5000)) p.pushFrame(f);
      await vi.waitFor(() => expect(statuses.at(-1)!.queueSeconds).toBeGreaterThan(first.queueSeconds));
      const done = p.finish();
      for (let i = 0; i < 5; i++) {
        release();
        await Promise.resolve();
      }
      await vi.waitFor(() => expect(statuses.at(-1)!.state).toBe('idle'));
      await done;
    } finally {
      vi.useRealTimers();
    }
  });

  test('listener de segment que lança não conta como falha de transcrição', async () => {
    const t = new FakeTranscriber();
    const p = new AsrPipeline({ ...LEGACY, createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0] });
    const { statuses } = collect(p);
    p.on('segment', () => {
      throw new Error('ouvinte ruim');
    });
    for (const f of frames('mic', [[3, true], [2, false]])) p.pushFrame(f);
    p.on('warning', () => {});
    await p.finish();
    expect(t.restarts).toBe(0);
    expect(statuses.some((s) => s.state === 'retrying')).toBe(false);
  });

  describe('parciais ao vivo', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    test('emite parciais do trecho aberto com o mesmo segmentId do final; transcriber lento, no máx. uma decodificação por vez', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      let n = 0;
      const slow: Transcriber = {
        async transcribe() {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(15);
          inFlight--;
          return `texto ${++n}`;
        },
        async restart() {},
      };
      const p = new AsrPipeline({ createDetector: loudDetector, transcriber: slow, backoffMs: [0, 0, 0] });
      const { segments } = collect(p);
      const partials: Array<{ source: string; segmentId: string; text: string; startMs: number }> = [];
      p.on('partial', (x) => partials.push(x));
      for (const f of frames('mic', [[1, false], [6, true], [2, false]])) {
        p.pushFrame(f);
        await sleep(5);
      }
      await p.finish();
      expect(segments).toHaveLength(1);
      expect(partials.length).toBeGreaterThanOrEqual(1);
      for (const x of partials) {
        expect(x.source).toBe('Eu');
        expect(x.segmentId).toBe(segments[0]!.segmentId);
        expect(x.text).toMatch(/^texto \d+$/);
        expect(x.startMs).toBeGreaterThanOrEqual(0);
      }
      expect(maxInFlight).toBe(1);
    });

    test('parciais não entram no contexto e texto vazio/alucinação não é emitido', async () => {
      const prompts: Array<string | undefined> = [];
      let partialCalls = 0;
      const t: Transcriber = {
        async transcribe(wav, opts) {
          if (wav.readInt16LE(wav.length - 2) !== 0) partialCalls++;
          prompts.push(opts?.prompt);
          // parcial termina em fala; o final termina no silêncio de margem (amostras zero)
          return wav.readInt16LE(wav.length - 2) !== 0 ? 'Obrigado por assistir!' : 'final';
        },
        async restart() {},
      };
      const p = new AsrPipeline({ createDetector: loudDetector, transcriber: t, backoffMs: [0, 0, 0] });
      const { segments } = collect(p);
      const partials: unknown[] = [];
      p.on('partial', (x) => partials.push(x));
      for (const f of frames('mic', [[1, false], [6, true], [2, false], [6, true], [2, false]])) {
        p.pushFrame(f);
        await sleep(2);
      }
      await p.finish();
      expect(partialCalls).toBeGreaterThan(0);
      expect(partials).toEqual([]);
      expect(segments.map((s) => s.text)).toEqual(['final', 'final']);
      // prompt do 2º final = só o texto do 1º final; parciais (alucinação) nunca entram
      expect(prompts.filter((x) => x !== undefined)).not.toContain('Obrigado por assistir!');
    });

    test('final tem prioridade sobre parcial pendente e parcial de trecho fechado é descartado', async () => {
      const resolvers: Array<() => void> = [];
      let auto = false;
      const gated: Transcriber = {
        async transcribe() {
          if (!auto) await new Promise<void>((r) => resolvers.push(r));
          return 'x';
        },
        async restart() {},
      };
      const p = new AsrPipeline({ createDetector: loudDetector, transcriber: gated, backoffMs: [0, 0, 0] });
      const events: string[] = [];
      p.on('partial', (x) => events.push(`partial:${x.source}`));
      p.on('segment', (x) => events.push(`final:${x.source}`));
      // 1) parcial de 'Outros' fica em decodificação (bloqueado)
      for (const f of frames('sys', [[2, true]])) p.pushFrame(f);
      await vi.waitFor(() => expect(resolvers).toHaveLength(1));
      // 2) parcial de 'Eu' entra na fila, esperando
      for (const f of frames('mic', [[2, true]])) p.pushFrame(f);
      await sleep(30);
      // 3) trecho de 'Outros' fecha: o final entra na fila
      for (const f of frames('sys', [[1.5, false]], 2000)) p.pushFrame(f);
      await sleep(30);
      auto = true;
      resolvers.shift()!();
      await vi.waitFor(() => expect(events).toContain('final:Outros'));
      await p.finish();
      // parcial bloqueado era de trecho que fechou: descartado; final vem antes do parcial pendente de 'Eu'
      expect(events[0]).toBe('final:Outros');
      expect(events).not.toContain('partial:Outros');
    });
  });
});
