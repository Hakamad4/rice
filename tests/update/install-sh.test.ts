import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { makeTmpDir } from '../helpers/tmp';

const mac = test.skipIf(process.platform !== 'darwin');

mac('install.sh: para antes de qualquer coisa quando o clone é a pasta de notas do Rice', async () => {
  const home = await makeTmpDir();
  mkdirSync(join(home, 'Library', 'Application Support', 'Rice'), { recursive: true });
  // as notas "estão" no próprio clone (é o que acontece com ~/rice vs ~/Rice no APFS)
  writeFileSync(join(home, 'Library', 'Application Support', 'Rice', 'settings.json'), JSON.stringify({ root: resolve('.') }));
  const r = spawnSync('bash', [resolve('install.sh'), '--check'], { env: { ...process.env, HOME: home, LC_ALL: '', LANG: 'pt_BR.UTF-8' }, encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('pasta das suas notas');
  expect(r.stdout).not.toContain('ambiente conferido');
});
