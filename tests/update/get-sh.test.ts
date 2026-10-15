import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { makeTmpDir } from '../helpers/tmp';

const script = resolve('get.sh');
const mac = test.skipIf(process.platform !== 'darwin');

mac('pasta que existe e não é clone: para sem tocar em nada', async () => {
  const dir = join(await makeTmpDir(), 'rice');
  mkdirSync(dir);
  const r = spawnSync('bash', [script], { env: { ...process.env, RICE_DIR: dir, LC_ALL: '', LANG: 'pt_BR.UTF-8' }, encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('não é um clone do Rice');
});

mac('clone que já existe: atualiza pelo update.sh (não clona de novo)', async () => {
  const dir = join(await makeTmpDir(), 'rice');
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'update.sh'), '#!/bin/bash\necho UPDATE_RAN\n');
  chmodSync(join(dir, 'update.sh'), 0o755);
  const r = spawnSync('bash', [script], { env: { ...process.env, RICE_DIR: dir }, encoding: 'utf8' });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('UPDATE_RAN');
});

/** HOME de mentira com settings.json do Rice apontando a pasta de notas (ou sem settings: vale o padrão ~/Rice). */
async function fakeHome(notesRoot?: string) {
  const home = await makeTmpDir();
  if (notesRoot) {
    mkdirSync(join(home, 'Library', 'Application Support', 'Rice'), { recursive: true });
    writeFileSync(join(home, 'Library', 'Application Support', 'Rice', 'settings.json'), JSON.stringify({ keepAudio: true, root: notesRoot }));
  }
  return home;
}

/** `git` falso no PATH: registra os argumentos e falha, para o teste nunca ir à rede. */
function fakeGit(dir: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), `#!/bin/bash\necho "git $*" >> '${dir}/git.log'\nexit 1\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return { path: `${bin}:${process.env.PATH ?? ''}`, log: join(dir, 'git.log') };
}

mac('pasta de notas do Rice (padrão ~/Rice): não clona nem atualiza lá, explica e indica RICE_DIR', async () => {
  const home = await fakeHome();
  mkdirSync(join(home, 'Rice'));
  const r = spawnSync('bash', [script], { env: { ...process.env, HOME: home, RICE_DIR: join(home, 'Rice'), LC_ALL: '', LANG: 'pt_BR.UTF-8' }, encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('pasta das suas notas');
  expect(r.stderr).toContain('RICE_DIR=');
});

mac('pasta de notas escolhida nas configurações: também recusa', async () => {
  const home = await fakeHome('/tmp/minhas-notas');
  const notes = join(home, 'Notas');
  mkdirSync(notes);
  writeFileSync(join(home, 'Library', 'Application Support', 'Rice', 'settings.json'), JSON.stringify({ root: notes }));
  const r = spawnSync('bash', [script], { env: { ...process.env, HOME: home, RICE_DIR: notes, LC_ALL: '', LANG: 'en_US.UTF-8' }, encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('notes folder');
});

mac('sem RICE_DIR: baixa em ~/rice-src (não em ~/rice, que no APFS é a pasta de notas ~/Rice)', async () => {
  const home = await fakeHome();
  const g = fakeGit(home);
  const r = spawnSync('bash', [script], { env: { ...process.env, HOME: home, PATH: g.path, LC_ALL: '', LANG: 'pt_BR.UTF-8' }, encoding: 'utf8' });
  expect(r.stdout).toContain(`baixando o Rice em ${join(home, 'rice-src')}`);
  expect(readFileSync(g.log, 'utf8')).toContain(`clone --filter=blob:none https://github.com/WalissonCF/rice.git ${join(home, 'rice-src')}`);
});

mac('clone antigo em ~/rice com as notas em outra pasta: continua atualizando ali', async () => {
  const home = await fakeHome('/tmp/notas-em-outro-lugar');
  const dir = join(home, 'rice');
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'update.sh'), '#!/bin/bash\necho UPDATE_RAN\n');
  chmodSync(join(dir, 'update.sh'), 0o755);
  const r = spawnSync('bash', [script], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('UPDATE_RAN');
});
