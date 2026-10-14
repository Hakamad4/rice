import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  mkdirSync(join(clone, 'scripts'));
  copyFileSync('scripts/install-lib.sh', join(clone, 'scripts', 'install-lib.sh'));
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
  // o "app instalado" de mentira: o install.sh de verdade grava o build-info com o commit do clone; o stub faz o mesmo (ou diverge, de propósito)
  const app = join(base, 'Rice.app');
  const infoDir = join(app, 'Contents', 'Resources', 'app');
  mkdirSync(join(infoDir, 'out'), { recursive: true });
  writeFileSync(join(infoDir, 'package.json'), '{\n  "name": "rice",\n  "version": "0.4.0"\n}\n');
  const installStub = (commit?: string) => `echo install >> '${log}'; printf '{"commit": "%s"}' ${commit ? `'${commit}'` : '"$(git rev-parse --short=7 HEAD)"'} > '${infoDir}/out/build-info.json'`;
  const run = (args: string[] = [], env: Record<string, string> = {}) => {
    const r = spawnSync('bash', [join(clone, 'update.sh'), ...args], {
      cwd: base, // fora do clone: o script precisa achar o clone sozinho
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: base,
        LANG: 'en_US.UTF-8',
        RICE_UPDATE_APP: app,
        RICE_UPDATE_WAIT: '2',
        RICE_UPDATE_INSTALL_CMD: installStub(),
        RICE_UPDATE_QUIT_CMD: `echo quit >> '${log}'; rm -f '${base}/running'`,
        // reabrir: grava o caminho de onde o Rice "abriu" (o padrão é o app de /Applications) e registra a chamada
        RICE_UPDATE_OPEN_CMD: `echo open >> '${log}'; echo "- ${app}" > '${base}/running'`,
        RICE_UPDATE_RUNNING_CMD: `cat '${base}/running' 2>/dev/null`,
        RICE_UPDATE_RECORDING_CMD: `test -f '${base}/recording'`,
        RICE_UPDATE_MDFIND_CMD: `cat '${base}/mdfind' 2>/dev/null`,
        RICE_UPDATE_LSREGISTER_CMD: `echo lsregister >> '${log}'`,
        ...env,
      },
    });
    return { code: r.status, out: r.stdout + r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  };
  return {
    base, clone, publish, run, app, installStub,
    running: (...paths: string[]) => writeFileSync(join(base, 'running'), (paths.length ? paths : [app]).map((p) => `- ${p}`).join('\n') + '\n'),
    stop: () => rmSync(join(base, 'running'), { force: true }),
    recording: () => writeFileSync(join(base, 'recording'), ''),
    mdfind: (...paths: string[]) => writeFileSync(join(base, 'mdfind'), paths.join('\n') + '\n'),
  };
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
    expect(f.calls).toEqual(['quit', 'install', 'lsregister', 'open']);
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
    expect(r.calls).toEqual(['quit', 'install', 'lsregister', 'open']);
    expect(existsSync(join(t.clone, 'feature-b.txt'))).toBe(true);
    // com o app fechado não reabre sozinho
    t.publish('feature-c');
    t.stop();
    const closed = t.run();
    expect(closed.calls.slice(-2)).toEqual(['install', 'lsregister']);
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

describe('update.sh: o Rice aberto é mesmo o instalado', () => {
  test('fecha QUALQUER cópia aberta (também fora de /Applications), mostrando o caminho de cada uma', async () => {
    const t = await setup();
    t.publish('novo');
    t.running('/Users/x/Downloads/Rice.app', t.app);
    const r = t.run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('Rice is open right now at:');
    expect(r.out).toContain('  - /Users/x/Downloads/Rice.app');
    expect(r.calls).toEqual(['quit', 'install', 'lsregister', 'open']);
  });

  test('o fechar e o reabrir usam o bundle id e o caminho explícito (nunca "open -a Rice")', () => {
    const text = readFileSync('update.sh', 'utf8');
    expect(text).toContain('quit app id');
    expect(text).toContain('$RICE_BUNDLE_ID');
    expect(text).toMatch(/open \\"\$RICE_APP\\"/);
    expect(text).not.toMatch(/open -a Rice[^"]/);
    expect(readFileSync('scripts/install-lib.sh', 'utf8')).toContain('RICE_BUNDLE_ID="com.rice.app"');
    expect(readFileSync('scripts/install-lib.sh', 'utf8')).toContain('lsregister');
  });

  test('imprime "Rice atualizado: versão X, commit Y" e confere com o HEAD do clone', async () => {
    const t = await setup();
    t.publish('novo');
    const r = t.run();
    expect(r.code).toBe(0);
    const head = git(t.clone, 'rev-parse', '--short=7', 'HEAD');
    expect(r.out).toContain(`Rice updated: version 0.4.0, commit ${head}`);
    const pt = t.run(['--force'], { LANG: 'pt_BR.UTF-8' });
    expect(pt.out).toContain(`Rice atualizado: versão 0.4.0, commit ${head}`);
  });

  test('build-info divergente: erro claro dizendo que a instalação não trocou o app', async () => {
    const t = await setup();
    t.publish('novo');
    const r = t.run([], { RICE_UPDATE_INSTALL_CMD: t.installStub('deadbee') });
    expect(r.code).toBe(1);
    expect(r.out).toContain('commit deadbee');
    expect(r.out).toContain('the install did not replace the app');
  });

  test('sem build-info no app instalado: erro claro', async () => {
    const t = await setup();
    t.publish('novo');
    const r = t.run([], { RICE_UPDATE_INSTALL_CMD: `echo install >> '${join(t.base, 'calls.log')}'; rm -f '${t.app}/Contents/Resources/app/out/build-info.json'` });
    expect(r.code).toBe(1);
    expect(r.out).toContain('could not read the installed app commit');
  });

  test('outras cópias do Rice (Spotlight e abertas): aviso com os caminhos, ignorando /Applications e o dist/ do clone; nada é apagado', async () => {
    const t = await setup();
    t.publish('novo');
    mkdirSync(join(t.clone, 'dist', 'mac-arm64', 'Rice.app'), { recursive: true });
    t.mdfind(t.app, '/Users/x/Downloads/Rice.app', '/Users/x/Rice antigo/Rice.app', join(t.clone, 'dist', 'mac-arm64', 'Rice.app'));
    const r = t.run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('WARNING: there are other copies of Rice in:');
    expect(r.out).toContain('  - /Users/x/Downloads/Rice.app');
    expect(r.out).toContain('  - /Users/x/Rice antigo/Rice.app');
    expect(r.out).not.toContain(`  - ${t.app}`);
    expect(r.out).not.toContain('dist/mac-arm64');
    expect(r.out).toContain('nothing was deleted');
    const pt = t.run(['--force'], { LANG: 'pt_BR.UTF-8' });
    expect(pt.out).toContain('há outras cópias do Rice em:');
    expect(pt.out).toContain('abra sempre');
  });

  test('sem outras cópias, nenhum aviso', async () => {
    const t = await setup();
    t.publish('novo');
    t.mdfind(t.app);
    expect(t.run().out).not.toContain('other copies');
  });

  test('depois de reabrir, o processo em execução precisa ser o de /Applications: se for outro, erro mostrando o caminho', async () => {
    const t = await setup();
    t.publish('novo');
    t.running();
    const r = t.run([], { RICE_UPDATE_OPEN_CMD: `echo open >> '${join(t.base, 'calls.log')}'; echo '- /Users/x/Downloads/Rice.app' > '${t.base}/running'` });
    expect(r.code).toBe(1);
    expect(r.out).toContain('the open Rice is NOT the one at');
    expect(r.out).toContain('  - /Users/x/Downloads/Rice.app');
  });

  test('um Rice que não fecha (outra cópia teimosa): erro com o caminho, sem seguir para o build', async () => {
    const t = await setup();
    t.publish('novo');
    t.running('/Users/x/Downloads/Rice.app');
    const r = t.run([], { RICE_UPDATE_QUIT_CMD: `echo quit >> '${join(t.base, 'calls.log')}'` });
    expect(r.code).toBe(1);
    expect(r.out).toContain('did not quit');
    expect(r.out).toContain('/Users/x/Downloads/Rice.app');
    expect(r.calls).toEqual(['quit']);
  });

  test('o registro no LaunchServices roda depois do build e antes de reabrir', async () => {
    const t = await setup();
    t.publish('novo');
    t.running();
    expect(t.run().calls).toEqual(['quit', 'install', 'lsregister', 'open']);
  });
});

describe('install-lib.sh: detecção do Rice aberto', () => {
  test('lê o caminho de cada Rice principal em execução (com espaços), ignora helpers e outros apps', async () => {
    const base = await makeTmpDir();
    mkdirSync(join(base, 'bin'));
    writeFileSync(join(base, 'bin', 'ps'), `#!/bin/bash
cat <<'EOT'
  101 /Applications/Rice.app/Contents/MacOS/Rice
  102 /Applications/Rice.app/Contents/Frameworks/Rice Helper (Renderer).app/Contents/MacOS/Rice Helper (Renderer) --type=renderer
  203 /Users/x/My Apps/Rice.app/Contents/MacOS/Rice
  304 /Users/x/Downloads/Rice.app/Contents/MacOS/Rice --inspect
  405 /Applications/Other.app/Contents/MacOS/Other
  506 /usr/bin/vim Rice.app
EOT
`);
    chmodSync(join(base, 'bin', 'ps'), 0o755);
    const r = spawnSync('bash', ['-c', '. scripts/install-lib.sh; rice_running; echo ---; rice_running_paths'], { encoding: 'utf8', env: { PATH: `${join(base, 'bin')}:${process.env.PATH ?? ''}`, HOME: base } });
    const [lines = '', paths = ''] = r.stdout.split('---\n');
    expect(lines.trim().split('\n')).toEqual(['101 /Applications/Rice.app', '203 /Users/x/My Apps/Rice.app', '304 /Users/x/Downloads/Rice.app']);
    expect(paths.trim().split('\n')).toEqual(['/Applications/Rice.app', '/Users/x/Downloads/Rice.app', '/Users/x/My Apps/Rice.app']);
  });

  test('o install.sh (sozinho) registra o app, confere o que instalou e avisa de outras cópias e do Rice aberto', () => {
    const text = readFileSync('install.sh', 'utf8');
    expect(text).toContain('. ./scripts/install-lib.sh');
    expect(text.indexOf('mv "$STAGE" "$DEST"')).toBeLessThan(text.indexOf('rice_register'));
    expect(text).toContain('rice_verify_installed');
    expect(text).toContain('rice_warn_other_copies');
    expect(text).toContain('RICE_FROM_UPDATE'); // quando o update.sh chama, é ele quem fecha, reabre e confere
    expect(text).not.toMatch(/open -a Rice/);
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
