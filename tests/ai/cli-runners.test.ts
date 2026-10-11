import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildCodexArgs, codexDisabledFeatures, createCodexRunner, parseCodexFeatures, parseCodexLine } from '../../src/main/ai/codex-cli';
import { buildChildEnv } from '../../src/main/ai/env';
import { AiError, type AiRunner } from '../../src/main/ai/types';
import { makeTmpDir } from '../helpers/tmp';

const FAKE_CODEX = resolve(__dirname, '../fixtures/fake-codex.mjs');

async function drain(runner: AiRunner, signal?: AbortSignal) {
  const deltas: string[] = [];
  const gen = runner.run({ system: 'SYS', prompt: 'PROMPT', signal });
  for (;;) {
    const step = await gen.next();
    if (step.done) return { deltas, full: step.value };
    deltas.push(step.value);
  }
}
const failure = async (runner: AiRunner, signal?: AbortSignal) => (await drain(runner, signal).catch((e) => e)) as AiError;

const leaky = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
  ...process.env,
  ANTHROPIC_API_KEY: 'herdada-anthropic',
  OPENAI_API_KEY: 'herdada-openai',
  GEMINI_API_KEY: 'herdada-gemini',
  GOOGLE_API_KEY: 'herdada-google',
  CLAUDE_CODE_OAUTH_TOKEN: 'herdada-oauth',
  CODEX_API_KEY: 'herdada-codex',
  ...extra,
});

describe('codex', () => {
  test('args conferidos: sem ferramentas, somente leitura, sem config/regras do usuário', () => {
    expect(buildCodexArgs('/cwd')).toEqual(['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '-c', 'shell_environment_policy.inherit=none', '-C', '/cwd']);
    expect(buildCodexArgs('/cwd', undefined, ['shell_tool', 'browser_use'])).toEqual(expect.arrayContaining(['--disable', 'shell_tool', '--disable', 'browser_use']));
    expect(buildCodexArgs('/cwd', 'gpt-5')).toEqual(expect.arrayContaining(['-m', 'gpt-5']));
    expect(buildCodexArgs('/cwd', '--dangerously-bypass-approvals-and-sandbox')).not.toContain('-m'); // modelo inválido é ignorado
  });

  test('parse do JSONL: só agent_message vira texto; erros e fim são reconhecidos', () => {
    expect(parseCodexLine('{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"ok"}}')).toEqual({ message: 'ok' });
    expect(parseCodexLine('{"type":"item.completed","item":{"id":"i","type":"error","message":"x"}}')).toEqual({});
    expect(parseCodexLine('{"type":"error","message":"boom"}')).toEqual({ error: 'boom' });
    expect(parseCodexLine('{"type":"turn.failed","error":{"message":"falhou"}}')).toEqual({ error: 'falhou' });
    expect(parseCodexLine('{"type":"turn.completed"}')).toEqual({ done: true });
    expect(parseCodexLine('Reading prompt from stdin...')).toBeNull();
  });

  test('junta as mensagens do agente, manda system+prompt pelo stdin e roda no cwd dedicado', async () => {
    const cwd = join(await makeTmpDir(), 'codex-cwd');
    const record = join(await makeTmpDir(), 'rec.json');
    const { full, deltas } = await drain(createCodexRunner({ binary: FAKE_CODEX, cwd, env: leaky({ FAKE_RECORD: record }) }));
    expect(full).toBe('Primeira parte.\n\nSegunda parte.');
    expect(deltas).toHaveLength(2);
    const rec = JSON.parse(await readFile(record, 'utf8'));
    expect(rec.stdin).toBe('SYS\n\n---\n\nPROMPT');
    expect(rec.cwd).toContain('codex-cwd');
    expect(rec.args).toContain('--sandbox');
  });

  test('ambiente limpo: nenhuma chave herdada chega ao filho', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    await drain(createCodexRunner({ binary: FAKE_CODEX, cwd: await makeTmpDir(), env: leaky({ FAKE_RECORD: record }) }));
    const { env } = JSON.parse(await readFile(record, 'utf8'));
    expect(Object.values(env)).toEqual([null, null, null, null, null, null]);
  });

  test('login ausente (401 em loop) falha rápido como auth, sem esperar o processo', async () => {
    const t0 = Date.now();
    const err = await failure(createCodexRunner({ binary: FAKE_CODEX, cwd: await makeTmpDir(), env: leaky({ FAKE_MODE: 'auth' }) }));
    expect(err.kind).toBe('auth');
    expect(err.message).toMatch(/codex login/);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });

  test('limite de uso, crash e timeout', async () => {
    expect((await failure(createCodexRunner({ binary: FAKE_CODEX, cwd: await makeTmpDir(), env: leaky({ FAKE_MODE: 'rate' }) }))).kind).toBe('rate-limit');
    expect((await failure(createCodexRunner({ binary: FAKE_CODEX, cwd: await makeTmpDir(), env: leaky({ FAKE_MODE: 'crash' }) }))).kind).toBe('other');
    const slow = await failure(createCodexRunner({ binary: FAKE_CODEX, cwd: await makeTmpDir(), env: leaky({ FAKE_MODE: 'hang' }), timeoutMs: 300 }));
    expect(slow.message).toMatch(/tempo esgotado/);
  });

  test('binário ausente: mensagem de instalação; cancelamento mata o processo', async () => {
    const missing = await failure(createCodexRunner({ binary: '/nao/existe/codex', cwd: await makeTmpDir() }));
    expect(missing.kind).toBe('not-installed');
    expect(missing.message).toMatch(/Instale o Codex CLI/);
    const ac = new AbortController();
    const pending = failure(createCodexRunner({ binary: FAKE_CODEX, cwd: await makeTmpDir(), env: leaky({ FAKE_MODE: 'hang' }) }), ac.signal);
    setTimeout(() => ac.abort(), 200);
    expect((await pending).kind).toBe('cancelled');
  });
});

test('buildChildEnv: apaga as 6 credenciais herdadas e injeta só o que foi pedido', () => {
  const env = buildChildEnv(leaky({}), { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-do-ativo' });
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.GEMINI_API_KEY).toBeUndefined();
  expect(env.GOOGLE_API_KEY).toBeUndefined();
  expect(env.CODEX_API_KEY).toBeUndefined();
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-do-ativo');
  expect(buildChildEnv(leaky({})).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
});

test('buildChildEnv: qualquer variável com nome de segredo sai (…_API_KEY, …_TOKEN, AWS_*, SSH_AUTH_SOCK…); as comuns ficam', () => {
  const env = buildChildEnv({ PATH: '/usr/bin', HOME: '/Users/ana', LANG: 'pt_BR.UTF-8', TOKENIZERS_PARALLELISM: 'false', OPENROUTER_API_KEY: 'x', GROQ_API_KEY: 'x', GITHUB_TOKEN: 'x', NPM_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', AWS_PROFILE: 'p', SSH_AUTH_SOCK: '/tmp/agent', DB_PASSWORD: 'x', MY_SERVICE_SECRET: 'x', ANTHROPIC_AUTH_TOKEN: 'x', GOOGLE_APPLICATION_CREDENTIALS: '/k.json', HTTPS_PROXY: 'http://p:1', NODE_EXTRA_CA_CERTS: '/ca.pem' });
  for (const name of ['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GITHUB_TOKEN', 'NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE', 'SSH_AUTH_SOCK', 'DB_PASSWORD', 'MY_SERVICE_SECRET', 'ANTHROPIC_AUTH_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS']) expect(env[name], name).toBeUndefined();
  for (const name of ['HOME', 'LANG', 'TOKENIZERS_PARALLELISM', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS']) expect(env[name], name).toBeDefined();
});

describe('codex: ferramentas de agente desligadas', () => {
  test('parseCodexFeatures lê só o primeiro campo de cada linha', () => {
    expect(parseCodexFeatures('shell_tool    stable   true\nfast_mode  stable  true\n\n!!ruim  x')).toEqual(['shell_tool', 'fast_mode']);
  });

  test('desliga só o que a versão instalada conhece (nome desconhecido faria o codex recusar) e o runner usa isso', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const binary = resolve(__dirname, '../fixtures/fake-codex.mjs');
    expect(await codexDisabledFeatures(binary, { ...process.env })).toEqual(['shell_tool', 'apps', 'browser_use', 'computer_use', 'plugins']);
    await drain(createCodexRunner({ binary, cwd: await makeTmpDir(), env: leaky({ FAKE_RECORD: record }) }));
    const { args } = JSON.parse(await readFile(record, 'utf8'));
    for (const f of ['shell_tool', 'apps', 'browser_use', 'computer_use', 'plugins']) expect(args.join(' ')).toContain(`--disable ${f}`);
    expect(args.join(' ')).not.toContain('--disable image_generation'); // esta versão não lista
    expect(args).toContain('--sandbox');
  });

  test('sem `features list` (codex antigo): não desliga nada e o runner continua funcionando no sandbox somente-leitura', async () => {
    const binary = join(await makeTmpDir(), 'codex-antigo');
    await writeFile(binary, "#!/usr/bin/env node\nprocess.exit(process.argv[2] === 'features' ? 2 : 0);\n");
    await chmod(binary, 0o755);
    expect(await codexDisabledFeatures(binary, { ...process.env })).toEqual([]);
  });
});
