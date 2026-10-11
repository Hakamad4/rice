import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AudioFrame, AudioSource } from '../../shared/frames';
import type { Segment, Speaker } from '../../shared/types';
import { pcmToWav } from '../../shared/wav';
import { cleanTranscript } from './hallucinations';
import type { SpeakerIdentifier } from './speaker-identifier';
import { SpeechSegmenter, type SegmenterOptions, type SpeechChunk } from './segmenter';
import { int16ToFloat32, VAD_WINDOW, type VoiceDetector } from './silero-vad';
import type { Transcriber } from './whisper-server';

export type AsrStatus = {
  state: 'idle' | 'transcribing' | 'retrying' | 'failed';
  queueSeconds: number;
  error?: string;
};

export type PartialSegment = { source: Speaker; segmentId: string; text: string; startMs: number };

export type AsrPipelineOptions = {
  /** Idioma falado (padrão `pt`); vai em cada requisição ao whisper. */
  language?: 'pt' | 'en' | 'auto';
  /** Vocabulário já em forma de prompt (`whisperVocabularyPrompt`): vai no começo do prompt de todo trecho. */
  vocabulary?: string;
  /** Separa "Outros" em pessoas (beta); sem isto, todo trecho do sistema continua "Outros". */
  speakers?: SpeakerIdentifier;
  createDetector: () => VoiceDetector;
  transcriber: Transcriber;
  backoffMs?: number[];
  segmenter?: Partial<SegmenterOptions>;
  /** Parciais ao vivo (padrão: ligado). */
  partials?: boolean;
};

type Channel = {
  source: AudioSource;
  speaker: Speaker;
  detector: VoiceDetector;
  segmenter: SpeechSegmenter;
  /** Amostra absoluta em que o segmenter atual começou (ele é recriado a cada lacuna). */
  segBase: number;
  leftover: Int16Array;
  /** Janelas de VAD já consumidas (índice de amostra do segmenter = windows * VAD_WINDOW). */
  windows: number;
  /** Âncoras (amostra do segmenter -> tempo da gravação), ordenadas por amostra. */
  anchors: Array<{ sample: number; ms: number }>;
  expectedRawMs: number | null;
  offsetMs: number;
  warned: boolean;
  chain: Promise<void>;
  /** Id do trecho aberto no segmenter (compartilhado entre parciais e o segmento final). */
  openId: string | null;
  /** Janelas vistas desde o último parcial agendado do trecho aberto. */
  windowsSincePartial: number;
  /** Há um parcial deste canal na fila ou em decodificação (no máximo um). */
  partialBusy: boolean;
};

const GAP_TOLERANCE_MS = 50;
const STATUS_THROTTLE_MS = 1000;
const PROMPT_CHARS = 200;
/** Parcial a cada 31 janelas (~1 s), com pelo menos 6 janelas de fala no trecho aberto. */
const PARTIAL_EVERY_WINDOWS = 31;
const PARTIAL_MIN_SPEECH_WINDOWS = 6;

type QueueItem = { speaker: Speaker; startMs: number; endMs: number; pcm: Int16Array; segmentId: string };
type PartialItem = { channel: Channel; segmentId: string; startMs: number; pcm: Int16Array };

const SPEAKER: Record<AudioSource, Speaker> = { mic: 'Eu', sys: 'Outros' };

export class AsrPipeline extends EventEmitter {
  private readonly channels = new Map<AudioSource, Channel>();
  private readonly queue: QueueItem[] = [];
  /** Parciais pendentes (no máx. um por canal). Só rodam quando não há finais na fila. */
  private readonly partials: PartialItem[] = [];
  private readonly backoffMs: number[];
  private pumping = false;
  private failed = false;
  private state: AsrStatus['state'] = 'idle';
  private lastError: string | undefined;
  private lastStatusAt = 0;
  /** Últimos ~200 caracteres reconhecidos por falante, usados como prompt do próximo trecho. */
  private readonly context = new Map<Speaker, string>();
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: AsrPipelineOptions) {
    super();
    this.backoffMs = options.backoffMs ?? [1000, 3000, 9000];
  }

  pushFrame(frame: AudioFrame): void {
    const channel = this.channel(frame.source);
    channel.chain = channel.chain.then(() => this.handleFrame(channel, frame)).catch((err) => {
      this.warn(channel, (err as Error).message);
    });
  }

  async finish(): Promise<void> {
    await Promise.all([...this.channels.values()].map((c) => c.chain));
    for (const channel of this.channels.values()) {
      this.enqueueAll(channel, channel.segmenter.flush());
    }
    await this.drained();
  }

  retry(): void {
    if (!this.failed) return;
    this.failed = false;
    void this.pump();
  }

  private channel(source: AudioSource): Channel {
    let channel = this.channels.get(source);
    if (!channel) {
      channel = {
        source,
        speaker: SPEAKER[source],
        detector: this.options.createDetector(),
        segmenter: new SpeechSegmenter(this.options.segmenter),
        segBase: 0,
        leftover: new Int16Array(0),
        windows: 0,
        anchors: [],
        expectedRawMs: null,
        offsetMs: 0,
        warned: false,
        chain: Promise.resolve(),
        openId: null,
        windowsSincePartial: 0,
        partialBusy: false,
      };
      this.channels.set(source, channel);
    }
    return channel;
  }

  private warn(channel: Channel, message: string): void {
    if (channel.warned) return;
    channel.warned = true;
    this.emit('warning', { source: channel.source, message });
  }

  private async handleFrame(channel: Channel, frame: AudioFrame): Promise<void> {
    const samples = new Int16Array(frame.pcm.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = frame.pcm.readInt16LE(i * 2);
    const frameMs = samples.length / 16;
    // expectedRawMs: próximo timestamp bruto esperado; offsetMs: bruto -> tempo da gravação (monotônico)
    if (channel.expectedRawMs === null) {
      channel.anchors.push({ sample: 0, ms: frame.timestampMs });
      channel.offsetMs = 0;
    } else if (Math.abs(frame.timestampMs - channel.expectedRawMs) > GAP_TOLERANCE_MS) {
      // lacuna ou reinício de timestamps: fecha o trecho aberto e reancora (nunca volta no tempo)
      this.enqueueAll(channel, channel.segmenter.flush());
      channel.leftover = new Int16Array(0);
      // segmenter novo: descarta o pré-roll de antes da lacuna
      channel.segmenter = new SpeechSegmenter(this.options.segmenter);
      channel.segBase = channel.windows * VAD_WINDOW;
      const ms = Math.max(channel.expectedRawMs + channel.offsetMs, frame.timestampMs);
      channel.anchors.push({ sample: channel.segBase, ms });
      channel.offsetMs = ms - frame.timestampMs;
    }
    channel.expectedRawMs = frame.timestampMs + frameMs;
    await this.process(channel, samples);
  }

  private async process(channel: Channel, samples: Int16Array): Promise<void> {
    const all = new Int16Array(channel.leftover.length + samples.length);
    all.set(channel.leftover, 0);
    all.set(samples, channel.leftover.length);
    let offset = 0;
    for (; offset + VAD_WINDOW <= all.length; offset += VAD_WINDOW) {
      const window = all.slice(offset, offset + VAD_WINDOW);
      let probability = 0;
      try {
        probability = await channel.detector.probability(int16ToFloat32(window));
      } catch (err) {
        // janela tratada como silêncio: a contagem de amostras continua exata
        this.warn(channel, `VAD: ${(err as Error).message}`);
      }
      channel.windows++;
      this.enqueueAll(channel, channel.segmenter.push(window, probability));
      this.trackOpen(channel);
    }
    channel.leftover = all.slice(offset);
  }

  private toMs(channel: Channel, sample: number): number {
    let anchor = channel.anchors[0]!;
    for (const a of channel.anchors) {
      if (a.sample <= sample) anchor = a;
      else break;
    }
    return Math.round(anchor.ms + (sample - anchor.sample) / 16);
  }

  /** Fecha os trechos devolvidos pelo segmenter (o primeiro herda o id do trecho aberto). */
  private enqueueAll(channel: Channel, chunks: SpeechChunk[]): void {
    for (const chunk of chunks) {
      this.enqueue(channel, chunk, channel.openId ?? randomUUID());
      channel.openId = null;
    }
    if (!channel.segmenter.isOpen) {
      channel.openId = null;
      channel.windowsSincePartial = 0;
    }
  }

  /** Mantém o id do trecho aberto e agenda parciais. */
  private trackOpen(channel: Channel): void {
    const seg = channel.segmenter;
    if (!seg.isOpen) return;
    if (channel.openId === null) {
      channel.openId = randomUUID();
      channel.windowsSincePartial = 0;
    }
    channel.windowsSincePartial++;
    if (this.options.partials === false) return;
    if (seg.openSpeechWindows < PARTIAL_MIN_SPEECH_WINDOWS) return;
    if (channel.windowsSincePartial < PARTIAL_EVERY_WINDOWS || channel.partialBusy || this.failed) return;
    const open = seg.peekOpen();
    if (!open) return;
    channel.windowsSincePartial = 0;
    channel.partialBusy = true;
    this.partials.push({
      channel,
      segmentId: channel.openId,
      startMs: this.toMs(channel, channel.segBase + open.startSample),
      pcm: open.pcm,
    });
    void this.pump();
  }

  private enqueue(channel: Channel, chunk: SpeechChunk, segmentId: string): void {
    this.queue.push({
      segmentId,
      speaker: channel.speaker,
      startMs: this.toMs(channel, channel.segBase + chunk.startSample),
      endMs: this.toMs(channel, channel.segBase + chunk.endSample),
      pcm: chunk.pcm,
    });
    if (this.state !== 'idle' && Date.now() - this.lastStatusAt >= STATUS_THROTTLE_MS) {
      this.status(this.state, this.lastError);
    }
    void this.pump();
  }

  private queueSeconds(): number {
    return this.queue.reduce((s, item) => s + item.pcm.length / 16_000, 0);
  }

  private status(state: AsrStatus['state'], error?: string): void {
    this.state = state;
    this.lastError = error;
    this.lastStatusAt = Date.now();
    this.emit('status', { state, queueSeconds: this.queueSeconds(), ...(error ? { error } : {}) });
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.failed) return;
    this.pumping = true;
    let attempt = 0;
    while (this.queue.length > 0 || this.partials.length > 0) {
      if (this.queue.length === 0) {
        await this.runPartial(this.partials.shift()!);
        continue;
      }
      const item = this.queue[0]!;
      if (this.state !== 'transcribing') this.status('transcribing');
      let text: string | null;
      try {
        const pcm = Buffer.from(item.pcm.buffer, item.pcm.byteOffset, item.pcm.byteLength);
        const prompt = this.promptFor(item.speaker);
        text = cleanTranscript(await this.options.transcriber.transcribe(pcmToWav(pcm), { ...(prompt ? { prompt } : {}), language: this.options.language ?? 'pt' }));
        this.queue.shift();
        attempt = 0;
      } catch (err) {
        if (attempt >= this.backoffMs.length) {
          this.failed = true;
          this.pumping = false;
          this.status('failed', (err as Error).message);
          this.releaseWaiters();
          return;
        }
        this.status('retrying', (err as Error).message);
        await sleep(this.backoffMs[attempt]!);
        attempt++;
        try {
          await this.options.transcriber.restart();
        } catch {
          // a próxima tentativa de transcribe vai falhar e contar como mais uma tentativa
        }
        continue;
      }
      if (text) {
        this.context.set(item.speaker, `${this.context.get(item.speaker) ?? ''} ${text}`.trim().slice(-PROMPT_CHARS));
        const person = item.speaker === 'Outros' && this.options.speakers ? await this.options.speakers.identify(Buffer.from(item.pcm.buffer, item.pcm.byteOffset, item.pcm.byteLength)).catch(() => null) : null;
        try {
          this.emit('segment', { id: randomUUID(), source: item.speaker, startMs: item.startMs, endMs: item.endMs, text, ...(person ? { speaker: person } : {}), segmentId: item.segmentId } satisfies Segment);
        } catch (err) {
          // ouvinte com defeito não pode travar a fila nem contar como falha de transcrição
          this.emit('warning', { source: item.speaker === 'Eu' ? 'mic' : 'sys', message: `listener: ${(err as Error).message}` });
        }
      }
    }
    this.pumping = false;
    if (this.state !== 'idle') this.status('idle');
    this.releaseWaiters();
  }

  /** Vocabulário próprio + o que acabou de ser dito pelo mesmo falante. */
  private promptFor(speaker: Speaker): string | undefined {
    return [this.options.vocabulary, this.context.get(speaker)].filter(Boolean).join(' ') || undefined;
  }

  /** Decodifica um parcial; falhas e parciais obsoletos são descartados em silêncio (não afetam status nem retry). */
  private async runPartial(item: PartialItem): Promise<void> {
    const { channel } = item;
    try {
      if (channel.openId !== item.segmentId) return; // o trecho já fechou
      const pcm = Buffer.from(item.pcm.buffer, item.pcm.byteOffset, item.pcm.byteLength);
      const prompt = this.promptFor(channel.speaker);
      const text = cleanTranscript(await this.options.transcriber.transcribe(pcmToWav(pcm), { ...(prompt ? { prompt } : {}), language: this.options.language ?? 'pt' }));
      if (!text || channel.openId !== item.segmentId) return;
      this.emit('partial', { source: channel.speaker, segmentId: item.segmentId, text, startMs: item.startMs } satisfies PartialSegment);
    } catch {
      // parcial é só cosmético
    } finally {
      channel.partialBusy = false;
    }
  }

  private drained(): Promise<void> {
    if ((!this.pumping && this.queue.length === 0) || this.failed) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private releaseWaiters(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
