import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readAnnotations, saveAnnotations } from '../../src/main/store/annotations';
import { createMeeting } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 0, 0);
const at = (min: number, sec = 0) => new Date(2026, 9, 8, 14, min, sec);

async function meeting() {
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'Daily', startedAt, trigger: 'manual' });
  return dir;
}

test('grava o horário de cada linha digitada durante a gravação, sem mudar o anotacoes.md', async () => {
  const dir = await meeting();
  await saveAnnotations(dir, 'confirmar orçamento', at(3, 10), true);
  await saveAnnotations(dir, 'confirmar orçamento\nligar para a Ana', at(7, 45), true);
  expect(await readFile(join(dir, 'anotacoes.md'), 'utf8')).toBe('confirmar orçamento\nligar para a Ana');
  const sidecar = JSON.parse(await readFile(join(dir, 'anotacoes.json'), 'utf8'));
  expect(sidecar.map((a: { text: string; at: string }) => [a.text, a.at.slice(11, 19)])).toEqual([['confirmar orçamento', '14:03:10'], ['ligar para a Ana', '14:07:45']]);
  expect(await readAnnotations(dir)).toEqual([
    { n: 1, text: 'confirmar orçamento', at: sidecar[0].at, clock: '14:03:10' },
    { n: 2, text: 'ligar para a Ana', at: sidecar[1].at, clock: '14:07:45' },
  ]);
});

test('editar uma linha mantém o horário em que ela nasceu', async () => {
  const dir = await meeting();
  await saveAnnotations(dir, 'prazo', at(1, 0), true);
  await saveAnnotations(dir, 'prazo sexta', at(1, 5), true);
  await saveAnnotations(dir, 'prazo sexta, confirmar', at(2, 30), true);
  expect((await readAnnotations(dir))[0]).toMatchObject({ text: 'prazo sexta, confirmar', clock: '14:01:00' });
});

test('linhas escritas fora da gravação ficam sem horário; anotações antigas (sem sidecar) continuam lidas', async () => {
  const dir = await meeting();
  await saveAnnotations(dir, 'depois da reunião', at(50), false);
  expect(await readAnnotations(dir)).toEqual([{ n: 1, text: 'depois da reunião' }]);
  const { writeFile } = await import('node:fs/promises');
  const legacy = await meeting();
  await writeFile(join(legacy, 'anotacoes.md'), 'a\n\n  b  \n');
  expect(await readAnnotations(legacy)).toEqual([{ n: 1, text: 'a' }, { n: 2, text: 'b' }]);
});
