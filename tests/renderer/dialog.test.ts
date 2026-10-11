// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer, press } from '../helpers/boot-renderer';

const g = globalThis as any;
const now = new Date().toISOString();
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: now, state: 'done', notesStatus: 'done' }];
const dialog = () => g.document.querySelector('[role=dialog]') as any;
const clean = () => {
  g.document.querySelectorAll('.overlay').forEach((o: any) => o.remove());
  g.window.RiceActionMenu.close();
};

function boot(extra: Record<string, unknown> = {}) {
  return bootRenderer(
    {
      deleteMeeting: vi.fn(async () => ({ ok: true })),
      emailDraft: vi.fn(async (_id: number, _d: string) => ({ ok: true, subject: 's', body: 'corpo', to: [], mailtoLimit: 8000 })),
      cancel: vi.fn(async (_i: number) => {}),
      exportInfo: vi.fn(async (_d: string) => ({ ok: true, folder: '~/Downloads', fileName: 'Kickoff.pdf' })),
      ...extra,
    },
    MEETINGS,
  );
}

const menu = (label: string) => {
  g.document.querySelector('.meeting .m-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes(label)).click();
};
const sub = (label: string | number) => {
  const items = [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
  (typeof label === 'number' ? items[label] : items.find((i) => i.textContent.includes(label))).click();
};
const ready = () => vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());

it('todo diálogo tem a mesma estrutura: título 16px, corpo e rodapé; botões ghost, primário ou perigo', async () => {
  boot();
  await ready();
  const seen: string[] = [];
  const check = (name: string) => {
    const d = dialog();
    expect(d.firstElementChild.tagName, name).toBe('H2');
    expect(d.firstElementChild.className, name).toBe('dlg-title');
    expect(d.querySelector('.dlg-body'), name).not.toBeNull();
    const foot = d.querySelector('.dlg-foot');
    expect(foot, name).not.toBeNull();
    expect(d.lastElementChild, name).toBe(foot);
    for (const b of foot.querySelectorAll('button')) expect(['ghost', 'primary', 'danger'], `${name}: ${b.textContent}`).toContain(b.className.split(' ')[0]);
    expect(d.querySelector('.buttons'), name).toBeNull();
    seen.push(name);
    clean();
  };
  g.document.querySelector('.meeting .m-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.classList.contains('danger')).click();
  check('apagar reunião');
  menu('Mover');
  sub('Nova pasta');
  check('nova pasta');
  menu('Compartilhar');
  sub(3);
  check('PDF');
  menu('Compartilhar');
  sub(2);
  await vi.waitFor(() => expect(dialog().querySelector('textarea')).not.toBeNull());
  check('e-mail');
  expect(seen).toEqual(['apagar reunião', 'nova pasta', 'PDF', 'e-mail']);
});

it('foco inicial: primeiro campo de texto vazio; sem campo, o primeiro botão (Cancelar, seguro)', async () => {
  boot();
  await ready();
  g.document.querySelector('.meeting .m-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.classList.contains('danger')).click();
  expect(g.document.activeElement.textContent).toBe('Cancelar');
  clean();
  menu('Mover');
  sub('Nova pasta');
  expect(g.document.activeElement.tagName).toBe('INPUT');
  expect(g.document.activeElement.placeholder).toBe('Nome da pasta');
});

it('e-mail: foco em "Para" quando está vazio e na mensagem quando já tem destinatários', async () => {
  const open = async (to: string[]) => {
    boot({ emailDraft: vi.fn(async (_id: number, _d: string) => ({ ok: true, subject: 's', body: 'corpo', to, mailtoLimit: 8000 })) });
    await ready();
    menu('Compartilhar');
    sub(2);
    await vi.waitFor(() => expect(dialog().querySelector('textarea')).not.toBeNull());
  };
  await open([]);
  expect(g.document.activeElement.placeholder).toBe('Destinatários, separados por vírgula');
  clean();
  await open(['ana@acme.com']);
  expect(g.document.activeElement.tagName).toBe('TEXTAREA');
});

it('Esc fecha; Enter num campo do e-mail NÃO envia; em "Nova pasta" aciona o primário', async () => {
  boot();
  await ready();
  menu('Compartilhar');
  sub(2);
  await vi.waitFor(() => expect(dialog().querySelector('textarea')).not.toBeNull());
  const open = [...dialog().querySelectorAll('button')].find((b: any) => b.textContent === 'Abrir no Mail');
  const spy = vi.fn();
  open.addEventListener('click', spy);
  press(dialog().querySelector('input'), 'Enter');
  expect(spy).not.toHaveBeenCalled();
  press(dialog().querySelector('textarea'), 'Escape');
  expect(dialog()).toBeNull();
  clean();

  const createFolder = vi.fn(async (name: string) => ({ ok: true, value: { id: 'n', name } }));
  boot({ createFolder, setMeetingFolder: vi.fn(async () => ({ ok: true })) });
  await ready();
  menu('Mover');
  sub('Nova pasta');
  const input = dialog().querySelector('input');
  input.value = 'Clientes';
  press(input, 'Enter');
  await vi.waitFor(() => expect(createFolder).toHaveBeenCalledWith('Clientes'));
  expect(dialog()).toBeNull();
});

it('ao fechar (Esc) o foco volta a quem abriu e a limpeza roda uma vez', async () => {
  boot();
  await ready();
  const cleanup = vi.fn();
  const trigger = g.document.getElementById('new');
  trigger.focus();
  g.window.RiceDialog.open('Teste', (box: any) => {
    box.body.append('x');
    box.foot.append(g.window.RiceDialog.button('OK', 'primary'));
    return cleanup;
  });
  press(dialog(), 'Escape');
  expect(dialog()).toBeNull();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(g.document.activeElement).toBe(trigger);
});

it('flash: o botão troca o texto por "Copiado" e volta depois de 1,5 s', async () => {
  boot();
  await ready();
  vi.useFakeTimers();
  try {
    const b = g.window.RiceDialog.button('Copiar', 'ghost');
    g.window.RiceDialog.flash(b, 'Copiado');
    expect(b.textContent).toBe('Copiado');
    vi.advanceTimersByTime(1400);
    expect(b.textContent).toBe('Copiado');
    vi.advanceTimersByTime(200);
    expect(b.textContent).toBe('Copiar');
  } finally {
    vi.useRealTimers();
  }
});

it('nenhum código fora de dialog.js monta um overlay ou rodapé de diálogo por conta própria', () => {
  for (const f of readdirSync('src/renderer').filter((n) => n.endsWith('.js'))) {
    if (f === 'dialog.js') continue;
    const text = readFileSync(`src/renderer/${f}`, 'utf8');
    expect(text, f).not.toMatch(/className: 'overlay'/);
    expect(text, f).not.toMatch(/className: 'buttons'/);
  }
});
