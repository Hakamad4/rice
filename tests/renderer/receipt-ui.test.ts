// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }];
const LOCAL = { ok: true, title: 'Kickoff', summary: 'Nada desta reunião saiu do seu computador', nothingLeft: true, rows: [{ id: 'audio', label: 'Áudio', value: 'nunca sai do computador', sent: false }, { id: 'notes', label: 'Notas', value: 'nenhum envio', sent: false }], text: 'x' };
const SENT = { ...LOCAL, summary: 'Partes desta reunião (só texto) foram enviadas para: Claude (assinatura)', nothingLeft: false, rows: [{ id: 'notes', label: 'Notas', value: 'Claude (assinatura) · 1 envio · 14:31', sent: true }] };

function boot(receipt: unknown) {
  return bootRenderer({
    receiptGet: vi.fn(async () => receipt),
    receiptExport: vi.fn(async (_d: string, mode: string) => (mode === 'pdf' ? { ok: true, path: '/Users/x/Downloads/Recibo.pdf', display: '~/Downloads/Recibo.pdf' } : { ok: true })),
  }, MEETINGS);
}
const openCard = async () => {
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting .m-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes('O que saiu deste computador')).click();
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog] .receipt-list')).not.toBeNull());
};

it('o ⋯ da reunião tem "O que saiu deste computador" (ícone de escudo); o cartão mostra o resumo e uma linha por item', async () => {
  const t = boot(SENT);
  await openCard();
  expect(t.rice.receiptGet).toHaveBeenCalledWith('/R/a');
  const dialog = g.document.querySelector('[role=dialog]');
  expect(dialog.querySelector('.dlg-title').textContent).toBe('O que saiu deste computador');
  expect(dialog.querySelector('.receipt-summary').textContent).toBe('Partes desta reunião (só texto) foram enviadas para: Claude (assinatura)');
  expect(dialog.querySelector('.receipt-summary').classList.contains('local')).toBe(false);
  const notes = dialog.querySelector('[data-row=notes]');
  expect(notes.textContent).toBe('NotasClaude (assinatura) · 1 envio · 14:31');
  expect(notes.classList.contains('sent')).toBe(true);
  expect(dialog.textContent).toContain('Só metadados: o conteúdo da reunião nunca entra neste registro.');
  expect(dialog.querySelector('.receipt-summary svg')).not.toBeNull();
});

it('tudo local: "Nada desta reunião saiu do seu computador" com o destaque de local', async () => {
  boot(LOCAL);
  await openCard();
  const summary = g.document.querySelector('.receipt-summary');
  expect(summary.textContent).toBe('Nada desta reunião saiu do seu computador');
  expect(summary.classList.contains('local')).toBe(true);
  expect(g.document.querySelector('[data-row=audio]').textContent).toBe('Áudionunca sai do computador');
});

it('exportar: copiar o texto e salvar o PDF (o caminho aparece); Fechar fecha', async () => {
  const t = boot(SENT);
  await openCard();
  const btn = (label: string) => [...g.document.querySelectorAll('[role=dialog] button')].find((b: any) => b.textContent === label) as any;
  btn('Copiar texto').click();
  await vi.waitFor(() => expect(t.rice.receiptExport).toHaveBeenCalledWith('/R/a', 'copy'));
  await vi.waitFor(() => expect(btn('Copiado')).toBeDefined());
  btn('Salvar PDF').click();
  await vi.waitFor(() => expect(t.rice.receiptExport).toHaveBeenCalledWith('/R/a', 'pdf'));
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]').textContent).toContain('Salvo em ~/Downloads/Recibo.pdf'));
  btn('Fechar').click();
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
});

it('falha ao ler: mostra a mensagem sem quebrar', async () => {
  boot({ ok: false, message: 'Pasta fora da raiz' });
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting .m-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes('O que saiu')).click();
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]')).not.toBeNull());
  expect(g.document.querySelector('[role=dialog]').textContent).toContain('Pasta fora da raiz');
});
