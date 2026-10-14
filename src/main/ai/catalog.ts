import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OPENCODE_FREE_MODEL, isFreeTierModel } from './opencode-cli';
import type { AiProvider } from './types';

/** Modelo oferecido no menu do chat. `id` vazio = "padrão" do provedor (nenhuma flag de modelo). */
export type CatalogModel = { id: string; label: string; free?: boolean };

/** Famílias Claude atuais (ids completos; o CLI e a API aceitam). */
export const CLAUDE_MODELS: CatalogModel[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];
export const OPENAI_API_MODELS: CatalogModel[] = [
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5 mini' },
];
export const GEMINI_MODELS: CatalogModel[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

const DEFAULT_ENTRY: CatalogModel = { id: '', label: '' }; // o rótulo "Padrão" é do renderer (i18n)

/**
 * Modelos do ChatGPT por assinatura: os que o próprio codex lista para a conta (`~/.codex/models_cache.json`), no máximo 4.
 * Sem o cache, só o padrão do codex.
 */
export async function codexModels(home = homedir()): Promise<CatalogModel[]> {
  try {
    const raw = JSON.parse(await readFile(join(home, '.codex', 'models_cache.json'), 'utf8')) as { models?: Array<{ slug?: unknown; id?: unknown }> };
    const slugs = (raw.models ?? []).map((m) => m.slug ?? m.id).filter((s): s is string => typeof s === 'string' && /^gpt-[A-Za-z0-9._-]+$/.test(s));
    return [...new Set(slugs)].slice(0, 4).map((id) => ({ id, label: id }));
  } catch {
    return [];
  }
}

/** Para o OpenCode: os modelos autenticados (sem os gratuitos) e, sempre, o gratuito do Zen como opção explícita. */
export function opencodeModels(listed: readonly string[]): CatalogModel[] {
  const paid = listed.filter((m) => !isFreeTierModel(m)).map((id) => ({ id, label: id }));
  return [...paid, { id: OPENCODE_FREE_MODEL, label: OPENCODE_FREE_MODEL, free: true }];
}

export type CatalogDeps = { codex?: () => Promise<CatalogModel[]>; opencode?: () => Promise<string[]>; agy?: () => Promise<CatalogModel[]>; local?: () => Promise<CatalogModel[]> };

/**
 * O que o menu de IA do chat mostra para cada provedor. Provedores sem escolha de modelo no CLI recebem o item
 * "padrão" (`id: ''`) para poder voltar ao que a conta usa.
 */
export async function modelCatalog(provider: AiProvider, deps: CatalogDeps = {}): Promise<CatalogModel[]> {
  switch (provider) {
    case 'claude-sub':
      return [DEFAULT_ENTRY, ...CLAUDE_MODELS];
    case 'claude-api':
      return CLAUDE_MODELS;
    case 'openai-api':
      return OPENAI_API_MODELS;
    case 'chatgpt-sub':
      return [DEFAULT_ENTRY, ...(await (deps.codex ?? codexModels)())];
    case 'gemini-api':
      return GEMINI_MODELS;
    case 'agy-sub':
      return [DEFAULT_ENTRY, ...(await (deps.agy?.() ?? Promise.resolve([])))];
    case 'opencode-sub':
      return [DEFAULT_ENTRY, ...opencodeModels(await (deps.opencode?.() ?? Promise.resolve([])))];
    case 'local-model':
      return [DEFAULT_ENTRY, ...(await (deps.local?.() ?? Promise.resolve([])))]; // "padrão" = o menor modelo instalado
  }
}
