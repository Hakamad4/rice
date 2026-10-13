import { t } from '../i18n';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolveSpawn, spawnOptions } from '../platform/spawn';
import { aiError, classifyMessage } from './errors';
import { AiError, RUN_TIMEOUT_MS, type AiProvider, type ToolCall } from './types';

/** O que uma linha de saída de CLI significa. `message` = mensagem completa; `delta` = pedaço. */
export type CliLine = { delta?: string; message?: string; error?: string; done?: boolean; tool?: ToolCall };

export type CliRunConfig = {
  provider: AiProvider;
  binary: string;
  args: string[];
  /** Diretório dedicado e vazio: o CLI não lê arquivos de projetos. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  signal?: AbortSignal;
  parseLine: (line: string) => CliLine | null;
  /** Mensagem quando o executável não existe (ex.: "Instale o Codex CLI…"). */
  notInstalled: string;
  timeoutMs?: number;
  /** Chamada de ferramenta MCP vista no stream (só no modo com ferramentas do chat). */
  onTool?: (call: ToolCall) => void;
};

const AUTH_NOISE = /not logged in|log ?in required|login required|waiting for authentication|401 unauthori[sz]ed|please (log|sign) ?in|authentication (is )?required/i;

/**
 * Executa um CLI de IA com o prompt no stdin e lê a saída linha a linha.
 * Falha rápido em erro de login (alguns CLIs ficam esperando o navegador) e respeita cancelamento e tempo máximo.
 */
export async function* runCli(config: CliRunConfig): AsyncGenerator<string, string, void> {
  const { provider, signal } = config;
  if (signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
  await mkdir(config.cwd, { recursive: true });
  if (signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));

  // Windows: shims .cmd do npm rodam sem shell (ver platform/spawn.ts); no Mac é o spawn direto de sempre
  const spec = resolveSpawn(config.binary, config.args, config.env);
  const child = spawn(spec.command, spec.args, spawnOptions(spec, { cwd: config.cwd, env: config.env, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] }));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  let spawnError: NodeJS.ErrnoException | null = null;
  let aborted = false;
  let timedOut = false;
  let authFailure = false;
  let killTimer: NodeJS.Timeout | null = null;
  const terminate = () => {
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  };
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      resolve(code);
    });
    child.on('error', (err) => {
      spawnError = err;
      lines.close();
      resolve(null);
    });
  });
  const onAbort = () => {
    aborted = true;
    terminate();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, config.timeoutMs ?? RUN_TIMEOUT_MS);
  timer.unref();

  const failAuth = () => {
    if (authFailure) return;
    authFailure = true;
    terminate();
  };
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    stderr = (stderr + d).slice(-8192);
    if (AUTH_NOISE.test(stderr)) failAuth();
  });
  child.stdin.on('error', () => {});
  child.stdin.end(config.stdin);

  const parts: string[] = [];
  let lastError = '';
  let noise = '';
  try {
    for await (const line of lines) {
      if (aborted || authFailure || timedOut) break;
      const event = config.parseLine(line);
      if (!event) {
        if (line.trim()) {
          noise = (noise + line + '\n').slice(-4096);
          if (AUTH_NOISE.test(line)) failAuth();
        }
        continue;
      }
      if (event.tool) config.onTool?.(event.tool);
      if (event.error) {
        lastError = event.error;
        if (classifyMessage(event.error) === 'auth') failAuth();
      }
      const text = event.delta ?? (event.message ? (parts.length > 0 ? '\n\n' : '') + event.message : undefined);
      if (text) {
        parts.push(text);
        yield text;
      }
      if (event.done) break;
    }
    const code = await exited;
    const full = parts.join('');
    if (aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
    if (authFailure) throw aiError(provider, 'auth');
    if (timedOut) throw aiError(provider, 'other', t('ai.err.timeout'));
    const err = spawnError as NodeJS.ErrnoException | null;
    if (err) {
      if (err.code === 'ENOENT') throw new AiError('not-installed', config.notInstalled);
      throw aiError(provider, 'other', err.message);
    }
    if (!full.trim()) {
      const detail = lastError || stderr.trim() || noise.trim() || t('ai.err.exit-code', { code: String(code) });
      throw aiError(provider, classifyMessage(detail), detail);
    }
    return full;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) terminate();
  }
}
