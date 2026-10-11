import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { indexMeeting, MeetingIndex, rebuildIndex, toFtsQuery, type MeetingSummary } from '../../src/main/store/meeting-index';
import { appendSegment, createMeeting, MEETING_FILES, renameMeeting, writeAnnotations, writeNotes } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const summary = (id: string, title: string, startedAt: string): MeetingSummary => ({
  id,
  dir: `/x/${id}`,
  title,
  startedAt,
  state: 'done',
  notesStatus: 'done',
});

async function openIndex() {
  return new MeetingIndex(join(await makeTmpDir(), 'index.db'));
}

describe('toFtsQuery', () => {
  test('cita cada palavra com prefixo', () => {
    expect(toFtsQuery('pré-venda prazo')).toBe('"pré"* "venda"* "prazo"*');
  });
  test('ignora aspas e pontuação', () => {
    expect(toFtsQuery('"orçamento" ***')).toBe('"orçamento"*');
  });
  test('sem palavras devolve null', () => {
    expect(toFtsQuery(' *** "" ')).toBeNull();
  });
});

describe('MeetingIndex', () => {
  test('list ordena da mais recente para a mais antiga', async () => {
    const idx = await openIndex();
    idx.upsert(summary('a', 'Antiga', '2026-10-01T10:00:00-03:00'), '');
    idx.upsert(summary('b', 'Nova', '2026-10-08T10:00:00-03:00'), '');
    expect(idx.list().map((m) => m.id)).toEqual(['b', 'a']);
    idx.close();
  });

  test('upsert atualiza sem duplicar', async () => {
    const idx = await openIndex();
    idx.upsert(summary('a', 'Velho', '2026-10-01T10:00:00-03:00'), 'abacaxi');
    idx.upsert({ ...summary('a', 'Novo', '2026-10-01T10:00:00-03:00'), state: 'interrupted' }, 'banana');
    expect(idx.list()).toEqual([{ ...summary('a', 'Novo', '2026-10-01T10:00:00-03:00'), state: 'interrupted' }]);
    expect(idx.search('abacaxi')).toEqual([]);
    expect(idx.search('banana').map((m) => m.id)).toEqual(['a']);
    idx.close();
  });

  test('busca ignora acentos e aceita prefixo', async () => {
    const idx = await openIndex();
    idx.upsert(summary('a', 'Planejamento', '2026-10-01T10:00:00-03:00'), 'A decisão foi adiar a pré-venda');
    idx.upsert(summary('b', 'Outra', '2026-10-02T10:00:00-03:00'), 'nada a ver');
    expect(idx.search('decisao').map((m) => m.id)).toEqual(['a']);
    expect(idx.search('pré-venda').map((m) => m.id)).toEqual(['a']);
    expect(idx.search('planej').map((m) => m.id)).toEqual(['a']);
    idx.close();
  });

  test('busca com caracteres especiais não lança erro', async () => {
    const idx = await openIndex();
    idx.upsert(summary('a', 'X', '2026-10-01T10:00:00-03:00'), 'texto');
    for (const q of ['"', 'a OR', 'NEAR(', '*', '-', '(', "'"]) {
      expect(() => idx.search(q)).not.toThrow();
    }
    idx.close();
  });

  test('busca vazia devolve a lista completa', async () => {
    const idx = await openIndex();
    idx.upsert(summary('a', 'X', '2026-10-01T10:00:00-03:00'), '');
    expect(idx.search('   ').map((m) => m.id)).toEqual(['a']);
    idx.close();
  });

  test('remove apaga reunião e texto', async () => {
    const idx = await openIndex();
    idx.upsert(summary('a', 'X', '2026-10-01T10:00:00-03:00'), 'kiwi');
    idx.remove('a');
    expect(idx.list()).toEqual([]);
    expect(idx.search('kiwi')).toEqual([]);
    idx.close();
  });
});

describe('indexMeeting e rebuildIndex', () => {
  test('indexa título, transcrição, anotações e notas', async () => {
    const root = await makeTmpDir();
    const idx = await openIndex();
    const { dir, meta } = await createMeeting(root, { title: 'Daily', startedAt: new Date(2026, 9, 8, 9, 0), trigger: 'manual' });
    await appendSegment(dir, new Date(2026, 9, 8, 9, 0), { id: '1', source: 'Outros', startMs: 0, endMs: 1, text: 'lançamento' });
    await writeAnnotations(dir, 'girassol');
    await writeNotes(dir, '## Resumo\nmorango');
    await indexMeeting(idx, dir);
    for (const q of ['lancamento', 'girassol', 'morango', 'daily']) {
      expect(idx.search(q).map((m) => m.id)).toEqual([meta.id]);
    }
    expect(idx.list()[0]).toEqual({ id: meta.id, dir, title: 'Daily', startedAt: meta.startedAt, state: 'recording', notesStatus: 'pending' });
    idx.close();
  });

  test('rebuildIndex reconstrói do zero e pula meta.json corrompido', async () => {
    const root = await makeTmpDir();
    const idx = await openIndex();
    idx.upsert(summary('fantasma', 'Some', '2026-01-01T00:00:00-03:00'), '');
    const ok = await createMeeting(root, { title: 'Boa', startedAt: new Date(2026, 9, 8, 9, 0), trigger: 'manual' });
    const bad = await createMeeting(root, { title: 'Ruim', startedAt: new Date(2026, 9, 8, 10, 0), trigger: 'manual' });
    await writeFile(join(bad.dir, MEETING_FILES.meta), '{ quebrado');
    const result = await rebuildIndex(idx, root);
    expect(result).toEqual({ indexed: 1, skipped: [bad.dir] });
    expect(idx.list().map((m) => m.id)).toEqual([ok.meta.id]);
    idx.close();
  });
});

test('construtor cria o diretório pai do banco', async () => {
  const dbPath = join(await makeTmpDir(), 'a', 'b', 'index.db');
  const idx = new MeetingIndex(dbPath);
  idx.close();
  expect(existsSync(dbPath)).toBe(true);
});

test('indexMeeting reflete o título renomeado, inclusive na busca', async () => {
  const root = await makeTmpDir();
  const index = await openIndex();
  const { dir } = await createMeeting(root, { title: 'Antigo', startedAt: new Date(), trigger: 'manual' });
  await indexMeeting(index, dir);
  await renameMeeting(dir, 'Retrospectiva');
  await indexMeeting(index, dir);
  expect(index.list().map((m) => m.title)).toEqual(['Retrospectiva']);
  expect(index.search('retrospectiva')).toHaveLength(1);
  index.close();
});
