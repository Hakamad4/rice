import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { makeTmpDir } from '../helpers/tmp';

const mac = test.skipIf(process.platform !== 'darwin');

/** Roda um trecho de bash com o install-lib.sh carregado e um HOME de mentira. */
const lib = (home: string, code: string) => spawnSync('bash', ['-c', `. scripts/install-lib.sh; ${code}`], { env: { ...process.env, HOME: home }, encoding: 'utf8' });

mac('rice_notes_root: ~/Rice por padrão; a pasta das configurações quando existe', async () => {
  const home = await makeTmpDir();
  expect(lib(home, 'rice_notes_root').stdout).toBe(join(home, 'Rice'));
  mkdirSync(join(home, 'Library', 'Application Support', 'Rice'), { recursive: true });
  writeFileSync(join(home, 'Library', 'Application Support', 'Rice', 'settings.json'), JSON.stringify({ keepAudio: true, root: '/tmp/Minhas Notas' }));
  expect(lib(home, 'rice_notes_root').stdout).toBe('/tmp/Minhas Notas');
});

mac('rice_same_dir: a mesma pasta por dois nomes (maiúsculas, caminho relativo); pastas diferentes ou inexistentes não', async () => {
  const home = await makeTmpDir();
  mkdirSync(join(home, 'Rice'));
  mkdirSync(join(home, 'outra'));
  expect(lib(home, `rice_same_dir '${join(home, 'Rice')}' '${join(home, 'Rice', '.')}' && echo same`).stdout).toBe('same\n');
  expect(lib(home, `rice_same_dir '${join(home, 'Rice')}' '${join(home, 'outra')}' || echo different`).stdout).toBe('different\n');
  expect(lib(home, `rice_same_dir '${join(home, 'Rice')}' '${join(home, 'nao-existe')}' || echo different`).stdout).toBe('different\n');
});
