import { AI_PROVIDERS, DEFAULT_PROVIDER, type AiProvider } from './types';

const RETIRED = 'gemini-sub'; // Gemini por assinatura (CLI com login Google): o Google desligou em 18/06/2026

/**
 * Migração das configurações salvas com o provedor aposentado. `hasGeminiKey`: há chave de API do Gemini guardada.
 * Escolha: gemini-api se houver chave; senão o primeiro provedor verificado; senão o padrão. Devolve `null` quando não há o que migrar.
 * Não toca em nada fora do `settings.ai` (nada de ~/.gemini, nada de credenciais).
 */
export function planGeminiMigration(rawAi: unknown, hasGeminiKey: boolean): { ai: Record<string, unknown>; provider: AiProvider } | null {
  const ai = (typeof rawAi === 'object' && rawAi !== null ? rawAi : {}) as Record<string, unknown>;
  if (ai.provider !== RETIRED) return null;
  const verified = (typeof ai.verified === 'object' && ai.verified !== null ? ai.verified : {}) as Record<string, unknown>;
  const models = (typeof ai.models === 'object' && ai.models !== null ? ai.models : {}) as Record<string, unknown>;
  const firstVerified = AI_PROVIDERS.find((id) => verified[id] === true);
  const provider: AiProvider = hasGeminiKey ? 'gemini-api' : (firstVerified ?? DEFAULT_PROVIDER);
  const { [RETIRED]: _v, ...keptVerified } = verified;
  const { [RETIRED]: _m, ...keptModels } = models;
  return { provider, ai: { ...ai, provider, models: keptModels, verified: keptVerified } };
}
