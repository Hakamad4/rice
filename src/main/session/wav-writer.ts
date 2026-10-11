import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { AudioFrame } from '../../shared/frames';
import { readWav } from '../../shared/wav';
import { classifyStorageError } from '../store/storage-errors';

const run = promisify(execFile);
const RATE = 16_000;
const SAMPLES_PER_MS = 16;
const BLOCK = RATE; // 1 s
const MAX_LAG = 2 * RATE; // depois de 2 s sem o outro canal, completa com silêncio

type Channel = { samples: Int16Array; length: number }; // amostras a partir de `written`

function header(dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Sistema de arquivos que o gravador usa; nos testes entra um falso (ENOSPC depois de N bytes, pasta que some...). */
export type WavFs = {
  open: (path: string, flags: 'w' | 'r+') => Promise<FileHandle>;
  mkdir: (path: string) => Promise<unknown>;
};
const realFs: WavFs = { open: (path, flags) => open(path, flags), mkdir: (path) => mkdir(path, { recursive: true }) };

export type WavFailure =
  | { kind: 'full'; error: unknown }
  /** Pasta/volume indisponível: `fallback` = passou a gravar no local alternativo. */
  | { kind: 'unavailable'; error: unknown; fallback: boolean }
  /** Nem o local alternativo funcionou: o áudio deixou de ser salvo. */
  | { kind: 'lost'; error: unknown };

export type WavWriterOptions = {
  /** Cada falha que muda o estado do áudio (uma vez por episódio); nunca silenciosa. */
  onFailure?: (failure: WavFailure) => void;
  /** A escrita voltou a funcionar depois de uma falha (disco liberado). */
  onRecovered?: () => void;
  /** Para onde seguir se a pasta da reunião sumir (ex.: `userData/spool/...`). */
  fallbackPath?: string;
  fs?: WavFs;
  /** Quanto tempo esperar antes de tentar escrever de novo depois de "disco cheio" (padrão 10 s). */
  retryMs?: number;
  now?: () => number;
};

/** O cabeçalho com o tamanho é regravado a cada ~10 s de áudio: depois de uma queda o arquivo continua legível. */
const HEADER_EVERY = 10 * RATE;

export class StereoWavWriter {
  private written = 0; // amostras por canal já gravadas
  private readonly ch: Record<'mic' | 'sys', Channel> = {
    mic: { samples: new Int16Array(BLOCK * 4), length: 0 },
    sys: { samples: new Int16Array(BLOCK * 4), length: 0 },
  };
  private pending: Promise<void> = Promise.resolve();
  private error: unknown;
  private closed = false;
  private closing: Promise<{ durationMs: number; path?: string }> | undefined;
  private lastHeaderAt = 0;
  /** Sem espaço: os blocos são descartados (viram silêncio no arquivo) até a próxima tentativa. */
  private fullUntil: number | null = null;
  private fullReported = false;
  private lost = false;
  private relocated = false;
  private droppedSamples = 0;

  private constructor(
    private file: FileHandle,
    private currentPath: string,
    private readonly options: WavWriterOptions,
  ) {}

  static async open(path: string, options: WavWriterOptions = {}): Promise<StereoWavWriter> {
    const file = await (options.fs ?? realFs).open(path, 'w');
    await file.write(header(0), 0, 44, 0);
    return new StereoWavWriter(file, path, options);
  }

  /** Arquivo em uso (muda se a pasta sumiu e a gravação foi para o local alternativo). */
  get path(): string {
    return this.currentPath;
  }

  get bufferedMs(): number {
    return Math.max(this.ch.mic.length, this.ch.sys.length) / SAMPLES_PER_MS;
  }

  /** Milissegundos de áudio que não foram salvos (disco cheio ou local perdido). */
  get droppedMs(): number {
    return this.droppedSamples / SAMPLES_PER_MS;
  }

  write(frame: AudioFrame): void {
    if (this.closed) return;
    const channel = this.ch[frame.source];
    const start = frame.timestampMs * SAMPLES_PER_MS - this.written;
    const count = frame.pcm.length / 2;
    if (start + count <= 0) return; // já gravado (atrasado demais)
    const end = start + count;
    if (end > channel.samples.length) {
      const grown = new Int16Array(Math.max(end, channel.samples.length * 2));
      grown.set(channel.samples.subarray(0, channel.length));
      channel.samples = grown;
    }
    for (let i = Math.max(0, -start); i < count; i++) channel.samples[start + i] = frame.pcm.readInt16LE(i * 2);
    channel.length = Math.max(channel.length, end);
    this.flushReady(false);
  }

  private flushReady(all: boolean): void {
    const { mic, sys } = this.ch;
    const longest = Math.max(mic.length, sys.length);
    let ready = all ? longest : Math.min(mic.length, sys.length);
    if (!all && longest - ready > MAX_LAG) ready = longest - MAX_LAG;
    if (!all) ready -= ready % BLOCK;
    if (ready <= 0) return;
    const out = Buffer.alloc(ready * 4);
    for (let i = 0; i < ready; i++) {
      out.writeInt16LE(i < mic.length ? mic.samples[i]! : 0, i * 4);
      out.writeInt16LE(i < sys.length ? sys.samples[i]! : 0, i * 4 + 2);
    }
    for (const c of [mic, sys]) {
      c.samples.copyWithin(0, ready, Math.max(ready, c.length));
      c.samples.fill(0, Math.max(0, c.length - ready), c.length);
      c.length = Math.max(0, c.length - ready);
    }
    const position = 44 + this.written * 4;
    this.written += ready;
    const upTo = this.written;
    this.pending = this.pending.then(() => this.writeBlock(out, position, ready, upTo));
  }

  private async writeBlock(out: Buffer, position: number, samples: number, writtenAfter: number): Promise<void> {
    if (this.lost) {
      this.droppedSamples += samples;
      return;
    }
    const now = this.options.now?.() ?? Date.now();
    if (this.fullUntil !== null && now < this.fullUntil) {
      this.droppedSamples += samples; // sem espaço: espera a próxima janela de tentativa
      return;
    }
    try {
      await this.file.write(out, 0, out.length, position);
      if (writtenAfter - this.lastHeaderAt >= HEADER_EVERY) {
        this.lastHeaderAt = writtenAfter;
        await this.file.write(header(writtenAfter * 4), 0, 44, 0);
      }
      if (this.fullUntil !== null) {
        this.fullUntil = null;
        this.fullReported = false;
        this.options.onRecovered?.();
      }
    } catch (err) {
      await this.recover(err, out, position, samples);
    }
  }

  private async recover(err: unknown, out: Buffer, position: number, samples: number): Promise<void> {
    const kind = classifyStorageError(err);
    if (kind === 'full') {
      this.fullUntil = (this.options.now?.() ?? Date.now()) + (this.options.retryMs ?? 10_000);
      this.droppedSamples += samples;
      if (!this.fullReported) {
        this.fullReported = true;
        this.options.onFailure?.({ kind: 'full', error: err });
      }
      return;
    }
    const fs = this.options.fs ?? realFs;
    // 1) a pasta foi apagada ou renomeada: recria e continua no mesmo caminho (o que já estava gravado ficou para trás)
    try {
      await fs.mkdir(dirname(this.currentPath));
      await this.reopen(fs, this.currentPath, position, out);
      this.options.onFailure?.({ kind: 'unavailable', error: err, fallback: false });
      return;
    } catch {
      // 2) volume desmontado ou sem permissão: segue no local alternativo
    }
    const fallback = this.options.fallbackPath;
    if (fallback && !this.relocated) {
      try {
        await fs.mkdir(dirname(fallback));
        await this.reopen(fs, fallback, position, out);
        this.relocated = true;
        this.currentPath = fallback;
        this.options.onFailure?.({ kind: 'unavailable', error: err, fallback: true });
        return;
      } catch (second) {
        err = second;
      }
    }
    this.lost = true;
    this.droppedSamples += samples;
    this.options.onFailure?.({ kind: 'lost', error: err });
  }

  /** Abre o arquivo de novo, escreve o cabeçalho (o início fica como silêncio, em arquivo esparso) e regrava o bloco que falhou. */
  private async reopen(fs: WavFs, path: string, position: number, out: Buffer): Promise<void> {
    const handle = await fs.open(path, 'w');
    try {
      await handle.write(header(0), 0, 44, 0);
      await handle.write(out, 0, out.length, position);
    } catch (err) {
      await handle.close().catch(() => {});
      throw err;
    }
    await this.file.close().catch(() => {});
    this.file = handle;
  }

  close(): Promise<{ durationMs: number; path?: string }> {
    this.closing ??= this.doClose();
    return this.closing;
  }

  private async doClose(): Promise<{ durationMs: number; path?: string }> {
    this.closed = true;
    this.flushReady(true);
    const dataBytes = this.written * 4; // snapshot síncrono
    const durationMs = this.written / SAMPLES_PER_MS;
    try {
      await this.pending;
      if (!this.lost) {
        try {
          await this.file.write(header(dataBytes), 0, 44, 0);
        } catch (err) {
          // sem espaço para o cabeçalho final: o áudio já foi avisado como não salvo; a recuperação conserta pelo tamanho do arquivo
          if (classifyStorageError(err) === 'other') throw err;
        }
      }
    } finally {
      await this.file.close().catch(() => {});
    }
    return { durationMs, ...(this.relocated ? { path: this.currentPath } : {}) };
  }
}

export async function encodeM4a(wavPath: string, m4aPath: string): Promise<void> {
  await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wavPath, m4aPath]);
}

/** Junta dois m4a (a primeiro, depois b) em `outPath`: decodifica para WAV estéreo 16 kHz, concatena o PCM e recodifica. */
export async function concatM4a(aPath: string, bPath: string, outPath: string): Promise<void> {
  const tmp = [`${outPath}.a.wav`, `${outPath}.b.wav`, `${outPath}.all.wav`];
  try {
    for (const [src, dst] of [[aPath, tmp[0]!], [bPath, tmp[1]!]] as const) {
      await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '2', src, dst]);
    }
    const parts = await Promise.all([tmp[0]!, tmp[1]!].map(async (path) => readWav(await readFile(path))));
    const pcm = Buffer.concat(parts.map((p) => p.pcm));
    await writeFile(tmp[2]!, Buffer.concat([header(pcm.length), pcm]));
    await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', tmp[2]!, outPath]);
  } finally {
    await Promise.all(tmp.map((path) => rm(path, { force: true })));
  }
}
