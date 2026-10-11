import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildClaudeArgs, ClaudeError, ClaudeRunner } from '../../src/main/claude/runner';
import { makeTmpDir } from '../helpers/tmp';

const FAKE = resolve(__dirname, '../fixtures/fake-claude.mjs');

async function runner(mode: string, record?: string, pidfile?: string) {
  const cwd = join(await makeTmpDir(), 'claude-cwd');
  return {
    cwd,
    r: new ClaudeRunner({
      binary: FAKE,
      cwd,
      env: { ...process.env, FAKE_CLAUDE_MODE: mode, ...(record ? { FAKE_CLAUDE_RECORD: record } : {}),
        ...(pidfile ? { FAKE_CLAUDE_PIDFILE: pidfile } : {}),
      },
    }),
  };
}

async function collect(gen: AsyncGenerator<string, string, void>) {
  const deltas: string[] = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) return { deltas, final: step.value };
    deltas.push(step.value);
  }
}

test('buildClaudeArgs isola o CLI e passa o system prompt', () => {
  expect(buildClaudeArgs('SYS')).toEqual([
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--tools', '',
    '--no-session-persistence',
    '--safe-mode',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--system-prompt', 'SYS',
  ]);
});

describe('ClaudeRunner.run', () => {
  test('emite deltas, devolve texto final, envia prompt pelo stdin e cria o cwd', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const { r, cwd } = await runner('ok', record);
    const { deltas, final } = await collect(r.run({ system: 'Você é o Rice', prompt: 'Pergunta com acento: ção' }));
    expect(deltas).toEqual(['Olá', ' mundo']);
    expect(final).toBe('Olá mundo');
    const rec = JSON.parse(await readFile(record, 'utf8'));
    expect(rec.stdin).toBe('Pergunta com acento: ção');
    expect(rec.args.at(-1)).toBe('Você é o Rice');
    expect(await realpathSafe(rec.cwd)).toBe(await realpathSafe(cwd));
  });

  test('injeta CLAUDE_CODE_OAUTH_TOKEN quando há token e remove ANTHROPIC_API_KEY', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const cwd = join(await makeTmpDir(), 'c');
    const r = new ClaudeRunner({
      binary: FAKE,
      cwd,
      getToken: async () => 'sk-ant-oat01-segredo',
      env: { ...process.env, ANTHROPIC_API_KEY: 'x', FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_RECORD: record },
    });
    await collect(r.run({ system: 's', prompt: 'p' }));
    const rec = JSON.parse(await readFile(record, 'utf8'));
    expect(rec.oauthToken).toBe('sk-ant-oat01-segredo');
    expect(rec.hasApiKey).toBe(false);
  });

  test('sem token não define CLAUDE_CODE_OAUTH_TOKEN', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const cwd = join(await makeTmpDir(), 'c');
    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_RECORD: record };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    const r = new ClaudeRunner({ binary: FAKE, cwd, getToken: async () => null, env });
    await collect(r.run({ system: 's', prompt: 'p' }));
    expect(JSON.parse(await readFile(record, 'utf8')).oauthToken).toBeNull();
  });

  test('sem token salvo não repassa CLAUDE_CODE_OAUTH_TOKEN do ambiente de origem', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const cwd = join(await makeTmpDir(), 'c');
    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_RECORD: record, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-vazado' };
    const r = new ClaudeRunner({ binary: FAKE, cwd, getToken: async () => null, env });
    await collect(r.run({ system: 's', prompt: 'p' }));
    expect(JSON.parse(await readFile(record, 'utf8')).oauthToken).toBeNull();
  });

  test('ignora linhas que não são JSON', async () => {
    const { r } = await runner('garbage');
    expect((await collect(r.run({ system: 's', prompt: 'p' }))).final).toBe('fim');
  });

  test.each([
    ['not-logged-in', 'not-logged-in'],
    ['rate-limited', 'rate-limited'],
  ])('modo %s lança ClaudeError(%s)', async (mode, kind) => {
    const { r } = await runner(mode);
    const err = await collect(r.run({ system: 's', prompt: 'p' })).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.kind).toBe(kind);
  });

  test('processo que morre sem result lança failed com stderr', async () => {
    const { r } = await runner('crash');
    const err = await collect(r.run({ system: 's', prompt: 'p' })).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.kind).toBe('failed');
    expect(err.message).toContain('boom: segfault');
  });

  test('binário inexistente lança not-installed', async () => {
    const cwd = join(await makeTmpDir(), 'c');
    const r = new ClaudeRunner({ binary: '/nao/existe/claude', cwd });
    const err = await collect(r.run({ system: 's', prompt: 'p' })).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.kind).toBe('not-installed');
  });

  test('abort cancela rapidamente com cancelled', async () => {
    const pidfile = join(await makeTmpDir(), 'pid');
    const { r } = await runner('slow', undefined, pidfile);
    const ac = new AbortController();
    const gen = r.run({ system: 's', prompt: 'p', signal: ac.signal });
    expect((await gen.next()).value).toBe('a');
    const t0 = Date.now();
    ac.abort();
    const err = await collect(gen).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.kind).toBe('cancelled');
    expect(err.message).toBe('cancelado');
    expect(Date.now() - t0).toBeLessThan(3000);
    await expectGone(Number(await readFile(pidfile, 'utf8')));
  });

  test('signal já abortado lança cancelado sem iniciar o processo', async () => {
    const record = join(await makeTmpDir(), 'rec.json');
    const { r } = await runner('ok', record);
    const ac = new AbortController();
    ac.abort();
    const err = await collect(r.run({ system: 's', prompt: 'p', signal: ac.signal })).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.kind).toBe('cancelled');
    expect(err.message).toBe('cancelado');
    await new Promise((res) => setTimeout(res, 300));
    expect(existsSync(record)).toBe(false);
  });

  test('saída antecipada do consumidor encerra o processo filho', async () => {
    const pidfile = join(await makeTmpDir(), 'pid');
    const { r } = await runner('slow', undefined, pidfile);
    const gen = r.run({ system: 's', prompt: 'p' });
    expect((await gen.next()).value).toBe('a');
    await gen.return(undefined as never);
    await expectGone(Number(await readFile(pidfile, 'utf8')));
  });
});

async function expectGone(pid: number) {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      expect((e as NodeJS.ErrnoException).code).toBe('ESRCH');
      return;
    }
    if (Date.now() > deadline) throw new Error(`processo ${pid} ainda vivo`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

async function realpathSafe(p: string) {
  const { realpath } = await import('node:fs/promises');
  return realpath(p);
}

test('remove ANTHROPIC_API_KEY do ambiente do filho', async () => {
  const record = join(await makeTmpDir(), 'rec.json');
  const cwd = join(await makeTmpDir(), 'claude-cwd');
  const r = new ClaudeRunner({
    binary: FAKE,
    cwd,
    env: { ...process.env, FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_RECORD: record, ANTHROPIC_API_KEY: 'sk-test' },
  });
  await collect(r.run({ system: 's', prompt: 'p' }));
  const rec = JSON.parse(await readFile(record, 'utf8'));
  expect(rec.hasApiKey).toBe(false);
});
