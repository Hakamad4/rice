import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createActiveRunner, createRunner, resolveAiSettings, type AiSettings, type RunnerDeps } from '../../src/main/ai/factory';
import type { FetchLike } from '../../src/main/ai/http-stream';
import { aiStatus, listModels, testProvider } from '../../src/main/ai/service';
import type { AiProvider, AiRunner } from '../../src/main/ai/types';
import { makeTmpDir } from '../helpers/tmp';

const FAKE_CODEX = resolve(__dirname, '../fixtures/fake-codex.mjs');
const FAKE_OPENCODE = resolve(__dirname, '../fixtures/fake-opencode.mjs');
const FAKE_CLAUDE = resolve(__dirname, '../fixtures/fake-claude.mjs');

const enc = new TextEncoder();
const sse = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), { status: 200 });
const claudeSse = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"claude-api"}}\n\ndata: {"type":"message_stop"}\n\n';
const openaiSse = 'data: {"type":"response.output_text.delta","delta":"openai-api"}\n\ndata: {"type":"response.completed"}\n\n';
const geminiSse = 'data: {"candidates":[{"content":{"parts":[{"text":"gemini-api"}]}}]}\n\n';

const secrets: Partial<Record<AiProvider, string>> = {
  'claude-sub': 'sk-ant-oat01-token-assinatura-123',
  'claude-api': 'sk-ant-api03-chave-api-1234567890',
  'openai-api': 'sk-proj-chave-openai-1234567890',
  'gemini-api': 'AIzaSyChave-gemini-1234567890',
};

async function deps(over: Partial<RunnerDeps> = {}): Promise<RunnerDeps> {
  const fetchMock = vi.fn(async (url: string) => (url.includes('anthropic') ? sse(claudeSse) : url.includes('openai') ? sse(openaiSse) : sse(geminiSse)));
  return {
    getSecret: async (p) => secrets[p] ?? null,
    binaries: { claude: FAKE_CLAUDE, codex: FAKE_CODEX, opencode: FAKE_OPENCODE, agy: '/nao/existe/agy' },
    workDir: await makeTmpDir(),
    fetch: fetchMock as unknown as FetchLike,
    env: { ...process.env, FAKE_CLAUDE_MODE: 'ok' },
    ...over,
  };
}

const text = async (runner: AiRunner) => {
  const gen = runner.run({ system: 's', prompt: 'p' });
  for (;;) {
    const step = await gen.next();
    if (step.done) return step.value;
  }
};
const settings = (provider: AiProvider, extra: Partial<AiSettings> = {}): AiSettings => ({ provider, models: {}, verified: {}, ...extra });

describe('resolveAiSettings', () => {
  test('padrão é claude-sub e lixo vira padrão', () => {
    expect(resolveAiSettings(undefined)).toEqual({ provider: 'claude-sub', models: {}, verified: {}, light: 'auto' });
    expect(resolveAiSettings({ provider: 'gemini-sub' }).provider).toBe('claude-sub'); // sem migrar, cai no padrão
    expect(resolveAiSettings({ provider: 'gpt-9000', models: { 'openai-api': '--evil', 'claude-api': 'claude-opus-5-5', x: 'y' }, verified: { 'gemini-sub': 'sim' } })).toEqual({
      provider: 'claude-sub',
      models: { 'claude-api': 'claude-opus-5-5' },
      verified: {},
      light: 'auto',
    });
    expect(resolveAiSettings({ provider: 'gemini-api', verified: { 'gemini-sub': true } })).toMatchObject({ provider: 'gemini-api', verified: {} }); // o provedor aposentado não volta
  });
});

describe('createRunner escolhe o provedor certo', () => {
  test('os 6 provedores respondem pelo seu próprio caminho', async () => {
    const d = await deps();
    expect(await text(createRunner(settings('claude-sub'), d))).toBe('Olá mundo'); // fake-claude
    expect(await text(createRunner(settings('claude-api'), d))).toBe('claude-api');
    expect(await text(createRunner(settings('openai-api'), d))).toBe('openai-api');
    expect(await text(createRunner(settings('gemini-api'), d))).toBe('gemini-api');
    expect(await text(createRunner(settings('chatgpt-sub'), d))).toBe('Primeira parte.\n\nSegunda parte.'); // fake-codex
  });

  test('usa o modelo salvo para o provedor ativo', async () => {
    const d = await deps();
    await text(createRunner(settings('openai-api', { models: { 'openai-api': 'gpt-5' } }), d));
    const body = JSON.parse(((d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('gpt-5');
  });

  test('createActiveRunner relê as configurações a cada uso (trocar de provedor vale na hora)', async () => {
    const d = await deps();
    let current = settings('claude-api');
    const runner = createActiveRunner(() => current, d);
    expect(await text(runner)).toBe('claude-api');
    current = settings('openai-api');
    expect(await text(runner)).toBe('openai-api');
  });

  test('o token do claude-sub vai só como CLAUDE_CODE_OAUTH_TOKEN e as outras chaves herdadas não vazam', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const d = await deps({ env: { ...process.env, FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_RECORD: record, OPENAI_API_KEY: 'herdada', GEMINI_API_KEY: 'herdada' } });
    await text(createRunner(settings('claude-sub'), d));
    const rec = JSON.parse(await readFile(record, 'utf8'));
    expect(rec.oauthToken).toBe(secrets['claude-sub']);
    expect(rec.hasApiKey).toBe(false);
  });
});

test('mensagem de erro do claude-sub nunca inclui o token', async () => {
  const d = await deps({ env: { ...process.env, FAKE_CLAUDE_MODE: 'echo-token' } });
  const err = (await text(createRunner(settings('claude-sub'), d)).catch((e) => e)) as Error;
  expect(err.message).toContain('***');
  expect(err.message).not.toContain(secrets['claude-sub']!);
});

describe('status, teste e modelos', () => {
  test('status nunca devolve a chave, só hasKey e os 4 últimos', async () => {
    const d = await deps();
    const status = await aiStatus(settings('claude-api'), d);
    expect(status.active).toBe('claude-api');
    expect(status.providers['claude-api']).toMatchObject({ connected: true, hasKey: true, last4: '7890' });
    expect(status.providers['claude-sub']).toMatchObject({ connected: true, hasKey: true });
    expect(status.providers['chatgpt-sub']).toMatchObject({ connected: false, installed: true });
    expect(JSON.stringify(status)).not.toContain(secrets['claude-api']!);
    expect(JSON.stringify(status)).not.toContain(secrets['openai-api']!);
    expect(JSON.stringify(status)).not.toContain(secrets['gemini-api']!);
  });

  test('CLI só aparece conectado depois de um teste bem-sucedido; sem executável → não instalado', async () => {
    const d = await deps();
    expect((await aiStatus(settings('chatgpt-sub', { verified: { 'chatgpt-sub': true } }), d)).providers['chatgpt-sub']).toMatchObject({ connected: true });
    expect((await aiStatus(settings('chatgpt-sub', { verified: { 'chatgpt-sub': false } }), d)).providers['chatgpt-sub'].detail).toMatch(/Teste falhou/);
    const missing = await deps({ binaries: { claude: FAKE_CLAUDE, codex: '/nao/existe/codex', opencode: '/nao/existe/opencode', agy: '/nao/existe/agy' } });
    expect((await aiStatus(settings('claude-sub'), missing)).providers['chatgpt-sub']).toMatchObject({ installed: false, connected: false });
    expect(Object.keys((await aiStatus(settings('claude-sub'), missing)).providers)).not.toContain('gemini-sub'); // aposentado
  });

  test('testar roda "Responda só: ok" no provedor pedido, mesmo que não seja o ativo', async () => {
    const d = await deps();
    expect(await testProvider('openai-api', settings('claude-sub'), d)).toEqual({ ok: true, message: 'Conexão funcionando.' });
    const fail = await testProvider('chatgpt-sub', settings('claude-sub'), await deps({ env: { ...process.env, FAKE_MODE: 'rate' } }));
    expect(fail.ok).toBe(false);
    expect(fail.message).toMatch(/Limite de uso do ChatGPT/);
    const noKey = await testProvider('claude-api', settings('claude-sub'), await deps({ getSecret: async () => null }));
    expect(noKey).toMatchObject({ ok: false, message: expect.stringContaining('chave de API do Claude foi recusada') });
  });

  test('lista modelos só das APIs e só com chave salva', async () => {
    const list = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5' }, { id: '--evil flag' }] }), { status: 200 }));
    expect(await listModels('claude-api', await deps({ fetch: list as unknown as FetchLike }))).toEqual({ ok: true, models: ['claude-sonnet-5-5'] });
    expect(await listModels('chatgpt-sub', await deps())).toMatchObject({ ok: false });
    expect(await listModels('openai-api', await deps({ getSecret: async () => null }))).toMatchObject({ ok: false, message: expect.stringContaining('Salve a chave') });
  });
});
