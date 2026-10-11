import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolveSpawn, spawnOptions } from '../platform/spawn';
import { buildChildEnv } from '../ai/env';
import type { ToolsRequest } from '../ai/types';
import { t } from '../i18n';
import { classifyClaudeError, parseClaudeLine, type ClaudeErrorKind } from './stream';

export class ClaudeError extends Error {
  constructor(readonly kind: ClaudeErrorKind, message: string) {
    super(message);
    this.name = 'ClaudeError';
  }
}

export type ClaudeRunnerConfig = {
  /** Caminho do executável; padrão `claude` no PATH. */
  binary?: string;
  /** Diretório de trabalho dedicado, para o CLI não ler CLAUDE.md de projetos. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Token OAuth de longa duração (`claude setup-token`); sem ele vale o login do CLI. */
  getToken?: () => Promise<string | null> | string | null;
  /** Modelo escolhido (`--model`); sem ele vale o padrão da conta no CLI. */
  model?: string;
  /**
   * SÓ PARA TESTES (variável `RICE_TEST_MCP_CONFIG`): arquivo `--mcp-config` com um MCP falso. No modo com ferramentas vale
   * `--strict-mcp-config` e a allowlist é só dos servidores deste arquivo: os MCPs do usuário nunca entram em teste.
   */
  testMcpConfig?: string;
};

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export type ClaudeRunOptions = { system: string; prompt: string; signal?: AbortSignal; tools?: ToolsRequest };

/** Nome de servidor MCP aceito na allowlist (o Claude normaliza para letras, números, `_`, `-` e `.`). */
const SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/**
 * Argumentos do `claude -p`. Sem `mcpServers` (notas, e-mail, extrações...): nenhuma ferramenta, nada de MCP, `--safe-mode`.
 * Com `mcpServers` (só o chat, opt-in "por sua conta e risco"): o `--safe-mode` e o `--strict-mcp-config` saem para os MCPs do
 * usuário carregarem, mas continuam valendo `--tools ''` (nenhuma ferramenta nativa: sem Bash, Edit, Write, Read, WebFetch),
 * sem fontes de configuração (hooks/permissões do usuário), `disableAllHooks`, e a allowlist autoriza SÓ `mcp__<servidor>`
 * de cada servidor que o próprio Claude disse estar conectado (em modo não interativo o resto é negado).
 */
export type ClaudeAccess = {
  mcpServers?: readonly string[];
  /** War room: WebSearch e WebFetch. */
  web?: boolean;
  /** War room: pasta de leitura (Read, Grep, Glob). Já validada. */
  folder?: string;
};

/** Ferramentas NATIVAS liberadas por fonte. Nunca Bash, Edit, Write nem NotebookEdit. */
export const WEB_TOOLS = ['WebSearch', 'WebFetch'] as const;
export const FOLDER_TOOLS = ['Read', 'Grep', 'Glob'] as const;

export function buildClaudeArgs(system: string, model?: string, access?: readonly string[] | ClaudeAccess, testMcpConfig?: string): string[] {
  const a: ClaudeAccess = Array.isArray(access) ? { mcpServers: access } : ((access as ClaudeAccess | undefined) ?? {});
  const servers = (a.mcpServers ?? []).filter((n) => SERVER_RE.test(n));
  const native = [...(a.web ? WEB_TOOLS : []), ...(a.folder ? FOLDER_TOOLS : [])];
  const withTools = servers.length > 0 || native.length > 0;
  return [
    ...(model && MODEL_RE.test(model) ? ['--model', model] : []),
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--tools', native.join(','),
    '--no-session-persistence',
    ...(withTools
      ? [
          '--settings', '{"disableAllHooks":true}',
          '--allowedTools', ...servers.map((n) => `mcp__${n}`), ...(a.web ? WEB_TOOLS : []), ...(a.folder ? FOLDER_TOOLS.map((tool) => `${tool}(/${a.folder}/**)`) : []),
          ...(a.folder ? ['--add-dir', a.folder] : []),
          // sem MCP pedido (ou com o arquivo de teste): só os servidores explicitamente permitidos carregam
          ...(servers.length === 0 || testMcpConfig ? ['--strict-mcp-config'] : []),
          ...(testMcpConfig && servers.length > 0 ? ['--mcp-config', testMcpConfig] : []),
        ]
      : ['--safe-mode', '--strict-mcp-config']),
    '--setting-sources', '',
    '--disable-slash-commands',
    '--system-prompt', system,
  ];
}

const probeCache = new Map<string, { at: number; names: string[] }>();
const PROBE_TTL_MS = 60_000;

/**
 * Quais servidores MCP o Claude Code tem conectados: abre o `claude` com as mesmas flags do chat com ferramentas e lê SÓ o
 * evento `init` do stream (nomes e estado dos servidores, ~0,6 s), fechando o processo logo em seguida. Não lê nenhum arquivo
 * de configuração (o `claude mcp list` imprimiria URLs e argumentos, que podem ter segredos).
 */
export async function probeClaudeMcpServers(options: { binary?: string; cwd: string; env?: NodeJS.ProcessEnv; token?: string | null; force?: boolean; timeoutMs?: number }): Promise<string[]> {
  const key = options.binary ?? 'claude';
  const hit = probeCache.get(key);
  if (!options.force && hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.names;
  await mkdir(options.cwd, { recursive: true });
  const env = buildChildEnv(options.env ?? process.env, options.token ? { CLAUDE_CODE_OAUTH_TOKEN: options.token } : {}, options.binary);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence', '--settings', '{"disableAllHooks":true}', '--setting-sources', '', '--disable-slash-commands'];
  const names = await new Promise<string[]>((resolve) => {
    const spec = resolveSpawn(key, args, env);
    const child = spawn(spec.command, spec.args, spawnOptions(spec, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'] }));
    let done = false;
    const finish = (list: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(list);
    };
    const timer = setTimeout(() => finish([]), options.timeoutMs ?? 20_000);
    timer.unref();
    child.on('error', () => finish([]));
    child.on('close', () => finish([]));
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const m = JSON.parse(line) as { type?: string; subtype?: string; mcp_servers?: Array<{ name?: unknown; status?: unknown }> };
        if (m.type === 'system' && m.subtype === 'init') {
          finish((m.mcp_servers ?? []).filter((s) => s.status === 'connected' && typeof s.name === 'string' && SERVER_RE.test(s.name)).map((s) => s.name as string));
        }
      } catch {
        // linha que não é JSON
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end('.\n'); // o `init` só sai depois que o prompt chega; o processo é encerrado antes de qualquer resposta
  });
  probeCache.set(key, { at: Date.now(), names });
  return names;
}

async function testServerNames(path: string): Promise<string[]> {
  try {
    return Object.keys((JSON.parse(await readFile(path, 'utf8')) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {});
  } catch {
    return [];
  }
}

export const clearClaudeMcpProbeCache = (): void => probeCache.clear();

export class ClaudeRunner {
  constructor(private readonly config: ClaudeRunnerConfig) {}

  async *run({ system, prompt, signal, tools }: ClaudeRunOptions): AsyncGenerator<string, string, void> {
    if (signal?.aborted) throw new ClaudeError('cancelled', 'cancelado');
    await mkdir(this.config.cwd, { recursive: true });
    if (signal?.aborted) throw new ClaudeError('cancelled', 'cancelado');
    const token = await this.config.getToken?.();
    // só o token do provedor ativo entra; qualquer chave herdada do ambiente é apagada
    const env = buildChildEnv(this.config.env ?? process.env, token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}, this.config.binary);
    // ferramentas só com o pedido explícito do chat; sem MCP conectado o modo com ferramentas não vale a pena e fica o modo seguro
    const servers = !tools || tools.mcp === false ? [] : this.config.testMcpConfig ? await testServerNames(this.config.testMcpConfig) : await probeClaudeMcpServers({ binary: this.config.binary, cwd: this.config.cwd, env: this.config.env, token });
    const claudeArgs = buildClaudeArgs(system, this.config.model, { mcpServers: servers, ...(tools?.web ? { web: true } : {}), ...(tools?.folder ? { folder: tools.folder } : {}) }, this.config.testMcpConfig);
    const spec = resolveSpawn(this.config.binary ?? 'claude', claudeArgs, env);
    const child = spawn(spec.command, spec.args, spawnOptions(spec, {
      cwd: tools?.folder ?? this.config.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    }));

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let spawnError: NodeJS.ErrnoException | null = null;
    let aborted = false;
    let killTimer: NodeJS.Timeout | null = null;
    const terminate = () => {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    };
    const exited = new Promise<number | null>((res) => {
      child.once('close', (code) => {
        if (killTimer) clearTimeout(killTimer);
        res(code);
      });
      child.on('error', (err) => {
        spawnError = err;
        // Em falha de spawn o stdout pode nunca emitir 'end'; fecha o readline para não travar.
        lines.close();
        res(null);
      });
    });
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-8192);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);

    let full = '';
    let result: { isError: boolean; text: string } | null = null;
    try {
      for await (const line of lines) {
        if (aborted) break;
        const event = parseClaudeLine(line);
        if (!event) continue;
        if (event.kind === 'delta') {
          full += event.text;
          yield event.text;
        } else if (event.kind === 'tool') {
          tools?.onCall({ server: event.server, tool: event.tool, ...(event.detail ? { detail: event.detail } : {}) });
        } else {
          result = event;
        }
      }
      const code = await exited;

      if (aborted) throw new ClaudeError('cancelled', 'cancelado');
      const err = spawnError as NodeJS.ErrnoException | null;
      if (err) {
        if (err.code === 'ENOENT') throw new ClaudeError('not-installed', t('ai.cli.claude-missing'));
        throw new ClaudeError('failed', err.message);
      }
      if (result?.isError) throw new ClaudeError(classifyClaudeError(result.text), result.text);
      if (!result) {
        const message = stderr.trim() || t('ai.err.exit-code', { code: String(code) });
        throw new ClaudeError(classifyClaudeError(message), message);
      }
      return result.text || full;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (child.exitCode === null && child.signalCode === null) terminate();
    }
  }
}
