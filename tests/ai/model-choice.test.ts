import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { codexModels, modelCatalog, opencodeModels } from '../../src/main/ai/catalog';
import { createRunnerFor, isModelFor, type RunnerDeps } from '../../src/main/ai/factory';
import type { FetchLike } from '../../src/main/ai/http-stream';
import { AI_PROVIDERS, type AiProvider, type AiRunner } from '../../src/main/ai/types';
import { buildClaudeArgs } from '../../src/main/claude/runner';
import { makeTmpDir } from '../helpers/tmp';

const fx = (name: string) => resolve(__dirname, `../fixtures/${name}`);
const enc = new TextEncoder();
const sse = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), { status: 200 });

async function drain(runner: AiRunner): Promise<void> {
  const gen = runner.run({ system: 's', prompt: 'p' });
  for (;;) if ((await gen.next()).done) return;
}

/** O que cada provedor recebeu: flag do CLI ou campo/URL da API. */
async function received(provider: AiProvider, model: string | undefined): Promise<{ args?: string[]; body?: Record<string, unknown>; url?: string }> {
  const record = join(await makeTmpDir(), 'rec.json');
  const calls: Array<{ url: string; body: string }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body ?? '') });
    return sse(url.includes('anthropic') ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\ndata: {"type":"message_stop"}\n\n' : url.includes('openai') ? 'data: {"type":"response.output_text.delta","delta":"x"}\n\ndata: {"type":"response.completed"}\n\n' : 'data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n\n');
  });
  const deps: RunnerDeps = {
    getSecret: async () => 'chave-qualquer-1234567890',
    binaries: { claude: fx('fake-claude.mjs'), codex: fx('fake-codex.mjs'), opencode: fx('fake-opencode.mjs'), agy: '/nao/existe/agy' },
    workDir: await makeTmpDir(),
    fetch: fetchMock as unknown as FetchLike,
    env: { ...process.env, FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_RECORD: record, FAKE_RECORD: record, FAKE_MODELS: 'anthropic/claude-sonnet-4-5\n', FAKE_AUTH: 'anthropic\n' },
  };
  await drain(createRunnerFor(provider, model ? { [provider]: model } : {}, deps));
  if (provider.endsWith('-api')) {
    const call = calls.find((c) => !c.url.includes('/models?'))!;
    return { url: call.url, body: JSON.parse(call.body || '{}') };
  }
  return { args: JSON.parse(await readFile(record, 'utf8')).args };
}

const flagAfter = (args: string[] | undefined, flag: string) => (args && args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

describe('o modelo escolhido chega a cada provedor', () => {
  test('claude-sub: --model; sem escolha, nenhuma flag', async () => {
    expect(flagAfter((await received('claude-sub', 'claude-opus-5-5')).args, '--model')).toBe('claude-opus-5-5');
    expect((await received('claude-sub', undefined)).args).not.toContain('--model');
    expect(buildClaudeArgs('sys', '--evil')).not.toContain('--model'); // nome inválido é ignorado
  });

  test.each([['chatgpt-sub', '-m', 'gpt-5.5']] as const)('%s: %s', async (provider, flag, model) => {
    expect(flagAfter((await received(provider, model)).args, flag)).toBe(model);
    expect((await received(provider, undefined)).args).not.toContain(flag);
  });

  test('opencode-sub: -m provedor/modelo', async () => {
    expect(flagAfter((await received('opencode-sub', 'anthropic/claude-sonnet-4-5')).args, '-m')).toBe('anthropic/claude-sonnet-4-5');
  });

  test('APIs: campo model (Claude, OpenAI) e modelo na URL (Gemini)', async () => {
    expect((await received('claude-api', 'claude-haiku-5-5')).body).toMatchObject({ model: 'claude-haiku-5-5' });
    expect((await received('openai-api', 'gpt-5')).body).toMatchObject({ model: 'gpt-5' });
    expect((await received('gemini-api', 'gemini-2.5-pro')).url).toContain('/models/gemini-2.5-pro:');
  });
});

describe('catálogo do menu de IA', () => {
  test('todo modelo oferecido é aceito pelo validador do provedor (o menu nunca grava um id que o main recusa)', async () => {
    for (const provider of AI_PROVIDERS) {
      const models = await modelCatalog(provider, { codex: async () => [{ id: 'gpt-5.5', label: 'gpt-5.5' }], opencode: async () => ['anthropic/claude-sonnet-4-5'] });
      expect(models.length, provider).toBeGreaterThan(0);
      for (const m of models) if (m.id) expect(isModelFor(provider, m.id), `${provider}: ${m.id}`).toBe(true);
    }
  });

  test('Claude: Opus, Sonnet e Haiku da família atual; assinatura ganha o item "padrão" (id vazio)', async () => {
    expect((await modelCatalog('claude-api')).map((m) => m.label)).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
    expect((await modelCatalog('claude-sub'))[0]).toEqual({ id: '', label: '' });
    expect((await modelCatalog('gemini-api')).map((m) => m.id)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
  });

  test('ChatGPT por assinatura: lê os modelos do cache do codex (no máx. 4); sem cache só o padrão', async () => {
    const home = await makeTmpDir();
    expect(await codexModels(home)).toEqual([]);
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6-luna' }, { slug: 'codex-auto-review' }, { slug: 'gpt-5.5' }, { slug: 'gpt-5.5' }, { slug: 'gpt-5.4' }, { slug: 'gpt-5.3' }, { slug: 'gpt-5.2' }] }));
    expect((await codexModels(home)).map((m) => m.id)).toEqual(['gpt-6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3']);
    expect(await modelCatalog('chatgpt-sub', { codex: async () => [] })).toEqual([{ id: '', label: '' }]);
  });

  test('OpenCode: só os autenticados e, sempre, o gratuito do Zen marcado como `free` (nunca o gratuito listado como pago)', () => {
    const models = opencodeModels(['anthropic/claude-sonnet-4-5', 'opencode/big-pickle', 'openrouter/x/y:free']);
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-4-5', 'opencode/big-pickle']);
    expect(models.at(-1)).toMatchObject({ free: true });
    expect(models.filter((m) => m.free)).toHaveLength(1);
  });
});
