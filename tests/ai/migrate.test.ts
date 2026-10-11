import { describe, expect, test } from 'vitest';
import { planGeminiMigration } from '../../src/main/ai/migrate';
import { AI_PROVIDERS } from '../../src/main/ai/types';
import { resolveAiSettings } from '../../src/main/ai/factory';
import { modelCatalog } from '../../src/main/ai/catalog';

describe('Gemini por assinatura foi descontinuado: migração', () => {
  test('gemini-sub não está mais na lista de provedores', () => {
    expect(AI_PROVIDERS).not.toContain('gemini-sub');
    expect(AI_PROVIDERS).toContain('gemini-api');
  });
  test('com chave de API guardada vai para gemini-api; some a sobra do provedor antigo (modelo e verificação)', () => {
    const plan = planGeminiMigration({ provider: 'gemini-sub', models: { 'gemini-sub': 'gemini-2.5-pro', 'claude-api': 'claude-opus-5-5' }, verified: { 'gemini-sub': true, 'chatgpt-sub': true }, light: 'same' }, true)!;
    expect(plan.provider).toBe('gemini-api');
    expect(plan.ai).toEqual({ provider: 'gemini-api', models: { 'claude-api': 'claude-opus-5-5' }, verified: { 'chatgpt-sub': true }, light: 'same' });
  });
  test('sem chave: o primeiro provedor verificado; sem nenhum, o padrão', () => {
    expect(planGeminiMigration({ provider: 'gemini-sub', verified: { 'opencode-sub': true, 'chatgpt-sub': true } }, false)!.provider).toBe('chatgpt-sub'); // ordem da lista de provedores
    expect(planGeminiMigration({ provider: 'gemini-sub', verified: { 'gemini-sub': true } }, false)!.provider).toBe('claude-sub');
    expect(planGeminiMigration({ provider: 'gemini-sub' }, false)!.provider).toBe('claude-sub');
  });
  test('o resultado vale para resolveAiSettings e não migra o que não é do provedor antigo', () => {
    const plan = planGeminiMigration({ provider: 'gemini-sub' }, true)!;
    expect(resolveAiSettings(plan.ai).provider).toBe('gemini-api');
    expect(planGeminiMigration({ provider: 'claude-sub' }, true)).toBeNull();
    expect(planGeminiMigration(undefined, true)).toBeNull();
    expect(planGeminiMigration(null, false)).toBeNull();
  });
  test('catálogo de modelos do Gemini segue só pela API', async () => {
    expect((await modelCatalog('gemini-api')).length).toBeGreaterThan(0);
  });
});
