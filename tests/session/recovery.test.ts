import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { recoverInterrupted } from '../../src/main/session/recovery';
import { createMeeting, readMeta, writeMeta } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

test('marca recording e finishing como interrupted e preserva done', async () => {
  const root = await makeTmpDir();
  const a = await createMeeting(root, { title: 'A', startedAt: new Date(2026, 9, 8, 10, 0), trigger: 'manual' });
  const b = await createMeeting(root, { title: 'B', startedAt: new Date(2026, 9, 8, 11, 0), trigger: 'manual' });
  const c = await createMeeting(root, { title: 'C', startedAt: new Date(2026, 9, 8, 12, 0), trigger: 'manual' });
  await writeMeta(a.dir, { ...a.meta, state: 'recording' });
  await writeMeta(b.dir, { ...b.meta, state: 'done' });
  await writeMeta(c.dir, { ...c.meta, state: 'finishing' });

  const { recovered, skipped } = await recoverInterrupted(root);

  expect(skipped).toEqual([]);
  expect(recovered.sort()).toEqual([a.dir, c.dir].sort());
  expect((await readMeta(a.dir)).state).toBe('interrupted');
  expect((await readMeta(c.dir)).state).toBe('interrupted');
  expect((await readMeta(b.dir)).state).toBe('done');
});

test('meta corrompido vai para skipped com aviso e não impede os outros', async () => {
  const root = await makeTmpDir();
  const a = await createMeeting(root, { title: 'A', startedAt: new Date(2026, 9, 8, 10, 0), trigger: 'manual' });
  const bad = await createMeeting(root, { title: 'Bad', startedAt: new Date(2026, 9, 8, 11, 0), trigger: 'manual' });
  await writeMeta(a.dir, { ...a.meta, state: 'recording' });
  await writeFile(join(bad.dir, 'meta.json'), '{not json');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const { recovered, skipped } = await recoverInterrupted(root);

  expect(recovered).toEqual([a.dir]);
  expect(skipped).toHaveLength(1);
  expect(skipped[0]!.dir).toBe(bad.dir);
  expect(skipped[0]!.error).toBeTruthy();
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('ignora reuniões draft (criadas e ainda não gravadas)', async () => {
  const root = await makeTmpDir();
  const a = await createMeeting(root, { title: 'A', startedAt: new Date(2026, 9, 8, 10, 0), trigger: 'manual', state: 'draft' });
  const { recovered } = await recoverInterrupted(root);
  expect(recovered).toEqual([]);
  expect((await readMeta(a.dir)).state).toBe('draft');
});

test('o áudio órfão ganha cabeçalho legível já na abertura, sem recodificar (R-27)', async () => {
  const { createMeeting, readMeta } = await import('../../src/main/store/meeting-files');
  const { writeFile, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { makeTmpDir } = await import('../helpers/tmp');
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Longa', startedAt: new Date(2026, 9, 8, 14, 0), trigger: 'manual' });
  // WAV com cabeçalho "vazio" (tamanho 0) e 2 s de dados: o que sobra de um app morto
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(16000, 24); head.write('data', 36, 'ascii');
  await writeFile(join(dir, 'audio.wav'), Buffer.concat([head, Buffer.alloc(2 * 64_000, 1)]));
  const result = await recoverInterrupted(root);
  expect(result.recovered).toEqual([dir]);
  expect((await readMeta(dir)).state).toBe('interrupted');
  const wav = await readFile(join(dir, 'audio.wav'));
  expect(wav.readUInt32LE(40)).toBe(2 * 64_000);
});

test('notas "pendentes" de reunião concluída (app morreu gerando) viram "falhou"; rascunho e reunião vazia ficam como estão (R-47)', async () => {
  const { appendSegment } = await import('../../src/main/store/meeting-files');
  const root = await makeTmpDir();
  const at = new Date(2026, 9, 8, 14, 0);
  const stuck = await createMeeting(root, { title: 'Presa', startedAt: at, trigger: 'manual' });
  await appendSegment(stuck.dir, at, { id: '1', source: 'Eu', startMs: 1000, endMs: 2000, text: 'oi' });
  await writeMeta(stuck.dir, { ...stuck.meta, state: 'done', notesStatus: 'pending' });
  const empty = await createMeeting(root, { title: 'Vazia', startedAt: new Date(2026, 9, 8, 15, 0), trigger: 'manual' });
  await writeMeta(empty.dir, { ...empty.meta, state: 'done', notesStatus: 'pending' });
  const draft = await createMeeting(root, { title: 'Rascunho', startedAt: new Date(2026, 9, 8, 16, 0), trigger: 'manual', state: 'draft' });
  const done = await createMeeting(root, { title: 'Pronta', startedAt: new Date(2026, 9, 8, 17, 0), trigger: 'manual' });
  await writeMeta(done.dir, { ...done.meta, state: 'done', notesStatus: 'done' });
  const result = await recoverInterrupted(root);
  expect(result.stuckNotes).toEqual([stuck.dir]);
  expect((await readMeta(stuck.dir)).notesStatus).toBe('failed');
  expect((await readMeta(empty.dir)).notesStatus).toBe('pending');
  expect((await readMeta(draft.dir)).notesStatus).toBe('pending');
  expect((await readMeta(done.dir)).notesStatus).toBe('done');
});
