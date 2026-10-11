import { describe, expect, test, vi } from 'vitest';
import { AiError, type AiRunner } from '../../src/main/ai/types';
import { copyNotes, draftEmail, exportInfo, exportPdf, openMail, type ShareDeps } from '../../src/main/share/actions';

const META = { id: 'm1', title: 'Kickoff Acme', startedAt: '2026-10-01T10:00:00-03:00', state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [] } as any;
const NOTES = '## Decisões\n\n- Seguir o plano\n- [ ] Enviar proposta\n';

function deps(over: Partial<ShareDeps> = {}, ai = 'ASSUNTO: Follow-up Kickoff\n---\nOlá!\n\n- Seguir o plano') {
  const clipboard = { write: vi.fn() };
  const runner: AiRunner & { prompts: string[] } = {
    prompts: [],
    async *run(o) {
      this.prompts.push(o.prompt);
      yield 'x';
      return ai;
    },
  };
  const d: any = {
    checkedDir: async (dir: unknown) => {
      if (dir !== '/R/a') throw new Error('Pasta de reunião fora da pasta configurada.');
      return '/R/a';
    },
    readMeta: async () => META,
    readText: async (_d: string, f: string) => (f === 'notes' ? NOTES : '**[10:00:01] Eu:** oi\n'),
    clipboard,
    runner,
    languageOf: async () => ({ language: 'pt', headings: 'pt-BR' }),
    participants: async () => ['ana@acme.com', 'eu@mim.com'],
    selfEmails: async () => ['EU@mim.com'],
    openExternal: vi.fn(async () => {}),
    exportFolder: async () => ({ display: '~/Downloads' }),
    exportTarget: async (name: string) => `/out/${name}`,
    writeFile: vi.fn(async () => {}),
    createPdfWindow: () => ({ loadURL: async () => {}, printToPDF: async () => Buffer.from('%PDF'), destroy: () => {} }),
    ...over,
  };
  return d as ShareDeps & { clipboard: typeof clipboard; runner: typeof runner };
}

describe('copiar notas', () => {
  test('rico: o clipboard recebe HTML formatado e o Markdown em texto', async () => {
    const d = deps();
    expect(await copyNotes(d, '/R/a', 'rich')).toEqual({ ok: true });
    const [arg] = d.clipboard.write.mock.calls[0]!;
    expect(arg.text).toBe(NOTES.trim());
    expect(arg.html).toContain('<h2>Decisões</h2>');
    expect(arg.html).toContain('<li class="task">☐ Enviar proposta</li>');
  });
  test('Markdown: só texto', async () => {
    const d = deps();
    await copyNotes(d, '/R/a', 'markdown');
    expect(d.clipboard.write).toHaveBeenCalledWith({ text: NOTES.trim() });
  });
  test('sem notas ou pasta fora da raiz: erro, nada copiado', async () => {
    const d = deps({ readText: async () => '  ' });
    expect(await copyNotes(d, '/R/a', 'rich')).toMatchObject({ ok: false, message: 'Esta reunião ainda não tem notas.' });
    expect(await copyNotes(deps(), '/etc', 'rich')).toMatchObject({ ok: false });
    expect(d.clipboard.write).not.toHaveBeenCalled();
  });
});

describe('rascunho de e-mail', () => {
  test('assunto e corpo da IA, destinatários da agenda sem o e-mail do usuário', async () => {
    const d = deps();
    const r = await draftEmail(d, '/R/a', new AbortController().signal);
    expect(r).toMatchObject({ ok: true, subject: 'Follow-up Kickoff', body: 'Olá!\n\n- Seguir o plano', to: ['ana@acme.com'] });
    expect(d.runner.prompts[0]).toContain('Seguir o plano');
  });
  test('erro do provedor volta com a mensagem amigável', async () => {
    const runner: AiRunner = {
      // eslint-disable-next-line require-yield
      async *run() {
        throw new AiError('auth', 'Sessão expirada.');
      },
    };
    expect(await draftEmail(deps({ runner }), '/R/a', new AbortController().signal)).toEqual({ ok: false, message: 'Sessão expirada.' });
  });
  test('resposta vazia da IA é erro', async () => {
    expect(await draftEmail(deps({}, '   '), '/R/a', new AbortController().signal)).toMatchObject({ ok: false });
  });
});

describe('abrir no Mail', () => {
  test('monta o mailto no main, sem o e-mail do usuário, e abre só ele', async () => {
    const d = deps();
    expect(await openMail(d, { to: ['ana@acme.com', 'eu@mim.com'], subject: 'Oi & tchau', body: 'linha 1\nlinha 2', url: 'file:///etc/passwd' })).toEqual({ ok: true });
    const url = (d.openExternal as any).mock.calls[0][0] as string;
    expect(url.startsWith('mailto:ana@acme.com?subject=Oi%20%26%20tchau&body=linha%201%0D%0Alinha%202')).toBe(true);
    expect(url).not.toContain('eu@mim.com');
    expect(url).not.toContain('passwd');
  });
  test('longo demais não abre', async () => {
    const d = deps();
    expect(await openMail(d, { to: [], subject: 's', body: 'á'.repeat(9000) })).toMatchObject({ ok: false });
    expect(d.openExternal).not.toHaveBeenCalled();
  });
  test('entrada que não é objeto não quebra', async () => {
    expect(await openMail(deps(), null)).toEqual({ ok: true });
  });
});

describe('exportar PDF', () => {
  test('o diálogo mostra a pasta de destino (com ~) e o nome sugerido: título + .pdf', async () => {
    expect(await exportInfo(deps(), '/R/a')).toEqual({ ok: true, folder: '~/Downloads', fileName: 'Kickoff Acme.pdf' });
    expect(await exportInfo(deps(), '/etc')).toMatchObject({ ok: false });
  });
  test('grava direto no destino com o nome escolhido, sem diálogo de salvar', async () => {
    const target = vi.fn(async (name: string) => `/out/${name}`);
    const d = deps({ exportTarget: target });
    expect(await exportPdf(d, '/R/a', { transcript: true, fileName: 'Resumo da semana' })).toEqual({ ok: true, path: '/out/Resumo da semana.pdf' });
    expect(target).toHaveBeenCalledWith('Resumo da semana.pdf');
    expect(d.writeFile).toHaveBeenCalledWith('/out/Resumo da semana.pdf', Buffer.from('%PDF'));
  });
  test('nome vazio ou só com caracteres proibidos volta ao título; o nome é sanitizado', async () => {
    const target = vi.fn(async (name: string) => `/out/${name}`);
    const d = deps({ exportTarget: target });
    await exportPdf(d, '/R/a', { fileName: '   ' });
    await exportPdf(d, '/R/a', { fileName: '../../etc/passwd: x?.PDF' });
    await exportPdf(d, '/R/a', { fileName: '///' });
    await exportPdf(d, '/R/a', {});
    expect(target.mock.calls.map((c) => c[0])).toEqual(['Kickoff Acme.pdf', 'etc passwd x.pdf', 'Kickoff Acme.pdf', 'Kickoff Acme.pdf']);
  });
  test('a transcrição só entra na página se pedida', async () => {
    const pages: string[] = [];
    const mk = () => ({ loadURL: async (u: string) => void pages.push(decodeURIComponent(u)), printToPDF: async () => Buffer.from('%PDF'), destroy: () => {} });
    await exportPdf(deps({ createPdfWindow: mk }), '/R/a', { transcript: false });
    await exportPdf(deps({ createPdfWindow: mk }), '/R/a', { transcript: true });
    expect(pages[0]).not.toContain('class="transcript"');
    expect(pages[1]).toContain('class="transcript"');
    expect(pages[1]).toContain('oi');
    expect(pages[0]).toContain('<h2>Decisões</h2>');
    expect(pages[0]).toContain('Participantes: ana@acme.com');
    expect(pages[0]).not.toContain('eu@mim.com');
  });
  test('erro ao gravar volta como mensagem e nada fica marcado como salvo', async () => {
    const d = deps({ writeFile: vi.fn(async () => { throw new Error('disco cheio'); }) });
    expect(await exportPdf(d, '/R/a', {})).toEqual({ ok: false, message: 'disco cheio' });
  });
});

describe('nomes dados às "Pessoa N"', () => {
  test('o PDF com transcrição mostra os nomes, não "Pessoa N"', async () => {
    const pages: string[] = [];
    const mk = () => ({ loadURL: async (u: string) => void pages.push(decodeURIComponent(u)), printToPDF: async () => Buffer.from('%PDF'), destroy: () => {} });
    const d = deps({
      createPdfWindow: mk,
      readMeta: async () => ({ ...META, speakers: { '2': 'Ana' } }),
      readText: async (_d: string, f: string) => (f === 'notes' ? NOTES : '**[10:00:01] Pessoa 2:** oi\n\n**[10:00:09] Pessoa 3:** olá\n'),
    });
    await exportPdf(d, '/R/a', { transcript: true });
    expect(pages[0]).toContain('<b>Ana</b> oi');
    expect(pages[0]).toContain('<b>Pessoa 3</b> olá'); // sem nome, continua "Pessoa N"
  });
});

describe('marcadores das anotações do usuário', () => {
  const MARKED = '## Decisões\n\n- <!--u:1-->Piloto antes do calendário<!--/u--> — só depois do piloto\n';
  test('copiar, e-mail e PDF não levam os comentários <!--u:N-->', async () => {
    const pages: string[] = [];
    const d = deps({
      readText: async (_d: string, f: string) => (f === 'notes' ? MARKED : ''),
      createPdfWindow: () => ({ loadURL: async (u: string) => void pages.push(decodeURIComponent(u)), printToPDF: async () => Buffer.from('%PDF'), destroy: () => {} }),
    });
    await copyNotes(d, '/R/a', 'markdown');
    expect(d.clipboard.write).toHaveBeenCalledWith({ text: '## Decisões\n\n- Piloto antes do calendário — só depois do piloto' });
    await copyNotes(d, '/R/a', 'rich');
    expect((d.clipboard.write as any).mock.calls[1][0].html).not.toContain('u:1');
    await draftEmail(d, '/R/a', new AbortController().signal);
    expect(d.runner.prompts[0]).not.toContain('<!--');
    await exportPdf(d, '/R/a', {});
    expect(pages[0]).not.toMatch(/&lt;!--|<!--u/);
    expect(pages[0]).toContain('Piloto antes do calendário');
  });
});
