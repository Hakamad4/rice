import { execFile } from 'node:child_process';
import { resolveSpawn, spawnOptions } from '../platform/spawn';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../i18n';
import { aiError } from './errors';
import { buildChildEnv } from './env';
import { runCli, type CliLine } from './cli-run';
import type { CliRunnerConfig } from './codex-cli';
import type { AiRunner } from './types';

/** `provider/modelo` (o modelo pode ter `/`, `:` e `#variante`: `openrouter/x/y:free`, `anthropic/claude#high`). */
export const OPENCODE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$/;

/**
 * Modelo gratuito do OpenCode Zen: funciona sem login, mas só entra se o usuário escolher explicitamente.
 * Privacidade (opencode.ai/docs/zen, seção Privacy): nos modelos gratuitos, incluindo o Big Pickle, "during its free
 * period, collected data may be used to improve the model". Transcrição de reunião é sensível, então o
 * "Automático" nunca cai nele.
 */
export const OPENCODE_FREE_MODEL = 'opencode/big-pickle';

/** Modelos de camada gratuita (Zen `*-free`, OpenRouter `:free`), que podem usar os dados para treino. */
export function isFreeTierModel(model: string): boolean {
  return model === OPENCODE_FREE_MODEL || /^opencode\/.*free$/i.test(model) || /:free$/i.test(model);
}

/**
 * O Rice só quer texto, e o opencode é um agente com ferramentas. Conferido com opencode 2.0.24 (`opencode run`):
 *  - `"*": "ask"`: em `run` não interativo, todo pedido de permissão (edit, write, shell, webfetch, read, glob,
 *    grep, fora do cwd...) é rejeitado na hora ("auto-rejecting"). Sem `--auto`, nunca aprovamos nada.
 *  - `deny` para as ferramentas que NÃO passam pelo sistema de permissões ou que travariam: `execute` (roda
 *    JavaScript com acesso à rede e não pede permissão), `question` (espera resposta humana e trava o run),
 *    `subagent`, `skill` e `websearch`.
 *  - Não usamos `deny` em tudo porque o modelo gratuito do Zen recusa (HTTP 403) pedidos sem a ferramenta `shell`.
 */
export const OPENCODE_CONFIG = {
  permission: { '*': 'ask', execute: 'deny', question: 'deny', subagent: 'deny', skill: 'deny', websearch: 'deny' },
} as const;

/**
 * Flags: `run --standalone` (servidor privado do processo, sem daemon; ~1 s para subir), `--format json`
 * (um objeto JSON por linha), `-m provider/modelo`. O prompt vai pelo stdin. Sem `--auto`.
 */
export function buildOpenCodeArgs(model: string): string[] {
  return ['run', '--standalone', '--format', 'json', '-m', model];
}

/**
 * Ambiente do filho: permissões negadas por `OPENCODE_CONFIG_CONTENT`; config global do usuário (MCP, plugins,
 * agentes) trocada por uma pasta vazia (`XDG_CONFIG_HOME`; as credenciais ficam em `XDG_DATA_HOME`, intocado);
 * config de projeto e autoatualização desligadas. Chaves de outros provedores são removidas (`buildChildEnv`).
 */
export function openCodeEnv(base: NodeJS.ProcessEnv, cwd: string, binary?: string): NodeJS.ProcessEnv {
  return buildChildEnv(
    base,
    {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_CONFIG),
      XDG_CONFIG_HOME: join(cwd, 'xdg-config'),
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      NO_COLOR: '1',
    },
    binary,
  );
}

/**
 * `--format json`: `text` traz o texto completo de uma parte; `error` traz a falha. Erros de login/modelo
 * (`provider.auth`, `provider.no-route`) ganham o prefixo "not logged in" para o fast-fail de `runCli`.
 */
export function parseOpenCodeLine(line: string): CliLine | null {
  let data: { type?: string; part?: { type?: string; text?: string }; error?: { type?: string; message?: string } };
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  if (data.type === 'text' && data.part?.type === 'text' && typeof data.part.text === 'string') return { message: data.part.text };
  if (data.type === 'error') {
    const message = data.error?.message ?? t('ai.err.run-failed');
    const kind = data.error?.type ?? '';
    return { error: kind === 'provider.auth' || kind === 'provider.no-route' ? `not logged in: ${message}` : message };
  }
  return {};
}

const run = (binary: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    const spec = resolveSpawn(binary, args, env);
    execFile(spec.command, spec.args, spawnOptions(spec, { env, cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }), (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }));
  });

/** Modelos dos provedores autenticados (`opencode models`), na ordem da CLI. Lista vazia = sem login. */
export async function listOpenCodeModels(config: Pick<CliRunnerConfig, 'binary' | 'cwd' | 'env'>): Promise<string[]> {
  await mkdir(config.cwd, { recursive: true });
  const env = openCodeEnv(config.env ?? process.env, config.cwd, config.binary);
  const { ok, out } = await run(config.binary, ['models', '--standalone'], env, config.cwd, 20_000);
  if (!ok) return [];
  return [...new Set(out.split('\n').map((l) => l.trim()).filter((l) => OPENCODE_MODEL_RE.test(l)))];
}

/** `opencode auth list` diz "No authenticated integrations" quando não há login. */
export async function openCodeLoggedIn(config: Pick<CliRunnerConfig, 'binary' | 'cwd' | 'env'>): Promise<boolean> {
  await mkdir(config.cwd, { recursive: true });
  const env = openCodeEnv(config.env ?? process.env, config.cwd, config.binary);
  const { ok, out } = await run(config.binary, ['auth', 'list', '--standalone'], env, config.cwd, 15_000);
  return ok && out.trim() !== '' && !/no authenticated/i.test(out);
}

const PREFERRED = [/^anthropic\/.*sonnet/i, /^openai\/gpt-5/i, /^github-copilot\/.*(sonnet|gpt-5)/i, /^google\/gemini.*pro/i];

/** Padrão do "Automático": um modelo de uso geral entre os autenticados pagos; sem nenhum, `null` (nunca o gratuito). */
export function pickDefaultModel(models: readonly string[]): string | null {
  const paid = models.filter((m) => !isFreeTierModel(m));
  for (const re of PREFERRED) {
    const found = paid.find((m) => re.test(m));
    if (found) return found;
  }
  return paid[0] ?? null;
}

export function createOpenCodeRunner(config: CliRunnerConfig): AiRunner {
  return {
    async *run({ system, prompt, signal }) {
      const model = config.model && OPENCODE_MODEL_RE.test(config.model) ? config.model : pickDefaultModel(await listOpenCodeModels(config));
      if (!model) throw aiError('opencode-sub', 'auth', 'not logged in'); // fast-fail: sem login, nada de cair no gratuito
      return yield* runCli({
        provider: 'opencode-sub',
        binary: config.binary,
        args: buildOpenCodeArgs(model),
        cwd: config.cwd,
        env: openCodeEnv(config.env ?? process.env, config.cwd, config.binary),
        stdin: `${system}\n\n---\n\n${prompt}`,
        ...(signal ? { signal } : {}),
        parseLine: parseOpenCodeLine,
        notInstalled: t('ai.cli.opencode-missing'),
        ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
      });
    },
  };
}
