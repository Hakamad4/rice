import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fold, queryTerms } from '../../src/main/search/fold';
import { buildSnippet, SearchIndex } from '../../src/main/search/index';
import { appendSegment, createMeeting, MEETING_FILES, renameMeeting, writeAnnotations, writeNotes } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const none = new Map<string, string>();

async function seed(root: string, title: string, when: string, parts: { notes?: string; transcript?: string; annotations?: string; folderId?: string } = {}) {
  const { dir } = await createMeeting(root, { title, startedAt: new Date(when), trigger: 'manual', state: 'draft', ...(parts.folderId ? { folderId: parts.folderId } : {}) });
  if (parts.notes) await writeNotes(dir, parts.notes);
  if (parts.annotations) await writeAnnotations(dir, parts.annotations);
  if (parts.transcript) await appendSegment(dir, new Date(when), { id: 's', source: 'Eu', startMs: 0, endMs: 1000, text: parts.transcript });
  return dir;
}

describe('fold', () => {
  test('tira acento e caixa sem mudar o tamanho', () => {
    for (const text of ['Decisão de Orçamento', 'ÇÃO ação à É', 'plain ASCII', 'İstanbul ß']) expect(fold(text).length).toBe(text.normalize('NFC').length);
    expect(fold('Decisão de Orçamento')).toBe('decisao de orcamento');
    expect(fold('AÇÃO')).toBe('acao');
  });
  test('trata texto decomposto (NFD) como composto', () => {
    expect(fold('decisão'.normalize('NFD'))).toBe('decisao');
  });
  test('queryTerms: sem acento, sem pontuação, sem repetir', () => {
    expect(queryTerms('  Pré-venda, "Orçamento" pré ')).toEqual(['pre', 'venda', 'orcamento']);
    expect(queryTerms('***')).toEqual([]);
  });
});

describe('SearchIndex', () => {
  test('acha por título, notas, transcrição e anotações, sem diferenciar acento nem caixa', async () => {
    const root = await makeTmpDir();
    await seed(root, 'Planejamento do trimestre', '2026-10-01T10:00:00-03:00', { notes: '## Decisões\n- Adiar a pré-venda para novembro' });
    await seed(root, 'Weekly', '2026-10-02T10:00:00-03:00', { transcript: 'Precisamos revisar o ORÇAMENTO da campanha' });
    await seed(root, 'Outra', '2026-10-03T10:00:00-03:00', { annotations: 'ligar para a Ana sobre o contrato' });
    const index = new SearchIndex();
    await index.refresh(root);
    expect(index.size).toBe(3);

    expect(index.query('planejamento', none).map((r) => r.title)).toEqual(['Planejamento do trimestre']);
    expect(index.query('decisoes', none)[0]?.hits.map((h) => h.field)).toEqual(['notes']);
    expect(index.query('orcamento', none)[0]?.hits[0]).toMatchObject({ field: 'transcript' });
    expect(index.query('CONTRATO', none)[0]?.hits[0]?.field).toBe('annotations');
    expect(index.query('pre-venda', none)[0]?.title).toBe('Planejamento do trimestre');
    expect(index.query('zzzz', none)).toEqual([]);
    expect(index.query('   ', none)).toEqual([]);
  });

  test('todas as palavras precisam aparecer (em campos quaisquer) e valem como começo de palavra', async () => {
    const root = await makeTmpDir();
    await seed(root, 'Sync', '2026-10-01T10:00:00-03:00', { notes: 'Contrato assinado', transcript: 'o prazo é sexta' });
    await seed(root, 'Banana', '2026-10-02T10:00:00-03:00', { notes: 'nada' });
    const index = new SearchIndex();
    await index.refresh(root);
    expect(index.query('contrato prazo', none).map((r) => r.title)).toEqual(['Sync']);
    expect(index.query('contrato inexistente', none)).toEqual([]);
    expect(index.query('contr', none)).toHaveLength(1); // prefixo
    expect(index.query('ana', none)).toEqual([]); // "Banana" não conta: o termo não começa a palavra
  });

  test('reindexa só o que mudou: notas novas, renomear e anotações aparecem na próxima busca', async () => {
    const root = await makeTmpDir();
    const dir = await seed(root, 'Daily', '2026-10-01T10:00:00-03:00');
    const other = await seed(root, 'Estável', '2026-10-02T10:00:00-03:00', { notes: 'ficou igual' });
    const index = new SearchIndex();
    await index.refresh(root);
    const before = index.get(other);
    expect(index.query('kubernetes', none)).toEqual([]);

    await new Promise((r) => setTimeout(r, 15)); // mtime diferente
    await writeNotes(dir, 'Migramos para Kubernetes');
    await index.refresh(root);
    expect(index.query('kubernetes', none).map((r) => r.title)).toEqual(['Daily']);
    expect(index.get(other)).toBe(before); // a outra reunião não foi relida

    await renameMeeting(dir, 'Migração');
    await writeAnnotations(dir, 'lembrar do orçamento');
    await index.refresh(root);
    expect(index.query('migracao', none).map((r) => r.title)).toEqual(['Migração']);
    expect(index.query('orcamento', none)[0]?.hits[0]?.field).toBe('annotations');
  });

  test('reunião apagada sai do índice e trocar a raiz limpa tudo', async () => {
    const root = await makeTmpDir();
    const dir = await seed(root, 'Some', '2026-10-01T10:00:00-03:00', { notes: 'sumir' });
    const index = new SearchIndex();
    await index.refresh(root);
    expect(index.query('sumir', none)).toHaveLength(1);
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true });
    await index.refresh(root);
    expect(index.size).toBe(0);
    const root2 = await makeTmpDir();
    await seed(root2, 'Nova', '2026-10-01T10:00:00-03:00');
    await index.refresh(root2);
    expect(index.all().map((e) => e.title)).toEqual(['Nova']);
  });

  test('meta.json ilegível deixa só aquela reunião de fora', async () => {
    const root = await makeTmpDir();
    const bad = await seed(root, 'Quebrada', '2026-10-01T10:00:00-03:00');
    await seed(root, 'Boa', '2026-10-02T10:00:00-03:00');
    await writeFile(join(bad, MEETING_FILES.meta), '{ não é json');
    const index = new SearchIndex();
    await index.refresh(root);
    expect(index.all().map((e) => e.title)).toEqual(['Boa']);
  });

  test('ordem: título pesa mais que transcrição; empate vai para a mais recente', async () => {
    const root = await makeTmpDir();
    await seed(root, 'Conversa', '2026-10-05T10:00:00-03:00', { transcript: 'falamos do roadmap' });
    await seed(root, 'Roadmap 2027', '2026-01-05T10:00:00-03:00');
    await seed(root, 'Roadmap antigo', '2026-01-04T10:00:00-03:00');
    await seed(root, 'Roadmap novo', '2026-01-06T10:00:00-03:00');
    const index = new SearchIndex();
    await index.refresh(root);
    const now = Date.parse('2026-10-06T00:00:00-03:00');
    expect(index.query('roadmap', none, now).map((r) => r.title)).toEqual(['Roadmap novo', 'Roadmap 2027', 'Roadmap antigo', 'Conversa']);
  });

  test('o nome da pasta também entra na busca', async () => {
    const root = await makeTmpDir();
    await seed(root, 'Kickoff', '2026-10-01T10:00:00-03:00', { folderId: 'f1' });
    await seed(root, 'Avulsa', '2026-10-02T10:00:00-03:00');
    const index = new SearchIndex();
    await index.refresh(root);
    const results = index.query('client', new Map([['f1', 'Clientes']]));
    expect(results.map((r) => r.title)).toEqual(['Kickoff']);
    expect(results[0]).toMatchObject({ folder: 'Clientes' });
    expect(results[0]?.hits[0]).toMatchObject({ field: 'folder', snippet: 'Clientes', marks: [[0, 6]] });
  });

  test('refresh simultâneo não relê duas vezes nem se perde', async () => {
    const root = await makeTmpDir();
    for (let i = 0; i < 5; i++) await seed(root, `R${i}`, `2026-10-0${i + 1}T10:00:00-03:00`, { notes: 'texto' });
    const index = new SearchIndex();
    await Promise.all([index.refresh(root), index.refresh(root), index.refresh(root)]);
    expect(index.size).toBe(5);
  });
});

describe('snippets', () => {
  test('uma linha, sem marcação de Markdown nem "[hora] Fulano:", com o termo marcado', () => {
    const line = '**[10:03:12] Eu:** então a gente fecha o ORÇAMENTO na sexta e depois revisa tudo com o time';
    const s = buildSnippet(line, ['orcamento']);
    expect(s.snippet.startsWith('então a gente')).toBe(true);
    expect(s.snippet.slice(s.marks[0]![0], s.marks[0]![1])).toBe('ORÇAMENTO');
    expect(s.snippet).not.toMatch(/\*\*|\[10/);
  });

  test('linhas longas são cortadas nas palavras, com reticências, e o termo continua dentro', () => {
    const long = `${'blá '.repeat(60)}contrato${' fim'.repeat(60)}`;
    const s = buildSnippet(long, ['contrato']);
    expect(s.snippet.length).toBeLessThan(140);
    expect(s.snippet.startsWith('…')).toBe(true);
    expect(s.snippet.endsWith('…')).toBe(true);
    expect(s.snippet.slice(s.marks[0]![0], s.marks[0]![1])).toBe('contrato');
  });

  test('marca todas as palavras buscadas e junta as que se tocam', () => {
    const s = buildSnippet('- [ ] revisar contrato do cliente', ['contrato', 'cliente']);
    expect(s.snippet).toBe('revisar contrato do cliente');
    expect(s.marks.map(([a, b]) => s.snippet.slice(a, b))).toEqual(['contrato', 'cliente']);
  });

  test('o snippet vem da linha que tem todas as palavras, mesmo que haja uma anterior com só uma', async () => {
    const root = await makeTmpDir();
    await seed(root, 'X', '2026-10-01T10:00:00-03:00', { notes: '- prazo curto\n- contrato e prazo fechados\n' });
    const index = new SearchIndex();
    await index.refresh(root);
    const hit = index.query('contrato prazo', none)[0]!.hits[0]!;
    expect(hit.snippet).toBe('contrato e prazo fechados');
    expect(hit.offset).toBeGreaterThan(10);
  });
});

describe('marcadores das anotações do usuário', () => {
  test('a busca não vê nem mostra os comentários <!--u:N-->', async () => {
    const root = await makeTmpDir();
    await seed(root, 'Plano', '2026-10-01T10:00:00-03:00', { notes: '- <!--u:2-->Pedir o orçamento ao financeiro<!--/u--> — falta o valor' });
    const index = new SearchIndex();
    await index.refresh(root);
    const hit = index.query('orcamento', none)[0]!.hits[0]!;
    expect(hit.snippet).toBe('Pedir o orçamento ao financeiro — falta o valor');
    expect(index.query('u:2', none)).toEqual([]);
  });
});
