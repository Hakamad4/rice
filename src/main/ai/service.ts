import { t, tn } from '../i18n';
import { existsSync } from 'node:fs';
import { totalmem } from 'node:os';
import { delimiter, isAbsolute } from 'node:path';
import { listAgyModels } from './agy-cli';
import { aiError } from './errors';
import { createRunnerFor, isModelFor, type AiSettings, type RunnerDeps } from './factory';
import { isFreeTierModel, listOpenCodeModels, openCodeLoggedIn } from './opencode-cli';
import { listClaudeModels } from './claude-api';
import { listGeminiModels } from './gemini-api';
import { listOpenAiModels } from './openai-api';
import { friendlyModelName, largestFittingModel, resolveLocalServer, DEFAULT_NUM_CTX, isNumCtx, type LocalConfig, type LocalModel } from './local-model';
import { agySupported, findCli, isWindows } from '../platform';
import { describeSecret } from './secrets';
import { AI_PROVIDERS, AiError, hasKeyField, type AiProvider } from './types';

export type ProviderStatus = {
  connected: boolean;
  detail: string;
  hasKey: boolean;
  last4?: string;
  /** Resultado do último "Testar conexão" (ausente = nunca testou). */
  verified?: boolean;
  /** Só CLIs: o executável foi encontrado. */
  installed?: boolean;
  /** O provedor não existe nesta plataforma (Antigravity no Windows): a tela mostra só o motivo, sem passos nem botões. */
  unavailable?: boolean;
  /** Só OpenCode: há pelo menos um provedor autenticado na CLI. */
  loggedIn?: boolean;
  /** Só Modelo local: o que o servidor respondeu (nada disso é segredo). */
  local?: { url: string; /** servidor escolhido no seletor ('auto' = detecta) */ server: string; /** nome do servidor encontrado ('LM Studio') */ serverName?: string; /** o modelo que o "Automático" escolhe (o maior de texto que cabe na RAM) */ autoModel?: { id: string; label: string }; /** o que o usuário digitou (vazio = detecção automática) */ configuredUrl: string; kind: 'ollama' | 'openai' | null; models: LocalModel[]; numCtx: number; error?: string };
};

export type AiStatus = { active: AiProvider; models: AiSettings['models']; providers: Record<AiProvider, ProviderStatus> };

const cliInstalled = (binary: string): boolean => {
  if (isAbsolute(binary)) return existsSync(binary);
  if (isWindows()) return findCli(binary) !== null; // Path, PATHEXT (.exe/.cmd) e as pastas do npm
  return (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(`${dir}/${binary}`));
};

/** Sondagem do servidor local (rápida, só localhost); vale por poucos segundos para a tela de configurações não sondar a cada desenho. */
export const LOCAL_PROBE_CACHE_MS = 6_000;
const localCache = new Map<string, { at: number; value: Promise<Awaited<ReturnType<typeof resolveLocalServer>>> }>();
export function cachedLocalServer(cfg: LocalConfig, fetchImpl: NonNullable<RunnerDeps['fetch']>, now: number) {
  const key = cfg.url?.trim() ?? '';
  const hit = localCache.get(key);
  if (hit && now - hit.at < LOCAL_PROBE_CACHE_MS) return hit.value;
  const value = resolveLocalServer(cfg, fetchImpl);
  localCache.set(key, { at: now, value });
  value.catch(() => localCache.delete(key));
  return value;
}

/** `opencode auth list` leva ~0,3 s: o resultado vale por alguns minutos (e some quando o usuário testa, troca ou salva algo). */
export const LOGIN_CACHE_MS = 5 * 60_000;
/** "Não logado" vale só alguns segundos: quem acabou de fazer o login no terminal não espera minutos. */
export const NO_LOGIN_CACHE_MS = 20_000;
const loginCache = new Map<string, { at: number; value: Promise<boolean>; ok?: boolean }>();
export const invalidateAiStatus = (): void => {
  loginCache.clear();
  localCache.clear();
};

function cachedOpenCodeLogin(binary: string, run: () => Promise<boolean>, now: number): Promise<boolean> {
  const hit = loginCache.get(binary);
  if (hit && now - hit.at < (hit.ok === false ? NO_LOGIN_CACHE_MS : LOGIN_CACHE_MS)) return hit.value;
  const entry: { at: number; value: Promise<boolean>; ok?: boolean } = { at: now, value: run() };
  loginCache.set(binary, entry);
  entry.value.then((ok) => (entry.ok = ok), () => loginCache.delete(binary));
  return entry.value;
}

/** Estado de cada provedor sem gastar nenhuma chamada de IA: login de CLI só se confirma no "Testar". Os provedores são consultados em paralelo. */
export async function aiStatus(settings: AiSettings, deps: RunnerDeps, now: number = Date.now()): Promise<AiStatus> {
  const providers = {} as Record<AiProvider, ProviderStatus>;
  await Promise.all(AI_PROVIDERS.map(async (id) => {
    const secret = hasKeyField(id) ? await deps.getSecret(id) : null;
    const { hasKey, last4 } = describeSecret(secret);
    const verified = settings.verified[id];
    const base = { hasKey, ...(last4 ? { last4 } : {}), ...(verified !== undefined ? { verified } : {}) };
    if (id === 'chatgpt-sub') {
      const binary = deps.binaries.codex;
      const installed = cliInstalled(binary);
      const name = 'Codex';
      providers[id] = {
        ...base,
        installed,
        connected: installed && verified === true,
        detail: !installed ? t('ai.status.cli-missing', { name }) : verified === true ? t('ai.status.connected') : verified === false ? t('ai.status.test-failed') : t('ai.status.cli-found', { name }),
      };
    } else if (id === 'agy-sub' && !agySupported()) {
      providers[id] = { ...base, installed: false, connected: false, unavailable: true, detail: t('ai.status.agy-mac-only') };
    } else if (id === 'agy-sub') {
      const installed = cliInstalled(deps.binaries.agy);
      providers[id] = {
        ...base,
        installed,
        connected: installed && verified === true,
        detail: !installed ? t('ai.status.cli-missing', { name: 'Antigravity (agy)' }) : verified === true ? t('ai.status.connected') : verified === false ? t('ai.status.test-failed') : t('ai.status.cli-found', { name: 'Antigravity (agy)' }),
      };
    } else if (id === 'opencode-sub') {
      const installed = cliInstalled(deps.binaries.opencode);
      const freeChosen = isFreeTierModel(settings.models[id] ?? '');
      const freeOk = verified === true && freeChosen;
      const loggedIn = installed && (await cachedOpenCodeLogin(deps.binaries.opencode, () => openCodeLoggedIn({ binary: deps.binaries.opencode, cwd: `${deps.workDir}/opencode-cwd`, ...(deps.env ? { env: deps.env } : {}) }), now));
      providers[id] = {
        ...base,
        installed,
        loggedIn,
        connected: installed && (loggedIn || freeOk),
        detail: !installed ? t('ai.status.cli-missing', { name: 'OpenCode' }) : loggedIn ? (verified === true ? t('ai.status.connected') : t('ai.status.opencode-logged-in')) : freeOk ? t('ai.status.opencode-free') : t('ai.status.opencode-no-login'),
      };
    } else if (id === 'local-model') {
      const cfg = (await deps.local?.()) ?? {};
      const numCtx = isNumCtx(cfg.numCtx) ? cfg.numCtx : DEFAULT_NUM_CTX;
      let server: Awaited<ReturnType<typeof resolveLocalServer>> = null;
      let error: string | undefined;
      try {
        server = await cachedLocalServer(cfg, deps.fetch ?? ((url, init) => fetch(url, init)), now);
      } catch (err) {
        error = err instanceof AiError ? err.message : (err as Error).message; // endereço que não é localhost
      }
      const auto = server ? largestFittingModel(server.models, (deps.totalRam ?? totalmem)()) : undefined;
      const name = server?.name ?? t('ai.local.server-generic');
      providers[id] = {
        ...base,
        installed: server !== null,
        connected: server !== null && server.models.length > 0,
        detail: error ?? (!server ? t('ai.local.status.none') : server.models.length === 0 ? t('ai.local.status.no-models', { server: name }) : tn('ai.local.status.ready', server.models.length, { server: name })),
        local: { ...(auto ? { autoModel: { id: auto, label: friendlyModelName(auto) } } : {}), server: cfg.server ?? 'auto', ...(server ? { serverName: server.name } : {}), url: server?.url ?? cfg.url ?? '', configuredUrl: cfg.url ?? '', kind: server?.kind ?? null, models: server?.models ?? [], numCtx, ...(error ? { error } : {}) },
      };
    } else if (id === 'claude-sub') {
      providers[id] = {
        ...base,
        connected: hasKey || verified === true,
        detail: hasKey ? t('ai.status.token-saved', { last4: last4 ?? '' }) : verified === true ? t('ai.status.using-cli-login') : t('ai.status.no-token'),
      };
    } else {
      providers[id] = { ...base, connected: hasKey, detail: hasKey ? t('ai.status.key-saved', { last4: last4 ?? '' }) : t('ai.status.no-key') };
    }
  }));
  return { active: settings.provider, models: settings.models, providers };
}

/** "Responda só: ok" no provedor pedido (não necessariamente o ativo). Nunca devolve segredo. */
export async function testProvider(provider: AiProvider, settings: AiSettings, deps: RunnerDeps): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const run = createRunnerFor(provider, settings.models, deps).run({ system: 'Responda exatamente o que for pedido, sem mais nada.', prompt: 'Responda só: ok' });
    for (;;) if ((await run.next()).done) break;
    return { ok: true, message: t('ai.test.ok') };
  } catch (err) {
    return { ok: false, message: err instanceof AiError ? err.message : aiError(provider, 'other', (err as Error).message).message };
  }
}

export async function listModels(provider: AiProvider, deps: RunnerDeps): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
  if (provider === 'agy-sub') return { ok: true, models: (await listAgyModels({ binary: deps.binaries.agy, workDir: deps.workDir, ...(deps.env ? { env: deps.env } : {}) })).map((m) => m.id) };
  if (provider === 'opencode-sub') {
    const models = await listOpenCodeModels({ binary: deps.binaries.opencode, cwd: `${deps.workDir}/opencode-cwd`, ...(deps.env ? { env: deps.env } : {}) });
    return { ok: true, models };
  }
  if (provider === 'local-model') {
    try {
      const server = await cachedLocalServer((await deps.local?.()) ?? {}, deps.fetch ?? ((url, init) => fetch(url, init)), Date.now());
      return server ? { ok: true, models: server.models.map((m) => m.id) } : { ok: false, message: t('ai.local.status.none') };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
  if (provider !== 'claude-api' && provider !== 'openai-api' && provider !== 'gemini-api') return { ok: false, message: t('ai.models.unsupported') };
  const key = await deps.getSecret(provider);
  if (!key) return { ok: false, message: t('ai.models.need-key') };
  try {
    const f = deps.fetch;
    const models = provider === 'claude-api' ? await listClaudeModels(key, f) : provider === 'openai-api' ? await listOpenAiModels(key, f) : await listGeminiModels(key, f);
    return { ok: true, models: models.filter((m) => isModelFor(provider, m)) };
  } catch (err) {
    return { ok: false, message: err instanceof AiError ? err.message : aiError(provider, 'other', (err as Error).message, [key]).message };
  }
}
