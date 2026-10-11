import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { damagedEntry, isUsableMeta, parseFolderName, readMetaIfUsable, repairMeta } from '../../src/main/store/meta-repair';
import { createMeeting, readMeta } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const at = new Date(2026, 9, 8, 14, 30);

async function meetingWith(meta: string | null, extra: Record<string, string> = {}) {
  const root = await makeTmpDir();
  const dir = join(root, '2026-10-08 1430 - Planejamento (2)');
  await mkdir(dir);
  if (meta !== null) await writeFile(join(dir, 'meta.json'), meta);
  for (const [name, text] of Object.entries(extra)) await writeFile(join(dir, name), text);
  return dir;
}

test('nome da pasta vira data, hora e título (sem o sufixo de duplicata)', () => {
  expect(parseFolderName('2026-10-08 1430 - Planejamento (2)')).toEqual({ startedAt: new Date(2026, 9, 8, 14, 30), title: 'Planejamento' });
  expect(parseFolderName('minha pasta qualquer')).toEqual({ startedAt: null, title: 'minha pasta qualquer' });
});

test('meta utilizável: precisa dos campos básicos, não só de JSON válido', () => {
  expect(isUsableMeta({ id: 'a', title: 'x', startedAt: '2026-10-08T14:30:00-03:00', state: 'done', gaps: [] })).toBe(true);
  expect(isUsableMeta({ id: 'a', title: 'x' })).toBe(false);
  expect(isUsableMeta({ id: 'a', title: 'x', startedAt: 'não é data', state: 'done', gaps: [] })).toBe(false);
  expect(isUsableMeta(null)).toBe(false);
});

test('arquivos truncados, vazios, com bytes inválidos ou sem campos: readMetaIfUsable devolve null sem lançar', async () => {
  for (const bad of ['{"id": "a", "title"', '', '\u0000\u0001\u0002', '[]', '{"id":"a"}', 'null']) {
    expect(await readMetaIfUsable(await meetingWith(bad))).toBeNull();
  }
  expect(await readMetaIfUsable(await meetingWith(null))).toBeNull();
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'Ok', startedAt: at, trigger: 'manual' });
  expect((await readMetaIfUsable(dir))!.title).toBe('Ok');
});

test('entrada de lista de uma reunião danificada usa o nome da pasta', async () => {
  const dir = await meetingWith('{ruim');
  const entry = await damagedEntry(dir);
  expect(entry).toMatchObject({ dir, title: 'Planejamento', state: 'damaged' });
  expect(entry.startedAt.startsWith('2026-10-08T14:30')).toBe(true);
});

test('repairMeta reconstrói o básico, guarda o arquivo ruim e escolhe o estado pelo que existe na pasta', async () => {
  const withNotes = await meetingWith('{ruim', { 'notas.md': '## Resumo\n\nok', 'transcricao.md': '**[14:30:01] Eu:** oi\n\n' });
  const a = await repairMeta(withNotes);
  expect(a).toMatchObject({ title: 'Planejamento', state: 'done', notesStatus: 'done' });
  expect((await readMeta(withNotes)).title).toBe('Planejamento'); // agora legível
  expect(await readFile(join(withNotes, 'meta.json.corrompido'), 'utf8')).toBe('{ruim'); // nada é apagado
  expect((await readdir(withNotes)).sort()).toEqual(['meta.json', 'meta.json.corrompido', 'notas.md', 'transcricao.md']);

  const onlyTranscript = await meetingWith('', { 'transcricao.md': '**[14:30:01] Eu:** oi\n\n', 'audio.wav': 'x' });
  expect(await repairMeta(onlyTranscript)).toMatchObject({ state: 'interrupted', notesStatus: 'failed' });

  const empty = await meetingWith(null);
  expect(await repairMeta(empty)).toMatchObject({ state: 'interrupted', notesStatus: 'pending' });
});
