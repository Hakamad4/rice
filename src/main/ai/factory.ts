import { codexModels, type CatalogModel } from './catalog';
import { createClaudeApiRunner } from './claude-api';
import { createClaudeSubRunner } from './claude-sub';
import { createCodexRunner } from './codex-cli';
import { createGeminiApiRunner } from './gemini-api';
import type { FetchLike } from './http-stream';
import { createOpenAiApiRunner } from './openai-api';
import { AGY_MODEL_RE, cachedAgyModels, createAgyRunner, lightestAgyModel } from './agy-cli';
import { createOpenCodeRunner, OPENCODE_MODEL_RE } from './opencode-cli';
import { AI_PROVIDERS, DEFAULT_PROVIDER, isProvider, type AiProvider, type AiRunner } from './types';

export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/** Nome de modelo válido para o provedor (o OpenCode usa `provider/modelo`). */
export const isModelFor = (provider: AiProvider, model: string): boolean => (provider === 'opencode-sub' ? OPENCODE_MODEL_RE : provider === 'agy-sub' ? AGY_MODEL_RE : MODEL_RE).test(model);

export type AiSettings = {
  provider: AiProvider;
  models: Partial<Record<AiProvider, string>>;
  /** Resultado do último "Testar" de cada provedor (a única forma de saber se o login de um CLI vale). */
  verified: Partial<Record<AiProvider, boolean>>;
  /** Modelo das tarefas auxiliares: 'auto' (o menor do mesmo provedor), 'same' (igual ao principal) ou o id de um modelo. */
  light?: string;
};

/** Lê `settings.ai` com tolerância: qualquer lixo vira o padrão (`claude-sub`), nada lança. */
export function resolveAiSettings(raw: unknown): AiSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const provider = isProvider(o.provider) ? o.provider : DEFAULT_PROVIDER;
  const models: AiSettings['models'] = {};
  const verified: AiSettings['verified'] = {};
  for (const id of AI_PROVIDERS) {
    const m = (o.models as Record<string, unknown> | undefined)?.[id];
    if (typeof m === 'string' && isModelFor(id, m)) models[id] = m;
    const v = (o.verified as Record<string, unknown> | undefined)?.[id];
    if (typeof v === 'boolean') verified[id] = v;
  }
  const light = o.light === 'same' ? 'same' : typeof o.light === 'string' && o.light !== 'auto' && isModelFor(provider, o.light) ? o.light : 'auto';
  return { provider, models, verified, light };
}

/** Quem lê os segredos e onde estão os executáveis; tudo injetável para testar. */
export type RunnerDeps = {
  getSecret: (provider: AiProvider) => Promise<string | null>;
  binaries: { claude: string; codex: string; opencode: string; agy: string };
  /** Pasta onde ficam os diretórios de trabalho dedicados (vazios) dos CLIs. */
  workDir: string;
  /** SÓ PARA TESTES: `--mcp-config` de um MCP falso para o chat com ferramentas (ver `ClaudeRunnerConfig.testMcpConfig`). */
  testMcpConfig?: string;
  fetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
};

export function createRunnerFor(provider: AiProvider, models: AiSettings['models'], deps: RunnerDeps): AiRunner {
  const model = models[provider];
  const key = () => deps.getSecret(provider);
  const api = { getKey: key, ...(model ? { model } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  const cli = (name: string, binary: string) => ({ binary, cwd: `${deps.workDir}/${name}`, ...(model ? { model } : {}), ...(deps.env ? { env: deps.env } : {}) });
  switch (provider) {
    case 'claude-sub':
      return createClaudeSubRunner({
        binary: deps.binaries.claude,
        cwd: `${deps.workDir}/claude-cwd`,
        getToken: key,
        ...(model ? { model } : {}),
        ...(deps.testMcpConfig ? { testMcpConfig: deps.testMcpConfig } : {}),
        ...(deps.env ? { env: deps.env } : {}),
      });
    case 'claude-api':
      return createClaudeApiRunner(api);
    case 'openai-api':
      return createOpenAiApiRunner(api);
    case 'gemini-api':
      return createGeminiApiRunner(api);
    case 'chatgpt-sub':
      return createCodexRunner(cli('codex-cwd', deps.binaries.codex));
    case 'opencode-sub':
      return createOpenCodeRunner(cli('opencode-cwd', deps.binaries.opencode));
    case 'agy-sub':
      return createAgyRunner({ binary: deps.binaries.agy, workDir: deps.workDir, ...(model ? { model } : {}), ...(deps.env ? { env: deps.env } : {}) });
  }
}

/** Runner do provedor ativo nas configurações. */
export function createRunner(settings: AiSettings, deps: RunnerDeps): AiRunner {
  return createRunnerFor(settings.provider, settings.models, deps);
}

/** Runner que relê as configurações a cada uso: trocar de provedor vale já na próxima nota ou pergunta. */
export function createActiveRunner(getSettings: () => Promise<AiSettings> | AiSettings, deps: RunnerDeps): AiRunner {
  return {
    async *run(options) {
      return yield* createRunner(await getSettings(), deps).run(options);
    },
  };
}

/** O "menor" de cada provedor, usado no modo Automático. ChatGPT (assinatura) procura um "mini" na lista da própria conta; OpenCode não tem. */
export const AUTO_LIGHT: Partial<Record<AiProvider, string>> = {
  'claude-sub': 'claude-haiku-5-5',
  'claude-api': 'claude-haiku-5-5',
  'openai-api': 'gpt-5-mini',
  'gemini-api': 'gemini-2.5-flash',
};

/** Modelo leve efetivo do provedor ativo, ou `undefined` quando vale o principal. */
export async function lightModelFor(settings: AiSettings, codex: () => Promise<CatalogModel[]> = codexModels, agy?: () => Promise<ReadonlyArray<{ id: string }>>): Promise<string | undefined> {
  const { provider } = settings;
  const light = settings.light ?? 'auto';
  if (light === 'same') return undefined;
  if (light !== 'auto') return isModelFor(provider, light) ? light : undefined;
  if (provider === 'chatgpt-sub') return (await codex().catch(() => [])).find((m) => /mini/i.test(m.id))?.id;
  if (provider === 'agy-sub') return agy ? lightestAgyModel(await agy().catch(() => [])) : undefined; // o Flash de esforço baixo da própria lista do agy
  return AUTO_LIGHT[provider];
}

/** Runner das etapas simples (resumos parciais, sugestões, ideias): mesmo provedor, modelo leve. Notas finais e chat ficam no principal. */
export function createLightRunner(getSettings: () => Promise<AiSettings> | AiSettings, deps: RunnerDeps, codex?: () => Promise<CatalogModel[]>): AiRunner {
  return {
    async *run(options) {
      const settings = await getSettings();
      const light = await lightModelFor(settings, codex, () => cachedAgyModels({ binary: deps.binaries.agy, workDir: deps.workDir, ...(deps.env ? { env: deps.env } : {}) }, true));
      const models = light ? { ...settings.models, [settings.provider]: light } : settings.models;
      return yield* createRunnerFor(settings.provider, models, deps).run(options);
    },
  };
}
