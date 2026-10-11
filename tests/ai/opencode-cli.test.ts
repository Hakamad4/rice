import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { aiStatus as realAiStatus, invalidateAiStatus, listModels } from '../../src/main/ai/service';
import { isModelFor, resolveAiSettings, type RunnerDeps } from '../../src/main/ai/factory';
import {
  buildOpenCodeArgs,
  createOpenCodeRunner,
  listOpenCodeModels,
  OPENCODE_CONFIG,
  OPENCODE_FREE_MODEL,
  isFreeTierModel,
  openCodeLoggedIn,
  parseOpenCodeLine,
  pickDefaultModel,
} from '../../src/main/ai/opencode-cli';
import { AiError, type AiRunner } from '../../src/main/ai/types';
import { makeTmpDir } from '../helpers/tmp';

const FAKE = resolve(__dirname, '../fixtures/fake-opencode.mjs');

async function drain(runner: AiRunner, signal?: AbortSignal) {
  const parts: string[] = [];
  const gen = runner.run({ system: 'SYS', prompt: 'PROMPT', signal });
  for (;;) {
    const step = await gen.next();
    if (step.done) return { parts, full: step.value };
    parts.push(step.value);
  }
}
const failure = async (runner: AiRunner, signal?: AbortSignal) => (await drain(runner, signal).catch((e) => e)) as AiError;

const leaky = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ANTHROPIC_API_KEY: 'herdada-anthropic',
  OPENAI_API_KEY: 'herdada-openai',
  GEMINI_API_KEY: 'herdada-gemini',
  GOOGLE_API_KEY: 'herdada-google',
  CLAUDE_CODE_OAUTH_TOKEN: 'herdada-oauth',
  CODEX_API_KEY: 'herdada-codex',
  ...extra,
});

// o login do opencode fica em cache no app; aqui cada chamada tem outro ambiente falso, então começa limpa
const aiStatus: typeof realAiStatus = (...args) => (invalidateAiStatus(), realAiStatus(...args));

describe('opencode: args e permissões', () => {
  test('args: run --standalone (sem daemon), json, modelo; nunca --auto', () => {
    expect(buildOpenCodeArgs('anthropic/claude-sonnet-4-5')).toEqual(['run', '--standalone', '--format', 'json', '-m', 'anthropic/claude-sonnet-4-5']);
    expect(buildOpenCodeArgs('x/y')).not.toContain('--auto');
  });

  test('a config de permissões negadas é passada ao filho, junto com o isolamento de config', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const cwd = join(await makeTmpDir(), 'opencode-cwd');
    await drain(createOpenCodeRunner({ binary: FAKE, cwd, model: 'opencode/big-pickle', env: leaky({ FAKE_RECORD: record }) }));
    const rec = JSON.parse(await readFile(record, 'utf8'));
    const config = JSON.parse(rec.env.OPENCODE_CONFIG_CONTENT);
    expect(config).toEqual(OPENCODE_CONFIG);
    expect(config.permission['*']).toBe('ask'); // em `run` não interativo, "ask" vira rejeição automática
    for (const tool of ['execute', 'question', 'subagent', 'skill', 'websearch']) expect(config.permission[tool]).toBe('deny');
    expect(Object.values(config.permission)).not.toContain('allow');
    expect(rec.env.XDG_CONFIG_HOME).toBe(join(cwd, 'xdg-config')); // sem MCP/plugins/agentes do usuário
    expect(rec.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
    expect(rec.env.OPENCODE_DISABLE_AUTOUPDATE).toBe('1');
    expect(rec.cwd).toContain('opencode-cwd');
    expect(rec.args).not.toContain('--auto');
  });

  test('o env não vaza chaves de outros provedores', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    await drain(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: 'opencode/big-pickle', env: leaky({ FAKE_RECORD: record }) }));
    const { env } = JSON.parse(await readFile(record, 'utf8'));
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY']) expect(env[k]).toBeNull();
  });
});

describe('opencode: eventos JSON', () => {
  test('parse: text vira mensagem; erro de login/rota ganha o prefixo de auth; o resto é ignorado', () => {
    expect(parseOpenCodeLine('{"type":"text","part":{"type":"text","text":"oi"}}')).toEqual({ message: 'oi' });
    expect(parseOpenCodeLine('{"type":"step_start","part":{"type":"step-start"}}')).toEqual({});
    expect(parseOpenCodeLine('{"type":"tool_use","part":{"type":"tool","tool":"write"}}')).toEqual({});
    expect(parseOpenCodeLine('{"type":"error","error":{"type":"provider.no-route","message":"Model unavailable: a/b"}}')).toEqual({ error: 'not logged in: Model unavailable: a/b' });
    expect(parseOpenCodeLine('{"type":"error","error":{"type":"provider.auth","message":"x"}}')).toEqual({ error: 'not logged in: x' });
    expect(parseOpenCodeLine('{"type":"error","error":{"type":"unknown","message":"boom"}}')).toEqual({ error: 'boom' });
    expect(parseOpenCodeLine('lixo')).toBeNull();
  });

  test('junta as partes de texto, ignora ferramentas e manda system+prompt pelo stdin', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const { full, parts } = await drain(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: 'opencode/big-pickle', env: leaky({ FAKE_RECORD: record }) }));
    expect(parts).toEqual(['Olá ', '\n\nOpenCode']);
    expect(full).toBe('Olá \n\nOpenCode');
    const rec = JSON.parse(await readFile(record, 'utf8'));
    expect(rec.stdin).toBe('SYS\n\n---\n\nPROMPT');
    expect(rec.args).toEqual(['run', '--standalone', '--format', 'json', '-m', 'opencode/big-pickle']);
  });
});

describe('opencode: erros', () => {
  test('modelo sem rota / free tier sem login: falha como auth com a instrução do terminal', async () => {
    for (const mode of ['no-route', 'free-tier']) {
      const t0 = Date.now();
      const err = await failure(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: 'anthropic/x', env: leaky({ FAKE_MODE: mode }) }));
      expect(err.kind).toBe('auth');
      expect(err.message).toMatch(/opencode auth login/);
      expect(Date.now() - t0).toBeLessThan(15_000);
    }
  });

  test('limite de uso, timeout, cancelamento e binário ausente', async () => {
    expect((await failure(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: 'a/b', env: leaky({ FAKE_MODE: 'rate-limit' }) }))).kind).toBe('rate-limit');
    const slow = await failure(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: 'a/b', env: leaky({ FAKE_MODE: 'hang' }), timeoutMs: 300 }));
    expect(slow.message).toMatch(/tempo esgotado/);
    const ac = new AbortController();
    const pending = failure(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: 'a/b', env: leaky({ FAKE_MODE: 'hang' }) }), ac.signal);
    setTimeout(() => ac.abort(), 200);
    expect((await pending).kind).toBe('cancelled');
    const missing = await failure(createOpenCodeRunner({ binary: '/nao/existe/opencode', cwd: await makeTmpDir(), model: 'a/b' }));
    expect(missing.kind).toBe('not-installed');
    expect(missing.message).toMatch(/opencode\.ai\/install/);
  });
});

describe('opencode: seletor de modelo', () => {
  const cfg = async (env: Record<string, string>) => ({ binary: FAKE, cwd: await makeTmpDir(), env: leaky(env) });

  test('lista só o que a CLI devolve (autenticados), sem duplicar nem aceitar lixo', async () => {
    const models = await listOpenCodeModels(await cfg({ FAKE_MODELS: 'anthropic/claude-sonnet-4-5\nopenai/gpt-5\nanthropic/claude-sonnet-4-5\n--evil\nlinha solta\nopenrouter/x/y:free\n' }));
    expect(models).toEqual(['anthropic/claude-sonnet-4-5', 'openai/gpt-5', 'openrouter/x/y:free']);
    expect(await listOpenCodeModels(await cfg({ FAKE_MODELS: '' }))).toEqual([]);
  });

  test('padrão sensato: preferidos primeiro, depois o primeiro da lista, sem nada null (nunca o gratuito)', () => {
    expect(pickDefaultModel(['github-copilot/gpt-4o', 'anthropic/claude-sonnet-4-5'])).toBe('anthropic/claude-sonnet-4-5');
    expect(pickDefaultModel(['x/y', 'z/w'])).toBe('x/y');
    expect(pickDefaultModel([])).toBeNull();
    // modelos de camada gratuita nunca são escolhidos pelo Automático, mesmo listados
    expect(pickDefaultModel([OPENCODE_FREE_MODEL, 'openrouter/x/y:free'])).toBeNull();
    expect(pickDefaultModel([OPENCODE_FREE_MODEL, 'x/y'])).toBe('x/y');
    expect(isFreeTierModel(OPENCODE_FREE_MODEL)).toBe(true);
    expect(isFreeTierModel('anthropic/claude-sonnet-4-5')).toBe(false);
  });

  test('sem modelo salvo, o runner usa o padrão da lista autenticada', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    await drain(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), env: leaky({ FAKE_RECORD: record, FAKE_MODELS: 'opencode/big-pickle\nopenai/gpt-5\nx/y\n' }) }));
    expect(JSON.parse(await readFile(record, 'utf8')).args.at(-1)).toBe('openai/gpt-5');
  });

  test('Automático sem nenhum modelo autenticado falha com a mensagem de login e não executa o run', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const runner = createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), env: leaky({ FAKE_RECORD: record, FAKE_MODELS: '' }) });
    await expect(drain(runner)).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('opencode auth login') });
    await expect(readFile(record, 'utf8')).rejects.toThrow();
  });

  test('o modelo gratuito escolhido explicitamente é usado como está', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    await drain(createOpenCodeRunner({ binary: FAKE, cwd: await makeTmpDir(), model: OPENCODE_FREE_MODEL, env: leaky({ FAKE_RECORD: record, FAKE_MODELS: '' }) }));
    expect(JSON.parse(await readFile(record, 'utf8')).args.at(-1)).toBe(OPENCODE_FREE_MODEL);
  });

  test('validação do nome do modelo e leitura tolerante das configurações', () => {
    expect(isModelFor('opencode-sub', 'anthropic/claude-sonnet-4-5#high')).toBe(true);
    expect(isModelFor('opencode-sub', 'openrouter/x/y:free')).toBe(true);
    expect(isModelFor('opencode-sub', '--auto')).toBe(false);
    expect(isModelFor('opencode-sub', 'sem-barra')).toBe(false);
    expect(isModelFor('claude-api', 'a/b')).toBe(false);
    expect(resolveAiSettings({ models: { 'opencode-sub': 'openai/gpt-5' } }).models['opencode-sub']).toBe('openai/gpt-5');
    expect(resolveAiSettings({ models: { 'opencode-sub': '--auto' } }).models).toEqual({});
  });
});

describe('opencode: status e listagem', () => {
  const deps = async (env: Record<string, string>, binary = FAKE): Promise<RunnerDeps> => ({
    getSecret: async () => null,
    binaries: { claude: '/x', codex: '/x', opencode: binary, agy: '/nao/existe/agy' },
    workDir: await makeTmpDir(),
    env: leaky(env),
  });
  const settings = (verified: Record<string, boolean> = {}) => resolveAiSettings({ provider: 'opencode-sub', verified });

  test('detecta login pela saída de `auth list`', async () => {
    const d = await deps({ FAKE_AUTH: 'anthropic  Claude Pro/Max\n' });
    expect(await openCodeLoggedIn({ binary: FAKE, cwd: await makeTmpDir(), env: d.env })).toBe(true);
    expect(await openCodeLoggedIn({ binary: FAKE, cwd: await makeTmpDir(), env: leaky() })).toBe(false);
  });

  test('aiStatus: sem CLI, sem login e com login', async () => {
    expect((await aiStatus(settings(), await deps({}, '/nao/existe/opencode'))).providers['opencode-sub']).toMatchObject({ installed: false, connected: false });
    expect((await aiStatus(settings(), await deps({}))).providers['opencode-sub']).toMatchObject({ installed: true, loggedIn: false, connected: false });
    expect((await aiStatus(settings(), await deps({ FAKE_AUTH: 'anthropic\n' }))).providers['opencode-sub']).toMatchObject({ installed: true, loggedIn: true, connected: true });
    // testar com o gratuito só conta se ele estiver selecionado
    const free = resolveAiSettings({ provider: 'opencode-sub', verified: { 'opencode-sub': true }, models: { 'opencode-sub': OPENCODE_FREE_MODEL } });
    expect((await aiStatus(free, await deps({}))).providers['opencode-sub']).toMatchObject({ loggedIn: false, connected: true });
    expect((await aiStatus(settings({ 'opencode-sub': true }), await deps({}))).providers['opencode-sub']).toMatchObject({ loggedIn: false, connected: false });
  });

  test('listModels devolve vazio sem login (a UI mostra a instrução do terminal)', async () => {
    expect(await listModels('opencode-sub', await deps({ FAKE_MODELS: '' }))).toEqual({ ok: true, models: [] });
    expect(await listModels('opencode-sub', await deps({ FAKE_MODELS: 'openai/gpt-5\n' }))).toEqual({ ok: true, models: ['openai/gpt-5'] });
  });
});
