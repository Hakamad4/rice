import { describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { AUTO_LIGHT, createLightRunner, lightModelFor, resolveAiSettings, type AiSettings } from '../../src/main/ai/factory';
import { configureLongNotes } from '../../src/main/session/long-notes';
import { generateNotes } from '../../src/main/session/notes';
import { appendSegment, createMeeting } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const base = (over: Partial<AiSettings> = {}): AiSettings => ({ provider: 'claude-sub', models: {}, verified: {}, light: 'auto', ...over });

const FAKE_AGY = resolve(__dirname, '../fixtures/fake-agy.mjs');

describe('modelo leve do Antigravity', () => {
  test('automático: o Flash de esforço baixo da lista do próprio agy; sem Flash ou sem lista, o principal', async () => {
    const list = async () => [{ id: 'gemini-3.8-flash-high' }, { id: 'gemini-3.8-flash-low' }, { id: 'claude-sonnet-4-6' }];
    expect(await lightModelFor(base({ provider: 'agy-sub' }), undefined, list)).toBe('gemini-3.8-flash-low');
    expect(await lightModelFor(base({ provider: 'agy-sub' }), undefined, async () => [{ id: 'claude-sonnet-4-6' }])).toBeUndefined();
    expect(await lightModelFor(base({ provider: 'agy-sub' }), undefined, async () => { throw new Error('sem rede'); })).toBeUndefined();
    expect(await lightModelFor(base({ provider: 'agy-sub' }))).toBeUndefined();
    expect(await lightModelFor(base({ provider: 'agy-sub', light: 'same' }), undefined, list)).toBeUndefined();
    expect(await lightModelFor(base({ provider: 'agy-sub', light: 'claude-sonnet-4-6' }), undefined, list)).toBe('claude-sonnet-4-6');
  });
  test('a lista tem cache: o status da tela nunca espera (vazia na 1ª vez, depois cheia); a etapa leve espera', async () => {
    const { cachedAgyModels, clearAgyModelsCache } = await import('../../src/main/ai/agy-cli');
    clearAgyModelsCache();
    const config = { binary: FAKE_AGY, workDir: await makeTmpDir(), noSandbox: true };
    expect(await cachedAgyModels(config, false)).toEqual([]); // não esperou
    const waited = await cachedAgyModels(config, true);
    expect(waited.map((m) => m.id)).toContain('gemini-3.8-flash-low');
    expect((await cachedAgyModels(config, false)).length).toBe(waited.length); // agora vem do cache
    clearAgyModelsCache();
  });
});

describe('modelo leve', () => {
  test('automático: o menor do MESMO provedor', async () => {
    expect(await lightModelFor(base())).toBe('claude-haiku-5-5');
    expect(await lightModelFor(base({ provider: 'openai-api' }))).toBe('gpt-5-mini');
    expect(await lightModelFor(base({ provider: 'gemini-api' }))).toBe('gemini-2.5-flash');
    expect(await lightModelFor(base({ provider: 'chatgpt-sub' }), async () => [{ id: 'gpt-5', label: '' }, { id: 'gpt-5-mini', label: '' }])).toBe('gpt-5-mini');
    expect(await lightModelFor(base({ provider: 'chatgpt-sub' }), async () => [{ id: 'gpt-5', label: '' }])).toBeUndefined();
    expect(await lightModelFor(base({ provider: 'opencode-sub' }))).toBeUndefined(); // sem menor: o mesmo modelo
    expect(Object.values(AUTO_LIGHT).every((m) => !/opus|pro|sonnet/.test(m!))).toBe(true);
  });
  test('igual ao principal e escolha manual', async () => {
    expect(await lightModelFor(base({ light: 'same' }))).toBeUndefined();
    expect(await lightModelFor(base({ light: 'claude-sonnet-5-5' }))).toBe('claude-sonnet-5-5');
  });
  test('configuração tolerante: lixo vira automático', () => {
    expect(resolveAiSettings({ light: 'x y' }).light).toBe('auto');
    expect(resolveAiSettings({ light: 'same' }).light).toBe('same');
    expect(resolveAiSettings({ provider: 'claude-sub', light: 'claude-haiku-5-5' }).light).toBe('claude-haiku-5-5');
  });
  test('o runner leve entrega o modelo leve ao CLI certo (e o principal continua o do usuário)', async () => {
    const seen: string[][] = [];
    const deps: any = { getSecret: async () => null, binaries: { claude: '/nao/existe', codex: '', opencode: '' }, workDir: await makeTmpDir() };
    // o claude inexistente falha ao iniciar; o que importa é qual modelo o factory montou
    const { buildClaudeArgs } = await import('../../src/main/claude/runner');
    const light = await lightModelFor(base({ models: { 'claude-sub': 'claude-opus-5-5' } }));
    seen.push(buildClaudeArgs('s', light));
    seen.push(buildClaudeArgs('s', 'claude-opus-5-5'));
    expect(seen.map((a) => a[a.indexOf('--model') + 1])).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect(createLightRunner(() => base(), deps)).toBeTruthy();
  });
});

test('reunião longa: extrações por parte usam o runner leve; o passo final usa o principal', async () => {
  const startedAt = new Date('2026-01-01T10:00:00Z');
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Longa', startedAt, trigger: 'manual' });
  for (const [i, min] of [0, 20, 40].entries()) await appendSegment(dir, startedAt, { id: String(i), source: 'Outros', startMs: min * 60_000, endMs: min * 60_000 + 1000, text: `assunto ${i} `.repeat(30) });
  const calls: string[] = [];
  const mk = (name: string) => ({
    async *run() {
      calls.push(name);
      yield '';
      return name === 'main' ? '## Resumo\n\nfinal' : 'extração';
    },
  });
  configureLongNotes({ directMaxChars: 10, lightRunner: mk('light') as never });
  await generateNotes(dir, mk('main') as never);
  configureLongNotes({ directMaxChars: 60_000 });
  const lights = calls.filter((c) => c === 'light').length;
  expect(lights).toBeGreaterThanOrEqual(2);
  expect(calls.filter((c) => c === 'main')).toHaveLength(1);
  expect(calls.at(-1)).toBe('main');
});
