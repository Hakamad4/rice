import { stat } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { makeTmpDir } from './tmp';

test('makeTmpDir cria um diretório', async () => {
  const dir = await makeTmpDir();
  expect((await stat(dir)).isDirectory()).toBe(true);
});

test('TZ do teste é America/Sao_Paulo', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo');
});
