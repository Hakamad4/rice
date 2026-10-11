// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer, press } from '../helpers/boot-renderer';

const g = globalThis as any;
const now = new Date().toISOString();
const MEETINGS = [
  { dir: '/R/a', title: 'Kickoff Acme', startedAt: now, state: 'done', notesStatus: 'done' },
  { dir: '/R/b', title: 'Sem notas', startedAt: now, state: 'done', notesStatus: 'pending' },
];

function boot(extra: Record<string, unknown> = {}) {
  const rice = {
    copyNotes: vi.fn(async () => ({ ok: true })),
    copyMarkdown: vi.fn(async () => ({ ok: true })),
    emailDraft: vi.fn(async (_id: number, _dir: string) => ({ ok: true, subject: 'Follow-up Kickoff', body: 'Olá!\n\n- Seguir o plano', to: ['ana@acme.com'], mailtoLimit: 8000 })),
    openMail: vi.fn(async () => ({ ok: true })),
    exportInfo: vi.fn(async (_dir: string) => ({ ok: true, folder: '~/Downloads', fileName: 'Kickoff Acme.pdf' })),
    exportPdf: vi.fn(async (_dir: string, _o: unknown) => ({ ok: true, path: '/Users/x/Downloads/Kickoff Acme.pdf', display: '~/Downloads/Kickoff Acme.pdf' })),
    chooseExportDir: vi.fn(async (): Promise<{ ok: boolean; folder: string; canceled?: boolean }> => ({ ok: true, folder: '~/Documents/Atas' })),
    revealExport: vi.fn(async (_p: string) => ({ ok: true })),
    cancel: vi.fn(async (_id: number) => {}),
    ...extra,
  };
  bootRenderer(rice, MEETINGS);
  return rice;
}

async function openShare(index = 0) {
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting').length).toBe(2));
  g.document.querySelectorAll('.meeting .m-more')[index].click();
  const share = [...g.document.querySelectorAll('.action-menu .action-item')].find((i: any) => i.textContent.trim() === 'Compartilhar') as any;
  share.click();
  return [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
}

it('submenu Compartilhar: copiar notas, Markdown, e-mail e PDF; sem notas, os de notas ficam desabilitados com a dica', async () => {
  boot();
  const items = await openShare(0);
  expect(items.map((i) => i.textContent.trim())).toEqual(['Copiar notas', 'Copiar como Markdown', 'Rascunho de e-mail de follow-up', 'Exportar PDF…']);
  expect(items.some((i) => i.classList.contains('disabled'))).toBe(false);
  press(g.document.querySelector('.action-menu.submenu .action-list'), 'Escape');
  g.window.RiceActionMenu.close();
  const without = await openShare(1);
  expect(without.map((i) => i.classList.contains('disabled'))).toEqual([true, true, true, false]);
  expect(without[0].title).toBe('Esta reunião ainda não tem notas.');
});

it('Copiar notas chama o IPC com o dir e mostra o aviso discreto "Notas copiadas" que some sozinho', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const rice = boot();
    const items = await openShare(0);
    items[0].click();
    await vi.waitFor(() => expect(rice.copyNotes).toHaveBeenCalledWith('/R/a'));
    await vi.waitFor(() => expect(g.document.getElementById('toast')?.textContent).toBe('Notas copiadas'));
    expect(g.document.getElementById('toast').classList.contains('show')).toBe(true);
    await vi.advanceTimersByTimeAsync(2200);
    expect(g.document.getElementById('toast').classList.contains('show')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('Copiar como Markdown e erro do main aparecem no status', async () => {
  const rice = boot({ copyMarkdown: vi.fn(async () => ({ ok: false, message: 'falhou' })) });
  const items = await openShare(0);
  items[1].click();
  await vi.waitFor(() => expect(rice.copyMarkdown).toHaveBeenCalledWith('/R/a'));
  await vi.waitFor(() => expect(g.document.getElementById('status').textContent).toContain('falhou'));
});

it('e-mail de follow-up: diálogo com destinatários, assunto e corpo editáveis; Copiar e Abrir no Mail', async () => {
  const writeText = vi.fn(async (_t: string) => {});
  Object.defineProperty(g.navigator, 'clipboard', { value: { writeText }, configurable: true });
  const rice = boot({ copyText: async (t: string) => { await writeText(t); return true; } });
  const items = await openShare(0);
  items[2].click();
  expect(g.document.querySelector('[role=dialog]').textContent).toContain('Escrevendo o rascunho…');
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog] textarea')).not.toBeNull());
  const dialog = g.document.querySelector('[role=dialog]');
  const [to, subject] = dialog.querySelectorAll('input');
  const body = dialog.querySelector('textarea');
  expect(to.value).toBe('ana@acme.com');
  expect(subject.value).toBe('Follow-up Kickoff');
  expect(body.value).toBe('Olá!\n\n- Seguir o plano');
  subject.value = 'Novo assunto';
  subject.dispatchEvent(new g.window.Event('input'));

  const buttons = [...dialog.querySelectorAll('button')] as any[];
  buttons.find((b) => b.textContent === 'Copiar').click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('Assunto: Novo assunto\n\nOlá!\n\n- Seguir o plano'));
  await vi.waitFor(() => expect(buttons.find((b) => b.dataset.label === 'Copiar').textContent).toBe('Copiado')); // o aviso fica no próprio botão
  expect(g.document.getElementById('toast')).toBeNull(); // sem toast extra

  buttons.find((b) => b.textContent === 'Abrir no Mail').click();
  await vi.waitFor(() => expect(rice.openMail).toHaveBeenCalledWith({ to: ['ana@acme.com'], subject: 'Novo assunto', body: 'Olá!\n\n- Seguir o plano' }));
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]')).toBeNull());
});

it('e-mail longo demais: some o "Abrir no Mail", fica a dica e o Copiar', async () => {
  boot({ emailDraft: vi.fn(async () => ({ ok: true, subject: 's', body: 'á'.repeat(5000), to: [], mailtoLimit: 8000 })) });
  const items = await openShare(0);
  items[2].click();
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog] textarea')).not.toBeNull());
  const dialog = g.document.querySelector('[role=dialog]');
  const open = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Abrir no Mail') as any;
  expect(open.hidden).toBe(true);
  expect(dialog.querySelector('.dlg-hint.warn').hidden).toBe(false);
  expect([...dialog.querySelectorAll('button')].some((b: any) => b.textContent === 'Copiar')).toBe(true);
  // editar para caber traz o botão de volta
  const body = dialog.querySelector('textarea');
  body.value = 'curto';
  body.dispatchEvent(new g.window.Event('input'));
  expect(open.hidden).toBe(false);
});

it('e-mail: fechar com Esc enquanto a IA escreve cancela a geração; erro vira mensagem no diálogo', async () => {
  const never = new Promise(() => {});
  const rice = boot({ emailDraft: vi.fn((_id: number, _dir: string) => never) });
  const items = await openShare(0);
  items[2].click();
  const dialog = g.document.querySelector('[role=dialog]');
  press(dialog, 'Escape');
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  expect(rice.cancel).toHaveBeenCalledWith(expect.any(Number));
  expect(rice.emailDraft.mock.calls[0]![0]).toBe(rice.cancel.mock.calls[0]![0]);
});

it('e-mail: erro do provedor aparece no diálogo', async () => {
  boot({ emailDraft: vi.fn(async () => ({ ok: false, message: 'Sessão expirada.' })) });
  const items = await openShare(0);
  items[2].click();
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]').textContent).toContain('Sessão expirada.'));
});

const pdfDialog = async (rice: any) => {
  const items = await openShare(0);
  items[3].click();
  await vi.waitFor(() => expect(rice.exportInfo).toHaveBeenCalled());
  const dialog = g.document.querySelector('[role=dialog]');
  await vi.waitFor(() => expect(dialog.querySelectorAll('input')[2].value).toBe('Kickoff Acme.pdf'));
  return dialog;
};
const btn = (dialog: any, text: string) => [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === text) as any;

it('Exportar PDF: caixa na mesma linha do rótulo (clicar no texto marca), "Salvar em" com a pasta e Alterar…, nome do arquivo editável', async () => {
  const rice = boot();
  const dialog = await pdfDialog(rice);
  const row = dialog.querySelector('.dlg-check');
  expect(row.tagName).toBe('LABEL'); // rótulo envolve a caixa: um clique no texto marca
  expect(row.textContent).toBe('Incluir a transcrição');
  expect(row.querySelector('input[type=checkbox]').checked).toBe(false);
  row.querySelector('span').click();
  expect(row.querySelector('input[type=checkbox]').checked).toBe(true);
  const [folder, name] = dialog.querySelectorAll('input:not([type=checkbox])');
  expect(folder.readOnly).toBe(true);
  expect(folder.value).toBe('~/Downloads');
  expect(dialog.textContent).toContain('Salvar em');
  expect(dialog.textContent).toContain('Nome do arquivo');
  expect(name.value).toBe('Kickoff Acme.pdf');
  expect(btn(dialog, 'Alterar…')).toBeDefined();
});

it('Exportar PDF: Alterar… escolhe a pasta (mostrada com ~), o caminho longo é cortado no meio', async () => {
  const rice = boot({ chooseExportDir: vi.fn(async () => ({ ok: true, folder: '~/Documents/Clientes/Acme/Reuniões de planejamento/2026' })) });
  const dialog = await pdfDialog(rice);
  btn(dialog, 'Alterar…').click();
  const folder = dialog.querySelector('input[readonly]');
  await vi.waitFor(() => expect(folder.value).toContain('…'));
  expect(folder.value.length).toBeLessThanOrEqual(38);
  expect(folder.value.startsWith('~/Documen')).toBe(true);
  expect(folder.value.endsWith('/2026')).toBe(true);
  expect(folder.title).toBe('~/Documents/Clientes/Acme/Reuniões de planejamento/2026'); // o completo no tooltip
  // cancelar o diálogo nativo mantém a pasta
  rice.chooseExportDir.mockResolvedValueOnce({ ok: true, canceled: true, folder: '~/Downloads' });
  btn(dialog, 'Alterar…').click();
  await vi.waitFor(() => expect(folder.value).toBe('~/Downloads'));
});

it('Exportar PDF: salva direto (sem outro diálogo) com o nome e a transcrição escolhidos; o botão vira "Mostrar no Finder"', async () => {
  const rice = boot();
  const dialog = await pdfDialog(rice);
  dialog.querySelector('input[type=checkbox]').click();
  const name = dialog.querySelectorAll('input:not([type=checkbox])')[1];
  name.value = 'Ata da semana';
  btn(dialog, 'Exportar').click();
  await vi.waitFor(() => expect(rice.exportPdf).toHaveBeenCalledWith('/R/a', { transcript: true, fileName: 'Ata da semana' }));
  await vi.waitFor(() => expect(btn(dialog, 'Mostrar no Finder')).toBeDefined());
  expect(dialog.textContent).toContain('Salvo em ~/Downloads/Kickoff Acme.pdf');
  expect(btn(dialog, 'Fechar')).toBeDefined();
  btn(dialog, 'Mostrar no Finder').click();
  await vi.waitFor(() => expect(rice.revealExport).toHaveBeenCalledWith('/Users/x/Downloads/Kickoff Acme.pdf'));
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]')).toBeNull());
});

it('Exportar PDF: erro ao gravar fica no diálogo, que continua aberto para tentar de novo', async () => {
  const rice = boot({ exportPdf: vi.fn(async () => ({ ok: false, message: 'Sem espaço no disco.' })) });
  const dialog = await pdfDialog(rice);
  btn(dialog, 'Exportar').click();
  await vi.waitFor(() => expect(dialog.querySelector('.dlg-hint.warn')?.textContent).toBe('Sem espaço no disco.'));
  expect(btn(dialog, 'Exportar').disabled).toBe(false);
  expect(g.document.querySelector('[role=dialog]')).not.toBeNull();
});

it('em inglês: Share, Copy notes e o diálogo do PDF', async () => {
  const rice = boot();
  void rice;
  g.window.RiceI18n.setLanguage('en');
  const items = await (async () => {
    await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting').length).toBe(2));
    g.document.querySelectorAll('.meeting .m-more')[0].click();
    const share = [...g.document.querySelectorAll('.action-menu .action-item')].find((i: any) => i.textContent.trim() === 'Share') as any;
    share.click();
    return [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
  })();
  expect(items.map((i) => i.textContent.trim())).toEqual(['Copy notes', 'Copy as Markdown', 'Follow-up email draft', 'Export PDF…']);
  g.window.RiceI18n.setLanguage('pt-BR');
});

it('troca de idioma com tudo aberto: popover de falante, diálogo, menu e aviso fecham (nada fica misto)', async () => {
  const rice = {
    setUiLanguage: vi.fn(async () => ({ ok: true })),
    copyNotes: vi.fn(async () => ({ ok: true })),
    emailDraft: vi.fn((_id: number, _dir: string) => new Promise(() => {})),
    cancel: vi.fn(async (_id: number) => {}),
  };
  const { handlers } = bootRenderer(rice, MEETINGS);
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting').length).toBe(2));
  const anchor = g.document.createElement('button');
  g.document.body.append(anchor);
  g.window.RiceSpeakerPopover.open({ anchor, label: 'Pessoa 2', name: '', participants: ['Ana'], suggest: async () => [], onSave: () => {} });
  g.window.RiceShare.toast('Notas copiadas');
  g.window.RiceActionMenu.open({ anchor, items: [{ label: 'x', onSelect: () => {} }] });
  expect(g.document.querySelector('.speaker-popover, [class*=speaker]')).not.toBeNull();
  await handlers['ui:language']!('en');
  expect(g.document.querySelector('[class*=speaker-pop]')).toBeNull();
  expect(g.document.getElementById('toast')).toBeNull();
  expect(g.document.querySelectorAll('.action-menu')).toHaveLength(0);
  expect(g.document.querySelectorAll('.overlay')).toHaveLength(0);
});
