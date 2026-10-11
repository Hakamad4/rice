import { chmod, mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { tightenAppData, tightenTree } from '../../src/main/store/permissions';
import { makeTmpDir } from '../helpers/tmp';

const mode = async (p: string) => (await stat(p)).mode & 0o777;

test('pastas viram 0700 e arquivos 0600, em profundidade; o que já está certo não conta', async () => {
  const dir = await makeTmpDir();
  const meeting = join(dir, 'reuniao');
  await mkdir(join(meeting, 'sub'), { recursive: true });
  await writeFile(join(meeting, 'transcricao.md'), 'x');
  await writeFile(join(meeting, 'sub', 'a.json'), '{}');
  await chmod(meeting, 0o755);
  await chmod(join(meeting, 'sub'), 0o755);
  await chmod(join(meeting, 'transcricao.md'), 0o644);
  await chmod(join(meeting, 'sub', 'a.json'), 0o666);
  expect(await tightenTree(meeting)).toBe(4);
  expect(await mode(meeting)).toBe(0o700);
  expect(await mode(join(meeting, 'sub'))).toBe(0o700);
  expect(await mode(join(meeting, 'transcricao.md'))).toBe(0o600);
  expect(await mode(join(meeting, 'sub', 'a.json'))).toBe(0o600);
  expect(await tightenTree(meeting)).toBe(0); // idempotente
});

test('não segue link simbólico (nunca mexe fora da pasta) e não lança para caminho que não existe', async () => {
  const dir = await makeTmpDir();
  const outside = join(dir, 'fora.txt');
  await writeFile(outside, 'x');
  await chmod(outside, 0o644);
  await mkdir(join(dir, 'm'));
  await symlink(outside, join(dir, 'm', 'link'));
  await tightenTree(join(dir, 'm'));
  expect(await mode(outside)).toBe(0o644);
  expect(await tightenTree(join(dir, 'nao-existe'))).toBe(0);
});

test('tightenAppData: reuniões, .rice e dados do app; a pasta raiz escolhida pelo usuário não é alterada', async () => {
  const root = await makeTmpDir();
  const userData = await makeTmpDir();
  await mkdir(join(root, '2026-10-08 1400 - Daily'));
  await writeFile(join(root, '2026-10-08 1400 - Daily', 'meta.json'), '{}');
  await mkdir(join(root, '.rice'));
  await writeFile(join(root, '.rice', 'folders.json'), '{}');
  await writeFile(join(userData, 'settings.json'), '{}');
  await mkdir(join(userData, 'spool', 'x'), { recursive: true });
  await writeFile(join(userData, 'spool', 'x', 'transcricao.md'), 'x');
  await writeFile(join(userData, 'google-calendar.bin'), 'x');
  for (const p of [join(root, '2026-10-08 1400 - Daily', 'meta.json'), join(root, '.rice', 'folders.json'), join(userData, 'settings.json'), join(userData, 'google-calendar.bin'), join(userData, 'spool', 'x', 'transcricao.md')]) await chmod(p, 0o644);
  await chmod(root, 0o755);
  await tightenAppData(root, userData);
  expect(await mode(join(root, '2026-10-08 1400 - Daily', 'meta.json'))).toBe(0o600);
  expect(await mode(join(root, '.rice', 'folders.json'))).toBe(0o600);
  expect(await mode(join(userData, 'settings.json'))).toBe(0o600);
  expect(await mode(join(userData, 'google-calendar.bin'))).toBe(0o600);
  expect(await mode(join(userData, 'spool', 'x', 'transcricao.md'))).toBe(0o600);
  expect(await mode(root)).toBe(0o755);
});
