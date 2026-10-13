import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeTmpDir } from '../helpers/tmp';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** Remote local (bare) + clone com o update.sh commitado + um segundo clone para "publicar" versões novas. Nada de rede. */
async function setup() {
  const base = await makeTmpDir();
  const remote = join(base, 'remote.git');
  git(base, 'init', '--bare', '-b', 'main', remote);
  const clone = join(base, 'clone');
  git(base, 'clone', '-q', remote, clone);
  copyFileSync('update.sh', join(clone, 'update.sh'));
  writeFileSync(join(clone, 'app.txt'), 'v1\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-q', '-m', 'v1');
  git(clone, 'push', '-q', 'origin', 'main');
  git(clone, 'branch', '--set-upstream-to=origin/main', 'main');
  const other = join(base, 'other');
  git(base, 'clone', '-q', remote, other);
  const publish = (name: string, content = name) => {
    writeFileSync(join(other, `${name}.txt`), content);
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', name);
    git(other, 'push', '-q', 'origin', 'main');
  };
  const log = join(base, 'calls.log');
  const run = (args: string[] = [], env: Record<string, string> = {}) => {
    const r = spawnSync('bash', [join(clone, 'update.sh'), ...args], {
      cwd: base, // fora do clone: o script precisa achar o clone sozinho
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: base,
        LANG: 'en_US.UTF-8',
        RICE_UPDATE_INSTALL_CMD: `echo install >> '${log}'`,
        RICE_UPDATE_QUIT_CMD: `echo quit >> '${log}'; rm -f '${base}/running'`,
        RICE_UPDATE_OPEN_CMD: `echo open >> '${log}'`,
        RICE_UPDATE_RUNNING_CMD: `test -f '${base}/running'`,
        RICE_UPDATE_RECORDING_CMD: `test -f '${base}/recording'`,
        ...env,
      },
    });
    return { code: r.status, out: r.stdout + r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  };
  return { base, clone, publish, run, running: () => writeFileSync(join(base, 'running'), ''), recording: () => writeFileSync(join(base, 'recording'), '') };
}

describe('update.sh', () => {
  test('já atualizado: avisa e sai sem fechar nem refazer nada; --force reconstrói mesmo assim', async () => {
    const t = await setup();
    const r = t.run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('already up to date');
    expect(r.calls).toEqual([]);
    t.running();
    const f = t.run(['--force']);
    expect(f.code).toBe(0);
    expect(f.calls).toEqual(['quit', 'install', 'open']);
  });

  test('fast-forward: mostra o que mudou, atualiza o clone, fecha o app, refaz e reabre', async () => {
    const t = await setup();
    t.publish('feature-a');
    t.publish('feature-b');
    t.running();
    const r = t.run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/what changed \(2 commit/);
    expect(r.out).toContain('feature-b');
    expect(r.calls).toEqual(['quit', 'install', 'open']);
    expect(existsSync(join(t.clone, 'feature-b.txt'))).toBe(true);
    // com o app fechado não reabre sozinho
    t.publish('feature-c');
    const closed = t.run();
    expect(closed.calls.slice(-1)).toEqual(['install']);
  });

  test('mostra no máximo 20 linhas do histórico', async () => {
    const t = await setup();
    for (let i = 0; i < 23; i++) t.publish(`c${i}`);
    const r = t.run();
    expect(r.code).toBe(0);
    expect(r.out.split('\n').filter((l) => /^[0-9a-f]{7,} c\d+$/.test(l))).toHaveLength(20);
    expect(r.out).toContain('and 3 more');
  });

  test('alterações locais: aborta explicando o git stash, sem tocar em nada', async () => {
    const t = await setup();
    t.publish('novo');
    writeFileSync(join(t.clone, 'app.txt'), 'meu ajuste\n');
    const r = t.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain('git stash');
    expect(r.out).toContain('Nothing was changed');
    expect(readFileSync(join(t.clone, 'app.txt'), 'utf8')).toBe('meu ajuste\n');
    expect(existsSync(join(t.clone, 'novo.txt'))).toBe(false);
    expect(r.calls).toEqual([]);
  });

  test('não é fast-forward: aborta sem descartar o commit local nem refazer o app', async () => {
    const t = await setup();
    writeFileSync(join(t.clone, 'local.txt'), 'meu commit');
    git(t.clone, 'add', '.');
    git(t.clone, 'commit', '-q', '-m', 'local');
    t.publish('remoto');
    t.running();
    const r = t.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain('fast-forward');
    expect(r.out).toContain('Nothing was discarded');
    expect(existsSync(join(t.clone, 'local.txt'))).toBe(true);
    expect(r.calls).toEqual([]); // o app nem chegou a ser fechado
  });

  test('gravação em andamento: pede para parar antes e não altera nada', async () => {
    const t = await setup();
    t.publish('novo');
    t.running();
    t.recording();
    const r = t.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain('Rice is recording');
    expect(existsSync(join(t.clone, 'novo.txt'))).toBe(false);
    expect(r.calls).toEqual([]);
  });

  test('build falha: o app antigo é reaberto e o erro explica que ele continua em /Applications', async () => {
    const t = await setup();
    t.publish('novo');
    t.running();
    const r = t.run([], { RICE_UPDATE_INSTALL_CMD: `echo install >> '${join(t.base, 'calls.log')}'; exit 3` });
    expect(r.code).toBe(1);
    expect(r.out).toContain('old Rice is still in /Applications');
    expect(r.calls).toEqual(['quit', 'install', 'open']);
  });

  test('em português quando o sistema está em português', async () => {
    const t = await setup();
    const r = t.run([], { LANG: 'pt_BR.UTF-8' });
    expect(r.out).toContain('já está atualizado');
  });

  test('sem remote ou fora de um clone: erro claro', async () => {
    const t = await setup();
    git(t.clone, 'remote', 'remove', 'origin');
    expect(t.run().out).toContain('no remote');
    const loose = await makeTmpDir();
    copyFileSync('update.sh', join(loose, 'update.sh'));
    const r = spawnSync('bash', [join(loose, 'update.sh')], { cwd: loose, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: loose, LANG: 'en_US.UTF-8', GIT_CEILING_DIRECTORIES: loose } });
    expect(r.stderr).toContain('not a git clone');
  });

  test('argumento desconhecido não faz nada', async () => {
    const t = await setup();
    const r = t.run(['--tudo']);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });
});

describe('install.sh --update', () => {
  test('é um atalho para o update.sh', () => {
    const text = readFileSync('install.sh', 'utf8');
    expect(text).toMatch(/\[ "\$\{1:-\}" = "--update" \] && exec \.\/update\.sh/);
  });

  test('só troca o app depois do build e copia para um nome temporário antes de substituir', () => {
    const text = readFileSync('install.sh', 'utf8');
    const build = text.indexOf('npm run dist');
    const swap = text.indexOf('rm -rf "$DEST"');
    expect(build).toBeGreaterThan(0);
    expect(swap).toBeGreaterThan(build);
    expect(text.indexOf('ditto "$APP" "$STAGE"')).toBeLessThan(swap);
  });
});
