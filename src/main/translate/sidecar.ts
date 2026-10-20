import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

type Line = { event?: string; id?: number; text?: string; message?: string; ms?: number; backend?: string };
type Pending = { resolve: (text: string) => void; reject: (err: Error) => void };

export type SidecarOptions = {
  /** Caminho do `rice-translate`. */
  binary: string;
  /** Argumentos extras (ex.: `--simulate` nos testes, `--threads 1`). */
  args?: readonly string[];
  /** Sem pedidos por este tempo, o processo sai e a RAM volta a zero. */
  idleMs?: number;
  /** Tempo máximo para o processo dizer `ready`. */
  startTimeoutMs?: number;
  /** Quantos modelos o processo mantém na RAM (a tradução com pivô usa 2). */
  cache?: number;
};

/**
 * Cliente do `rice-translate` (OPUS-MT em CTranslate2). Um processo filho enquanto houver tradução; sem uso ele sai sozinho
 * (`idleMs`), então desligado = RAM zero. Pedidos são serializados pelo próprio processo; aqui só se casam as respostas por id.
 */
export class TranslateSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;
  private idle: NodeJS.Timeout | null = null;
  private readonly idleMs: number;
  private readonly startTimeoutMs: number;

  constructor(private readonly options: SidecarOptions) {
    this.idleMs = options.idleMs ?? 90_000;
    this.startTimeoutMs = options.startTimeoutMs ?? 15_000;
  }

  get running(): boolean {
    return this.child !== null;
  }

  async translate(model: string, text: string, prefix = '', signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw abortError();
    await this.ensureRunning();
    if (signal?.aborted) throw abortError();
    const child = this.child;
    if (!child) throw new Error('translate-sidecar-stopped');
    this.touch();
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        // O processo termina o que já pegou; a resposta é descartada.
        this.pending.delete(id);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      });
      child.stdin.write(`${JSON.stringify({ cmd: 'translate', id, model, prefix, text })}\n`);
    });
  }

  /** Pede ao processo para soltar os modelos; sem argumento, solta todos. */
  unloadModel(model = ''): void {
    if (this.child) this.child.stdin.write(`${JSON.stringify({ cmd: 'unload', model })}\n`);
  }

  /** Encerra o processo (RAM zero). Pedidos em andamento falham. */
  async stop(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      try {
        child.stdin.write('{"cmd":"quit"}\n');
        child.stdin.end();
      } catch {
        /* já fechado */
      }
      setTimeout(() => child.kill(), 2000).unref();
    });
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.stop(), this.idleMs);
    this.idle.unref();
  }

  /** Sobe o processo (se preciso) e espera o `ready`. */
  ensureRunning(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const args = [...(this.options.args ?? []), '--threads', '1', '--cache', String(this.options.cache ?? 2)];
      const child = spawn(this.options.binary, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      let settled = false;
      const timer = setTimeout(() => fail(new Error('translate-sidecar-timeout')), this.startTimeoutMs);
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
        child.kill();
        reject(err);
      };
      createInterface({ input: child.stdout }).on('line', (raw) => {
        let line: Line;
        try {
          line = JSON.parse(raw) as Line;
        } catch {
          return;
        }
        if (line.event === 'ready' && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        } else if (line.event === 'translated' && typeof line.id === 'number') {
          this.pending.get(line.id)?.resolve(line.text ?? '');
          this.pending.delete(line.id);
        } else if (line.event === 'error') {
          const message = line.message ?? 'translate-sidecar-error';
          if (typeof line.id === 'number') {
            this.pending.get(line.id)?.reject(new Error(message));
            this.pending.delete(line.id);
          } else if (!settled) fail(new Error(message));
        }
      });
      child.stderr.on('data', () => {}); // o processo não escreve no stderr; descarta para não encher o pipe
      child.on('error', (err) => fail(err));
      child.on('exit', () => {
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
        fail(new Error('translate-sidecar-exited'));
        for (const [id, p] of this.pending) {
          p.reject(new Error('translate-sidecar-exited'));
          this.pending.delete(id);
        }
      });
    });
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
