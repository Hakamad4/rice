import { execFile } from 'node:child_process';
import { t } from '../i18n';
import { buildChildEnv } from './env';
import { runCli, type CliLine } from './cli-run';
import { AiError, type AiRunner } from './types';

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/**
 * Flags conferidas com `codex exec --help` (codex-cli 0.161.0):
 *  --json                    eventos em JSONL no stdout
 *  --ephemeral               não grava sessão em disco
 *  --skip-git-repo-check     o cwd dedicado não é um repositório
 *  --ignore-user-config      não lê ~/.codex/config.toml (a autenticação continua valendo)
 *  --ignore-rules            não carrega regras `.rules` do usuário
 *  --sandbox read-only       qualquer comando gerado pelo modelo só pode ler
 *  -C <dir>                  diretório raiz do agente (o cwd vazio)
 *  -m <modelo>               modelo (opcional)
 * O prompt vai pelo stdin (sem argumento posicional ou `-`).
 */
/** Codex: só MCP e internet. Pasta de trabalho NÃO existe aqui: o sandbox não limita a leitura a uma pasta e liberar o shell exporia ~/.ssh, ~/.aws etc. */
export type CodexAccess = { mcp?: boolean; web?: boolean };

export function buildCodexArgs(cwd: string, model?: string, disabledFeatures: readonly string[] = [], access: boolean | CodexAccess = false): string[] {
  const a: CodexAccess = typeof access === 'boolean' ? { mcp: access } : access;
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    // com ferramentas (só no chat, opt-in) o config do usuário precisa carregar para os MCPs existirem; as flags abaixo
    // (sandbox somente-leitura, ferramentas de agente desligadas, ambiente limpo) valem por cima dele
    ...(a.mcp ? [] : ['--ignore-user-config']),
    '--ignore-rules',
    '--sandbox', 'read-only',
    '-c', 'shell_environment_policy.inherit=none', // comandos do modelo (se houver) sem as variáveis de ambiente
    ...(a.web ? ['-c', 'web_search="live"'] : []),
    ...disabledFeatures.flatMap((f) => ['--disable', f]), // shell_tool e unified_exec sempre desligados
    '-C', cwd,
    ...(model && MODEL_RE.test(model) ? ['-m', model] : []),
  ];
}

/** JSONL do codex: `item.completed` com `agent_message` traz o texto; `error`/`turn.failed` trazem falhas; `turn.completed` encerra. */
export function parseCodexLine(line: string): CliLine | null {
  let data: { type?: string; message?: string; error?: { message?: string }; item?: { type?: string; text?: string; server?: string; tool?: string; query?: string; command?: string } };
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  if (data.type === 'item.started' && data.item?.type === 'mcp_tool_call' && typeof data.item.server === 'string' && typeof data.item.tool === 'string') return { tool: { server: data.item.server, tool: data.item.tool } };
  if (data.type === 'item.started' && data.item?.type === 'web_search') return { tool: { server: 'web', tool: 'search', ...(typeof data.item.query === 'string' ? { detail: data.item.query.slice(0, 300) } : {}) } };
  if (data.type === 'item.completed' && data.item?.type === 'agent_message' && typeof data.item.text === 'string') return { message: data.item.text };
  if (data.type === 'turn.completed') return { done: true };
  if (data.type === 'turn.failed') return { error: data.error?.message ?? t('ai.err.run-failed') };
  if (data.type === 'error' && typeof data.message === 'string') return { error: data.message };
  return {};
}

export type CliRunnerConfig = {
  binary: string;
  cwd: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

/**
 * O codex traz muitas ferramentas de agente ligadas por padrão (shell, navegador, computador, apps, plugins, subagentes,
 * geração de imagem...). Para o Rice ele só precisa gerar texto: desligamos tudo isso. Os nomes mudam entre versões e o codex
 * recusa nome desconhecido, então só se desliga o que a própria versão instalada lista em `codex features list`.
 */
export const CODEX_DENY_FEATURES = [
  'shell_tool', 'unified_exec', 'apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'image_generation',
  'multi_agent', 'plugins', 'remote_plugin', 'hooks', 'view_image', 'tool_suggest', 'in_app_browser', 'in_app_local_automation',
] as const;

export function parseCodexFeatures(output: string): string[] {
  return output.split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '').filter((n) => /^[a-z][a-z0-9_]*$/.test(n));
}

const featureCache = new Map<string, Promise<string[]>>();

/** Das ferramentas acima, as que esta versão do codex conhece (vazio se `features list` não existir ou falhar: vale o sandbox somente-leitura). */
export function codexDisabledFeatures(binary: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const cached = featureCache.get(binary);
  if (cached) return cached;
  const result = new Promise<string[]>((resolve) => {
    execFile(binary, ['features', 'list'], { env, timeout: 10_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve([]);
      const known = new Set(parseCodexFeatures(String(stdout)));
      resolve(CODEX_DENY_FEATURES.filter((f) => known.has(f)));
    });
  });
  featureCache.set(binary, result);
  return result;
}

export function createCodexRunner(config: CliRunnerConfig): AiRunner {
  return {
    run: async function* ({ system, prompt, signal, tools }) {
      const env = buildChildEnv(config.env ?? process.env, {}, config.binary);
      const disabled = await codexDisabledFeatures(config.binary, env);
      // com ferramentas (MCP/internet) o shell PRECISA estar desligado; se esta versão do codex não deixa garantir isso, não roda
      if (tools && !disabled.includes('shell_tool') && !disabled.includes('unified_exec')) throw new AiError('other', t('warroom.err.codex-shell'));
      return yield* runCli({
        provider: 'chatgpt-sub',
        binary: config.binary,
        args: buildCodexArgs(config.cwd, config.model, disabled, { mcp: tools ? tools.mcp !== false : false, web: Boolean(tools?.web) }),
        cwd: config.cwd,
        env,
        stdin: `${system}\n\n---\n\n${prompt}`,
        ...(signal ? { signal } : {}),
        parseLine: parseCodexLine,
        ...(tools ? { onTool: tools.onCall } : {}),
        notInstalled: t('ai.cli.codex-missing'),
        ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
      });
    },
  };
}
