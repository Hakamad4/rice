export type SegmenterOptions = {
  threshold: number;
  negThreshold: number;
  minSilenceMs: number;
  shortSpeechMs: number;
  shortSilenceMs: number;
  maxSegmentMs: number;
  minSpeechMs: number;
  padMs: number;
};

export const DEFAULT_SEGMENTER_OPTIONS: SegmenterOptions = {
  threshold: 0.5,
  negThreshold: 0.35,
  // Padrões: silêncio único de 800 ms (25 janelas), pré-roll de 256 ms (8 janelas), máximo de 25 s.
  minSilenceMs: 800,
  // shortSpeechMs 0 desliga a regra "fala curta exige silêncio maior" (os campos continuam para testes explícitos).
  shortSpeechMs: 0,
  shortSilenceMs: 1000,
  maxSegmentMs: 25_000,
  minSpeechMs: 300,
  padMs: 256,
};

export type SpeechChunk = { startSample: number; endSample: number; pcm: Int16Array };

const WINDOW = 512;
const WINDOW_MS = 32;

function concat(windows: Int16Array[]): Int16Array {
  const out = new Int16Array(windows.length * WINDOW);
  windows.forEach((w, i) => out.set(w, i * WINDOW));
  return out;
}

export class SpeechSegmenter {
  private readonly options: SegmenterOptions;
  private readonly padWindows: number;
  private windowIndex = 0;
  private preRoll: Int16Array[] = [];
  private current: Int16Array[] = [];
  private currentStartWindow = 0;
  /** Fala do trecho atual (usada no filtro minSpeechMs). */
  private speechWindows = 0;
  /** Fala da frase inteira; não zera em corte forçado (usada para escolher o silêncio de fim). */
  private utteranceSpeechWindows = 0;
  private silenceRun = 0;
  private inSpeech = false;
  /** O trecho atual é continuação de um corte forçado: só é descartado se não tiver nenhuma janela de fala. */
  private continuation = false;

  constructor(options: Partial<SegmenterOptions> = {}) {
    this.options = { ...DEFAULT_SEGMENTER_OPTIONS, ...options };
    this.padWindows = Math.round(this.options.padMs / WINDOW_MS);
  }

  push(window: Int16Array, probability: number): SpeechChunk[] {
    if (window.length !== WINDOW) throw new Error(`janela deve ter ${WINDOW} amostras`);
    const frame = window.slice();
    const index = this.windowIndex++;
    const out: SpeechChunk[] = [];

    if (!this.inSpeech) {
      if (probability >= this.options.threshold) {
        this.inSpeech = true;
        this.current = [...this.preRoll, frame];
        this.currentStartWindow = index - this.preRoll.length;
        this.preRoll = [];
        this.speechWindows = 1;
        this.utteranceSpeechWindows = 1;
        this.silenceRun = 0;
        this.continuation = false;
      } else {
        this.preRoll.push(frame);
        if (this.preRoll.length > this.padWindows) this.preRoll.shift();
      }
      return out;
    }

    this.current.push(frame);
    if (probability < this.options.negThreshold) {
      this.silenceRun++;
    } else {
      this.silenceRun = 0;
      this.speechWindows++;
      this.utteranceSpeechWindows++;
    }

    const speechMs = this.utteranceSpeechWindows * WINDOW_MS;
    const silenceLimit = speechMs < this.options.shortSpeechMs ? this.options.shortSilenceMs : this.options.minSilenceMs;

    if (this.silenceRun * WINDOW_MS >= silenceLimit) {
      const trailing = this.trimTrailingSilence();
      const chunk = this.close();
      if (chunk) out.push(chunk);
      this.utteranceSpeechWindows = 0;
      this.continuation = false;
      this.preRoll = this.padWindows > 0 ? trailing.slice(-this.padWindows) : [];
    } else if (this.current.length * WINDOW_MS >= this.options.maxSegmentMs) {
      const chunk = this.close();
      if (chunk) out.push(chunk);
      // A fala continua: o próximo trecho começa na janela seguinte, sem margem (contíguo).
      this.inSpeech = true;
      this.continuation = true;
      this.currentStartWindow = index + 1;
    }
    return out;
  }

  /** Há um trecho aberto (fala em andamento)? */
  get isOpen(): boolean {
    return this.inSpeech;
  }

  /** Janelas de fala do trecho aberto (0 se não houver). */
  get openSpeechWindows(): number {
    return this.inSpeech ? this.speechWindows : 0;
  }

  /** Áudio do trecho aberto (pré-roll incluído), sem fechá-lo; usado para parciais. */
  peekOpen(): { startSample: number; pcm: Int16Array } | null {
    if (!this.inSpeech || this.current.length === 0) return null;
    return { startSample: this.currentStartWindow * WINDOW, pcm: concat(this.current) };
  }

  flush(): SpeechChunk[] {
    if (!this.inSpeech) return [];
    this.trimTrailingSilence();
    const chunk = this.close();
    this.preRoll = [];
    this.utteranceSpeechWindows = 0;
    this.continuation = false;
    return chunk ? [chunk] : [];
  }

  /** Mantém `padWindows` do silêncio final no trecho e devolve as janelas removidas. */
  private trimTrailingSilence(): Int16Array[] {
    const keep = this.current.length - this.silenceRun + Math.min(this.padWindows, this.silenceRun);
    const removed = this.current.slice(keep);
    this.current = this.current.slice(0, keep);
    return removed;
  }

  private close(): SpeechChunk | null {
    const windows = this.current;
    const speechWindows = this.speechWindows;
    const speechMs = speechWindows * WINDOW_MS;
    this.inSpeech = false;
    this.current = [];
    this.speechWindows = 0;
    this.silenceRun = 0;
    // Continuação de corte forçado nunca é descartada por duração, só se não tiver nenhuma fala.
    const tooShort = this.continuation ? speechWindows === 0 : speechMs < this.options.minSpeechMs;
    if (windows.length === 0 || tooShort) return null;
    const pcm = concat(windows);
    const startSample = this.currentStartWindow * WINDOW;
    return { startSample, endSample: startSample + pcm.length, pcm };
  }
}
