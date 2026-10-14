import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { makeTmpDir } from '../helpers/tmp';

const script = resolve('get.sh');
const mac = test.skipIf(process.platform !== 'darwin');

mac('pasta que existe e não é clone: para sem tocar em nada', async () => {
  const dir = join(await makeTmpDir(), 'rice');
  mkdirSync(dir);
  const r = spawnSync('bash', [script], { env: { ...process.env, RICE_DIR: dir, LANG: 'pt_BR.UTF-8' }, encoding: 'utf8' });
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
