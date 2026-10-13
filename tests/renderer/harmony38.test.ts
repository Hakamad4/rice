// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'pending' }];
const TEMPLATE = { id: 'general', title: 'Reunião geral', description: '', builtin: true, sections: [{ heading: 'Decisões', description: '' }] };

function boot(templates: unknown[], extra: Record<string, unknown> = {}) {
  return bootRenderer({
    listTemplates: async () => ({ templates, defaultId: templates.length ? 'general' : null, warnings: [] }),
    readMeeting: async () => ({ meta: { notesStatus: 'pending', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done' }, transcript: '**[10:00:00] Eu:** oi', annotations: '', notes: '', chat: [] }),
    generateNotes: vi.fn(async () => ({ ok: true })),
    ...extra,
  }, MEETINGS);
}
const open = async () => {
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.gen-chip')).not.toBeNull());
};

it('"Gerar notas" não fica solto acima das abas: vira ação discreta com ícone ao lado do seletor de template', async () => {
  const { rice } = boot([TEMPLATE]);
  await open();
  const gen = g.document.querySelector('.gen-chip') as any;
  expect(gen.closest('.page-actions')).toBeNull();
  expect(gen.closest('.tpl-picker')).not.toBeNull(); // mesma linha do template
  expect(gen.querySelector('svg')).not.toBeNull();
  expect(gen.textContent).toBe('Gerar notas');
  expect(g.document.querySelector('.page-actions')?.children.length ?? 0).toBe(0);
  gen.click();
  expect(gen.disabled).toBe(true);
  expect(gen.textContent).toBe('Gerando notas…');
  await vi.waitFor(() => expect(rice.generateNotes).toHaveBeenCalledWith('/R/a'));
});

it('sem templates na lista o botão continua na aba Notas (em linha própria, mesmo estilo)', async () => {
  boot([]);
  await open();
  const gen = g.document.querySelector('.gen-chip') as any;
  expect(gen.closest('.tpl-picker')).not.toBeNull();
  expect(gen.closest('.page-actions')).toBeNull();
});

it('Atalhos usa o ícone de teclado (não o alvo da War room)', async () => {
  boot([TEMPLATE]);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.set-nav-item')).not.toBeNull());
  const item = [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => b.textContent === 'Atalhos') as any;
  const warroom = g.window.RiceIcons.icon('record').innerHTML;
  const keyboard = g.window.RiceIcons.icon('keyboard').innerHTML;
  expect(keyboard).not.toBe(warroom);
  expect(item.querySelector('svg').innerHTML).toBe(keyboard);
  expect(g.window.RiceIcons.icon('keyboard').querySelectorAll('path').length).toBeGreaterThan(5);
});
