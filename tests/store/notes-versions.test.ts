import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { generateNotes, regenerateNotes } from '../../src/main/session/notes';
import { BUILTIN_TEMPLATES } from '../../src/main/templates/builtin';
import { archiveNotes, listVersions, MAX_VERSIONS, readVersion, restoreVersion } from '../../src/main/store/notes-versions';
import { appendSegment, createMeeting, readMeetingText, readMeta, writeNotes } from '../../src/main/store/meeting-files';
import type { NoteTemplate } from '../../src/shared/types';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 0);
const geral = BUILTIN_TEMPLATES[0]!;
const brainstorm: NoteTemplate = { id: 'brainstorm', title: 'Brainstorm', description: 'Ideias', icon: 'file-text', builtin: false, sections: [{ heading: 'Ideias', description: 'x' }] };
const resolver = (id?: string) => Promise.resolve(id === 'brainstorm' ? brainstorm : geral);
const says = (text: string) => ({ async *run() { return text; } }) as never;

async function meeting() {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Daily', startedAt, trigger: 'manual' });
  await appendSegment(dir, startedAt, { id: '1', source: 'Outros', startMs: 0, endMs: 1000, text: 'prazo é sexta' });
  return dir;
}
const tick = () => new Promise((r) => setTimeout(r, 5)); // createdAt (ISO em ms) diferente entre versões

test('gerar 3 vezes: 2 versões guardadas (da mais nova à mais antiga) + a atual em notas.md, com index.json', async () => {
  const dir = await meeting();
  await generateNotes(dir, says('primeira'), resolver);
  await tick();
  await regenerateNotes(dir, says('segunda'), 'brainstorm', resolver);
  await tick();
  await regenerateNotes(dir, says('terceira'), geral.id, resolver);
  expect(await readMeetingText(dir, 'notes')).toBe('terceira\n');
  const versions = await listVersions(dir);
  expect(versions.map((v) => [v.templateId, v.templateName])).toEqual([['brainstorm', 'Brainstorm'], [geral.id, geral.title]]);
  expect(await Promise.all(versions.map((v) => readFile(join(dir, 'notas-versoes', v.file), 'utf8')))).toEqual(['segunda\n', 'primeira\n']);
  expect(versions[0]!.file).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+\.\d{3}Z-brainstorm\.md$/);
  const index = JSON.parse(await readFile(join(dir, 'notas-versoes', 'index.json'), 'utf8'));
  expect(index).toHaveLength(2);
  expect(Object.keys(index[0]).sort()).toEqual(['createdAt', 'file', 'templateId', 'templateName']);
});

test('restaurar: a versão vira a atual (e o template volta), a atual vira versão e a restaurada sai da lista', async () => {
  const dir = await meeting();
  await generateNotes(dir, says('primeira'), resolver);
  await tick();
  await regenerateNotes(dir, says('segunda'), 'brainstorm', resolver);
  const [old] = await listVersions(dir);
  await restoreVersion(dir, old!.file, async (id) => (await resolver(id)).title);
  expect(await readMeetingText(dir, 'notes')).toBe('primeira\n');
  expect((await readMeta(dir)).templateId).toBe(geral.id);
  const after = await listVersions(dir);
  expect(after).toHaveLength(1);
  expect(after[0]!.templateName).toBe('Brainstorm');
  expect((await readVersion(dir, after[0]!.file)).content).toBe('segunda\n');
  await expect(readVersion(dir, old!.file)).rejects.toThrow();
});

test('limite de 20 versões: as mais antigas somem (arquivo e índice)', async () => {
  const dir = await meeting();
  for (let i = 0; i < MAX_VERSIONS + 3; i++) await archiveNotes(dir, { content: `v${i}`, templateId: 'geral', templateName: 'Reunião geral', createdAt: new Date(2026, 9, 1, 10, i).toISOString() });
  const versions = await listVersions(dir);
  expect(versions).toHaveLength(MAX_VERSIONS);
  expect(await readFile(join(dir, 'notas-versoes', versions[0]!.file), 'utf8')).toBe(`v${MAX_VERSIONS + 2}`);
  expect(await readFile(join(dir, 'notas-versoes', versions.at(-1)!.file), 'utf8')).toBe('v3');
  expect((await readdir(join(dir, 'notas-versoes'))).filter((f) => f.endsWith('.md'))).toHaveLength(MAX_VERSIONS);
});

test('migra o notas-anterior.md existente como uma versão (uma vez só) e remove o arquivo antigo', async () => {
  const dir = await meeting();
  await writeFile(join(dir, 'notas-anterior.md'), 'notas antigas\n');
  await writeNotes(dir, 'atuais\n');
  const versions = await listVersions(dir);
  expect(versions).toHaveLength(1);
  expect(versions[0]!.templateId).toBe('anterior');
  expect((await readVersion(dir, versions[0]!.file)).content).toBe('notas antigas\n');
  await expect(stat(join(dir, 'notas-anterior.md'))).rejects.toThrow();
  expect(await listVersions(dir)).toHaveLength(1);
});

test('texto igual à versão mais recente não duplica; vazio é ignorado; nome de arquivo fora do índice é recusado', async () => {
  const dir = await meeting();
  await archiveNotes(dir, { content: 'a', templateId: 'geral', templateName: 'G' });
  await archiveNotes(dir, { content: 'a', templateId: 'geral', templateName: 'G' });
  await archiveNotes(dir, { content: '  \n', templateId: 'geral', templateName: 'G' });
  expect(await listVersions(dir)).toHaveLength(1);
  await expect(readVersion(dir, '../meta.json')).rejects.toThrow();
});

test('falha ao regerar não deixa versão (o histórico só guarda o que foi substituído de verdade)', async () => {
  const dir = await meeting();
  await generateNotes(dir, says('primeira'), resolver);
  await regenerateNotes(dir, { async *run() { throw new Error('boom'); } } as never, 'brainstorm', resolver).catch(() => {});
  expect(await listVersions(dir)).toEqual([]);
  expect(await readMeetingText(dir, 'notes')).toBe('primeira\n');
});
