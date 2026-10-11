import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { FrameDecoder } from '../../shared/frames';

export type AudioEvent = { event: string; [k: string]: unknown };

/** Um processo rice-audio = uma gravação. */
export class AudioCapture extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping: Promise<void> | null = null;
  private expectedExit = false;

  constructor(private readonly binary: string) {
    super();
  }

  start(): void {
    if (this.child) throw new Error('AudioCapture já iniciado');
    // O tap do áudio do sistema ignora o próprio Rice (o rice-audio já se exclui).
    const child = spawn(this.binary, ['--exclude-pid', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const decoder = new FrameDecoder();
    child.stdout.on('data', (chunk: Buffer) => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch (err) {
        this.emit('decode-error', err as Error);
        child.kill('SIGKILL');
        return;
      }
      for (const frame of frames) this.emit('frame', frame);
    });
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
      const text = line.trim();
      if (!text.startsWith('{')) return;
      try {
        const parsed = JSON.parse(text) as AudioEvent;
        if (typeof parsed.event === 'string') this.emit('event', parsed);
      } catch {
        // linhas de frameworks da Apple — ignorar
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', (err) => this.emit('event', { event: 'error', source: 'cli', message: err.message, fatal: true }));
    child.on('close', (code, signal) => {
      this.child = null;
      this.emit('exit', { code, signal, expected: this.expectedExit });
    });
    child.stdin.write('{"cmd":"start"}\n');
  }

  stop(timeoutMs = 5000): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.expectedExit = true;
    this.stopping = new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.write('{"cmd":"stop"}\n');
      child.stdin.end();
    });
    return this.stopping;
  }
}
