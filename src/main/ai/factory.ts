import { codexModels, type CatalogModel } from './catalog';
import { createClaudeApiRunner } from './claude-api';
import { createClaudeSubRunner } from './claude-sub';
import { createCodexRunner } from './codex-cli';
import { createGeminiApiRunner } from './gemini-api';
import type { FetchLike } from './http-stream';
import { createOpenAiApiRunner } from './openai-api';
import { AGY_MODEL_RE, cachedAgyModels, createAgyRunner, lightestAgyModel } from './agy-cli';
import { createOpenCodeRunner, OPENCODE_MODEL_RE } from './opencode-cli';
import { createRedactor } from '../privacy/redact';
import { newEgress, viaOf, type EgressRecord } from '../privacy/egress';
import { createLocalRunner, isLocalModelName, isLocalServerId, isNumCtx, smallestLocalModel, resolveLocalServer, type LocalConfig, type LocalServer } from './local-model';
import { AI_PROVIDERS, DEFAULT_PROVIDER, isProvider, type AiProvider, type AiRunner, type AiRunOptions } from './types';

export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/** Nome de modelo válido para o provedor (o OpenCode usa `provider/modelo`). */
export const isModelFor = (provider: AiProvider, model: string): boolean => (provider === 'local-model' ? isLocalModelName(model) : (provider === 'opencode-sub' ? OPENCODE_MODEL_RE : provider === 'agy-sub' ? AGY_MODEL_RE : MODEL_RE).test(model));

export type AiSettings = {
  provider: AiProvider;
  models: Partial<Record<AiProvider, string>>;
  /** Resultado do último "Testar" de cada provedor (a única forma de saber se o login de um CLI vale). */
  verified: Partial<Record<AiProvider, boolean>>;
  /** Modelo das tarefas auxiliares: 'auto' (o menor do mesmo provedor), 'same' (igual ao principal) ou o id de um modelo. */
  light?: string;
  /** Modelo local: endereço do servidor (só localhost) e tamanho do contexto (`num_ctx`). */
  local?: LocalConfig;
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
  const rawLocal = (typeof o.local === 'object' && o.local !== null ? o.local : {}) as Record<string, unknown>;
  const local: LocalConfig = { ...(typeof rawLocal.url === 'string' && rawLocal.url.trim() ? { url: rawLocal.url.trim().slice(0, 200) } : {}), ...(isNumCtx(rawLocal.numCtx) ? { numCtx: rawLocal.numCtx } : {}), ...(isLocalServerId(rawLocal.server) && rawLocal.server !== 'auto' ? { server: rawLocal.server } : {}) };
  return { provider, models, verified, light, ...(Object.keys(local).length > 0 ? { local } : {}) };
}

/** Quem lê os segredos e onde estão os executáveis; tudo injetável para testar. */
export type RunnerDeps = {
  getSecret: (provider: AiProvider) => Promise<string | null>;
  binaries: { claude: string; codex: string; opencode: string; agy: string };
  /** Pasta onde ficam os diretórios de trabalho dedicados (vazios) dos CLIs. */
  workDir: string;
  /** SÓ PARA TESTES: `--mcp-config` de um MCP falso para o chat com ferramentas (ver `ClaudeRunnerConfig.testMcpConfig`). */
  testMcpConfig?: string;
  /** Modelo local: lê o endereço e o contexto das configurações a cada uso. */
  local?: () => LocalConfig | Promise<LocalConfig>;
  /** Ocultar dados pessoais ao enviar para a IA (pasta sensível ou opção global): decide por chamada, a partir do contexto (reunião). Modelo local nunca oculta (nada sai). */
  shouldRedact?: (ctx: AiRunOptions['egress']) => Promise<boolean> | boolean;
  /** Recibo de privacidade: recebe um registro (só metadados) a cada chamada à IA, com as pastas das reuniões envolvidas (vazio = sem contexto). */
  egress?: (dirs: readonly string[], record: EgressRecord) => void | Promise<void>;
  /** RAM total (bytes) para o modelo "Automático" do Modelo local; padrão `os.totalmem()`. SÓ PARA TESTES. */
  totalRam?: () => number;
  fetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
};

/** Modelos instalados no servidor local configurado (vazio se não responder). */
export async function installedLocalModels(deps: RunnerDeps): Promise<LocalServer['models']> {
  const server = await resolveLocalServer((await deps.local?.()) ?? {}, deps.fetch ?? ((url, init) => fetch(url, init))).catch(() => null);
  return server?.models ?? [];
}

/**
 * O ponto central do recibo de privacidade: TODO runner sai daqui, então toda chamada à IA (notas, chat, ideias, war room,
 * capturas, e-mail…) é registrada em um lugar só. Só metadados: quando, o quê, para qual provedor, quanto (caracteres e imagens).
 */
function withEgress(provider: AiProvider, inner: AiRunner, deps: RunnerDeps): AiRunner {
  const sink = deps.egress;
  if (!sink && !deps.shouldRedact) return inner;
  return {
    async *run(options) {
      let ok = false;
      // dados pessoais ocultados antes de sair; o mapa (marcador -> valor) vive só nesta chamada e a resposta é restaurada aqui mesmo
      const redactor = provider !== 'local-model' && deps.shouldRedact && (await deps.shouldRedact(options.egress)) ? createRedactor() : null;
      const { images: _images, ...rest } = options;
      // imagens não dá para ocultar: com a ocultação ligada elas não vão
      const sent = redactor ? { ...rest, system: redactor.redact(options.system), prompt: redactor.redact(options.prompt) } : options;
      try {
        if (!redactor) {
          const full = yield* inner.run(sent);
          ok = true;
          return full;
        }
        const restoring = redactor.stream();
        const gen = inner.run(sent);
        for (;;) {
          const step = await gen.next();
          if (step.done) {
            const tail = restoring.flush();
            if (tail) yield tail;
            ok = true;
            return redactor.restore(step.value);
          }
          const text = restoring.feed(step.value);
          if (text) yield text;
        }
      } finally {
        const ctx = options.egress;
        const dirs = ctx?.dirs ? [...ctx.dirs] : ctx?.dir ? [ctx.dir] : [];
        const record = newEgress({
          kind: ctx?.kind ?? 'other',
          provider,
          via: viaOf(provider),
          items: { text: sent.system.length + sent.prompt.length, images: redactor ? 0 : options.images?.length ?? 0 },
          ok,
          ...(options.tools?.web ? { web: true as const } : {}),
          ...(redactor && redactor.count() > 0 ? { redacted: redactor.count() } : {}),
        });
        if (sink) void Promise.resolve(sink(dirs, record)).catch(() => {}); // o recibo nunca derruba a chamada
      }
    },
  };
}

export function createRunnerFor(provider: AiProvider, models: AiSettings['models'], deps: RunnerDeps): AiRunner {
  return withEgress(provider, buildRunner(provider, models, deps), deps);
}

function buildRunner(provider: AiProvider, models: AiSettings['models'], deps: RunnerDeps): AiRunner {
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
    case 'local-model':
      return createLocalRunner({ getConfig: () => deps.local?.() ?? {}, ...(deps.totalRam ? { totalRam: deps.totalRam } : {}), ...(model ? { model } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}) });
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
export async function lightModelFor(settings: AiSettings, codex: () => Promise<CatalogModel[]> = codexModels, agy?: () => Promise<ReadonlyArray<{ id: string }>>, local?: () => Promise<ReadonlyArray<{ id: string; size?: number }>>): Promise<string | undefined> {
  const { provider } = settings;
  const light = settings.light ?? 'auto';
  if (light === 'same') return undefined;
  if (light !== 'auto') return isModelFor(provider, light) ? light : undefined;
  if (provider === 'chatgpt-sub') return (await codex().catch(() => [])).find((m) => /mini/i.test(m.id))?.id;
  if (provider === 'local-model') return local ? smallestLocalModel(await local().catch(() => [])) : undefined; // o menor modelo local instalado
  if (provider === 'agy-sub') return agy ? lightestAgyModel(await agy().catch(() => [])) : undefined; // o Flash de esforço baixo da própria lista do agy
  return AUTO_LIGHT[provider];
}

/** Runner das etapas simples (resumos parciais, sugestões, ideias): mesmo provedor, modelo leve. Notas finais e chat ficam no principal. */
export function createLightRunner(getSettings: () => Promise<AiSettings> | AiSettings, deps: RunnerDeps, codex?: () => Promise<CatalogModel[]>): AiRunner {
  return {
    async *run(options) {
      const settings = await getSettings();
      const light = await lightModelFor(settings, codex, () => cachedAgyModels({ binary: deps.binaries.agy, workDir: deps.workDir, ...(deps.env ? { env: deps.env } : {}) }, true), () => installedLocalModels(deps));
      const models = light ? { ...settings.models, [settings.provider]: light } : settings.models;
      return yield* createRunnerFor(settings.provider, models, deps).run(options);
    },
  };
}
