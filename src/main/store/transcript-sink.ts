import { appendFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { classifyStorageError, type StorageFailure } from './storage-errors';

export type SinkFs = {
  appendFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string) => Promise<unknown>;
  rm: (path: string) => Promise<unknown>;
};
const realFs: SinkFs = { appendFile: (p, d) => appendFile(p, d), mkdir: (p) => mkdir(p, { recursive: true }), rm: (p) => rm(p, { force: true }) };

export type TranscriptSinkOptions = {
  path: string;
  /** Cópia de segurança (ex.: `userData/spool/<reunião>/transcricao.md`) enquanto a pasta da reunião não aceita escrita. */
  spoolPath?: string;
  fs?: SinkFs;
  /** Espera entre tentativas depois de uma falha (padrão 5 s). */
  retryMs?: number;
  onFailure?: (kind: StorageFailure) => void;
  onRecovered?: () => void;
};

/**
 * Escreve a transcrição (pequena) com prioridade sobre o áudio: se a pasta falha, o texto fica na memória e numa cópia
 * local, e é reenviado a cada poucos segundos até gravar. Nunca rejeita e nunca descarta nada.
 */
export class TranscriptSink {
  private queue: string[] = [];
  private spooled = 0;
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private failing = false;
  private closed = false;
  private readonly fs: SinkFs;

  constructor(private readonly options: TranscriptSinkOptions) {
    this.fs = options.fs ?? realFs;
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  get failed(): boolean {
    return this.failing;
  }

  append(text: string): Promise<void> {
    this.queue.push(text);
    return this.run(() => this.drain());
  }

  /** Tenta gravar o que falta agora. `true` se a fila ficou vazia. */
  flush(): Promise<boolean> {
    return this.run(() => this.drain()).then(() => this.queue.length === 0);
  }

  /** Fim da gravação: última tentativa; se a pasta continua indisponível, a cópia local fica (e o chamador avisa onde). */
  async close(): Promise<{ complete: boolean; spoolPath?: string }> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
    const complete = this.queue.length === 0;
    return { complete, ...(!complete && this.options.spoolPath ? { spoolPath: this.options.spoolPath } : {}) };
  }

  private run(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn).catch(() => {});
    return this.chain;
  }

  private async drain(): Promise<void> {
    if (this.queue.length === 0) return;
    const text = this.queue.join('');
    const count = this.queue.length;
    try {
      await this.fs.appendFile(this.options.path, text);
    } catch (err) {
      const kind = classifyStorageError(err);
      if (kind === 'unavailable') {
        // pasta apagada: recria e tenta uma vez agora
        try {
          await this.fs.mkdir(dirname(this.options.path));
          await this.fs.appendFile(this.options.path, text);
          this.succeed(count);
          return;
        } catch {
          // continua como indisponível
        }
      }
      await this.fail(kind);
      return;
    }
    this.succeed(count);
  }

  private succeed(count: number): void {
    this.queue.splice(0, count);
    if (!this.failing) return;
    this.failing = false;
    this.spooled = 0;
    if (this.options.spoolPath) void this.fs.rm(this.options.spoolPath).catch(() => {});
    this.options.onRecovered?.();
  }

  private async fail(kind: StorageFailure): Promise<void> {
    if (!this.failing) {
      this.failing = true;
      this.options.onFailure?.(kind);
    }
    if (this.options.spoolPath && this.spooled < this.queue.length) {
      const fresh = this.queue.slice(this.spooled).join('');
      try {
        await this.fs.mkdir(dirname(this.options.spoolPath));
        await this.fs.appendFile(this.options.spoolPath, fresh);
        this.spooled = this.queue.length;
      } catch {
        // a cópia local é só reforço: o texto continua na memória
      }
    }
    if (!this.closed && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.run(() => this.drain());
      }, this.options.retryMs ?? 5000);
      this.timer.unref?.();
    }
  }
}
