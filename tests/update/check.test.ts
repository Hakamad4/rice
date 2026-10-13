import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { parseBuildInfo, type BuildInfo } from '../../src/main/update/build-info';
import { createUpdateChecker, COMMITS_URL, dueForCheck, isNewer, parseCommit, type FetchLike, type UpdateState } from '../../src/main/update/check';
import { openUpdateInTerminal, shQuote, updateScript } from '../../src/main/update/terminal';
// @ts-expect-error módulo .mjs do script de build
import { buildInfo as makeBuildInfo, publicRemote } from '../../scripts/write-build-info.mjs';
import { makeTmpDir } from '../helpers/tmp';

const SHA_NEW = 'e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3';
const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({ commit: 'a1b2c3d', commitDate: '2026-10-01T10:00:00Z', date: '2026-10-01T12:00:00Z', remote: 'github.com/WalissonCF/rice', clonePath: '/Users/ana/rice', ...over });
const commitBody = (sha = SHA_NEW, date = '2026-10-10T10:00:00Z') => ({ sha, commit: { committer: { date } } });

function checker(opts: { info?: BuildInfo | null; enabled?: boolean; disabled?: boolean; state?: UpdateState; body?: unknown; fail?: boolean; now?: string; usable?: boolean } = {}) {
  let state: UpdateState = opts.state ?? {};
  const fetch = vi.fn<FetchLike>(async () => {
    if (opts.fail) throw new Error('offline');
    return { ok: true, json: async () => opts.body ?? commitBody() };
  });
  const c = createUpdateChecker({
    info: () => (opts.info === undefined ? info() : opts.info),
    enabled: async () => opts.enabled !== false,
    getState: async () => state,
    setState: async (s) => void (state = s),
    ...(opts.disabled ? { disabled: () => true } : {}),
    fetch,
    now: () => new Date(opts.now ?? '2026-10-13T12:00:00Z'),
    cloneUsable: () => opts.usable !== false,
  });
  return { c, fetch, state: () => state };
}

describe('comparação de versão', () => {
  test('mais novo = sha diferente e commit remoto posterior ao do build', () => {
    expect(isNewer(info(), { sha: SHA_NEW, date: '2026-10-10T10:00:00Z' })).toBe(true);
    expect(isNewer(info(), { sha: 'a1b2c3d' + '0'.repeat(33), date: '2026-10-10T10:00:00Z' })).toBe(false); // mesmo commit
    expect(isNewer(info(), { sha: SHA_NEW, date: '2026-09-01T10:00:00Z' })).toBe(false); // remoto mais velho: o build está à frente
    expect(isNewer(info({ commitDate: null, date: null }), { sha: SHA_NEW, date: '2026-10-10T10:00:00Z' })).toBe(true);
    expect(isNewer(info(), { sha: SHA_NEW, date: 'lixo' })).toBe(false);
  });

  test('a resposta da API é validada', () => {
    expect(parseCommit(commitBody())).toEqual({ sha: SHA_NEW, date: '2026-10-10T10:00:00Z' });
    for (const bad of [null, {}, { sha: 'abc', commit: { committer: { date: '2026-10-10T10:00:00Z' } } }, { sha: SHA_NEW }, { sha: SHA_NEW, commit: { committer: { date: 'x' } } }]) expect(parseCommit(bad)).toBeNull();
  });
});

describe('throttle diário', () => {
  test('vence com 24 h, nunca antes; data futura ou ilegível não trava', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(dueForCheck(undefined, now)).toBe(true);
    expect(dueForCheck('2026-10-12T12:00:01Z', now)).toBe(false);
    expect(dueForCheck('2026-10-12T12:00:00Z', now)).toBe(true);
    expect(dueForCheck('2027-01-01T00:00:00Z', now)).toBe(true);
    expect(dueForCheck('lixo', now)).toBe(true);
  });

  test('uma só requisição por dia, anônima (sem token nem cabeçalho de identificação)', async () => {
    const t = checker();
    const first = await t.c.maybeCheck();
    expect(first).toMatchObject({ enabled: true, available: true, from: 'a1b2c3d', to: 'e4f5a6b', fromClone: true });
    await t.c.maybeCheck();
    await t.c.maybeCheck();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetch.mock.calls[0]!;
    expect(url).toBe(COMMITS_URL);
    expect(url).toBe('https://api.github.com/repos/WalissonCF/rice/commits/main');
    expect(Object.keys(init.headers)).toEqual(['accept']);
    expect(t.state()).toMatchObject({ at: '2026-10-13T12:00:00.000Z', sha: SHA_NEW });
  });

  test('passado um dia consulta de novo', async () => {
    const t = checker({ state: { at: '2026-10-11T00:00:00Z' } });
    await t.c.maybeCheck();
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('quando NÃO consulta', () => {
  test('opção desligada: nenhuma requisição e nenhum aviso (mesmo com versão guardada)', async () => {
    const t = checker({ enabled: false, state: { sha: SHA_NEW, date: '2026-10-10T10:00:00Z' } });
    expect(await t.c.maybeCheck()).toMatchObject({ enabled: false, available: false });
    expect(t.fetch).not.toHaveBeenCalled();
  });

  test('instância de teste, build sem o remote público ou sem build-info: nenhuma requisição', async () => {
    for (const o of [{ disabled: true }, { info: info({ remote: null }) }, { info: null }]) {
      const t = checker(o);
      expect((await t.c.maybeCheck()).available).toBe(false);
      expect(t.fetch).not.toHaveBeenCalled();
    }
  });

  test('falha de rede ou resposta estranha: silêncio, sem aviso, e a tentativa conta (sem martelar a API)', async () => {
    const off = checker({ fail: true });
    expect((await off.c.maybeCheck()).available).toBe(false);
    expect(off.state().at).toBeDefined();
    await off.c.maybeCheck();
    expect(off.fetch).toHaveBeenCalledTimes(1);
    const odd = checker({ body: { message: 'API rate limit exceeded' } });
    expect((await odd.c.maybeCheck()).available).toBe(false);
  });
});

describe('origem do app', () => {
  test('sem clone utilizável (release/.dmg ou pasta apagada) o aviso existe, mas o botão é "Baixar"', async () => {
    const noClone = checker({ info: info({ clonePath: null }) });
    expect(await noClone.c.maybeCheck()).toMatchObject({ available: true, fromClone: false });
    const gone = checker({ usable: false });
    expect(await gone.c.maybeCheck()).toMatchObject({ available: true, fromClone: false });
  });
});

describe('build-info', () => {
  test('só aceita o formato esperado; remote que não é o público vira null', () => {
    expect(parseBuildInfo({ commit: 'a1b2c3d', commitDate: '2026-10-01T10:00:00-03:00', date: '2026-10-01T12:00:00Z', remote: 'github.com/WalissonCF/rice', clonePath: '/x/rice' })).toMatchObject({ remote: 'github.com/WalissonCF/rice', clonePath: '/x/rice' });
    expect(parseBuildInfo({ commit: 'a1b2c3d', remote: 'github.com/outro/fork' })?.remote).toBeNull();
    expect(parseBuildInfo({ commit: 'a1b2c3d', clonePath: '/x\n; rm -rf ~' })?.clonePath).toBeNull();
    for (const bad of [null, {}, { commit: 'xyz!' }, { commit: 42 }]) expect(parseBuildInfo(bad)).toBeNull();
  });

  test('o script grava commit, datas e caminho do clone; o remote só se for o repositório público', async () => {
    expect(publicRemote('https://github.com/WalissonCF/rice.git')).toBe('github.com/WalissonCF/rice');
    expect(publicRemote('git@github.com:WalissonCF/rice.git')).toBe('github.com/WalissonCF/rice');
    expect(publicRemote('https://ghp_SEGREDO@github.com/WalissonCF/rice')).toBe('github.com/WalissonCF/rice');
    expect(publicRemote('https://github.com/fulano/rice.git')).toBeNull();
    expect(publicRemote('https://exemplo.com/WalissonCF/rice.git')).toBeNull();
    const dir = await makeTmpDir();
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a'), 'x');
    g('add', '.');
    g('commit', '-q', '-m', 'um');
    const privateRepo = makeBuildInfo(dir, new Date('2026-10-13T12:00:00Z'));
    expect(privateRepo).toMatchObject({ commit: g('rev-parse', '--short=7', 'HEAD'), remote: null, date: '2026-10-13T12:00:00.000Z' });
    expect(privateRepo.clonePath).toBe(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim());
    g('remote', 'add', 'origin', 'git@github.com:WalissonCF/rice.git');
    expect(makeBuildInfo(dir).remote).toBe('github.com/WalissonCF/rice');
    // o build-info (com o caminho local) não entra no repositório
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^out\/$/m);
  });
});

describe('comando do Terminal', () => {
  test('aspas simples: caminho com espaço, aspas, $ e crase fica literal', () => {
    expect(shQuote("/Users/ana/meu rice")).toBe("'/Users/ana/meu rice'");
    expect(shQuote("/tmp/it's")).toBe("'/tmp/it'\\''s'");
    const script = updateScript('/Users/ana/pasta "x" $(rm -rf ~) `id`/rice');
    expect(script).toBe(`#!/bin/bash\ncd '/Users/ana/pasta "x" $(rm -rf ~) \`id\`/rice' && ./update.sh\n`);
    // executa de verdade: o cd cai na pasta com nome estranho, nada é interpretado
    const out = execFileSync('bash', ['-c', `${updateScript("/tmp").split('\n')[1]!.replace('./update.sh', 'pwd')}`], { encoding: 'utf8' });
    expect(out.trim().endsWith('tmp')).toBe(true);
  });

  test('recusa caminho relativo, com quebra de linha ou NUL', () => {
    for (const bad of ['rice', '/x\n./evil.sh', '/x\r', '/x\0y']) expect(() => updateScript(bad)).toThrow();
  });

  test('grava o .command numa pasta privada com 700 e abre só esse arquivo; sem clone não abre nada', async () => {
    const tmp = await makeTmpDir();
    const open = vi.fn();
    const res = await openUpdateInTerminal(info({ clonePath: '/Users/ana/meu rice' }), open, tmp);
    expect(res.ok).toBe(true);
    expect(open).toHaveBeenCalledWith(res.file);
    expect(res.file!.startsWith(tmp)).toBe(true);
    expect(statSync(res.file!).mode & 0o777).toBe(0o700);
    expect(statSync(join(res.file!, '..')).mode & 0o777).toBe(0o700);
    expect(readFileSync(res.file!, 'utf8')).toBe(`#!/bin/bash\ncd '/Users/ana/meu rice' && ./update.sh\n`);
    expect((await openUpdateInTerminal(info({ clonePath: null }), open, tmp)).ok).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

test('build de release (RICE_RELEASE=1) não grava o caminho da máquina que gerou o .dmg', async () => {
  const dir = await makeTmpDir();
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']);
  expect(makeBuildInfo(dir, new Date(), false).clonePath).toBeTruthy();
  const release = makeBuildInfo(dir, new Date(), true);
  expect(release.clonePath).toBeNull();
  expect(release.commit).toMatch(/^[0-9a-f]{7}$/);
});
