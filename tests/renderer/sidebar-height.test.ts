// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const html = readFileSync('src/renderer/index.html', 'utf8');

it('o menu é um bloco próprio com os 8 itens (ícone e nome); busca e logo ficam acima, lista e rodapé abaixo', async () => {
  bootRenderer({}, [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }]);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  const aside = g.document.querySelector('aside');
  const kids = [...aside.children].map((n: any) => n.className.split(' ')[0]);
  expect(kids.indexOf('brand')).toBeLessThan(kids.indexOf('search-box'));
  expect(kids.indexOf('search-box')).toBeLessThan(kids.indexOf('side-menu'));
  expect(kids.indexOf('side-menu')).toBeLessThan(kids.indexOf('side-scroll'));
  expect(kids.indexOf('side-scroll')).toBeLessThan(kids.indexOf('side-foot')); // o rodapé é o último: preso embaixo
  const items = [...g.document.querySelectorAll('#side-menu > .nav-item')];
  expect(items.map((n: any) => n.id)).toEqual(['home-link', 'followups-link', 'memory-link', 'new', 'new-war', 'templates-link', 'settings-link', 'guide-link']);
  for (const n of items) {
    expect(n.querySelector('.ico'), n.id).not.toBeNull(); // sempre ícone...
    expect(n.textContent.trim().length, n.id).toBeGreaterThan(0); // ...e nome
  }
  expect(html).not.toMatch(/side-compact|nav-secondary|side-body/); // nada de modo de ícones nem invólucro em bloco
});

it('CSS: o menu encolhe antes da lista (mínimo ~3 itens) e rola; a lista tem rolagem própria; busca, logo e rodapé não encolhem', () => {
  const rule = (sel: string) => new RegExp(`${sel.replace(/[.>]/g, '\\$&')} \\{([^}]*)\\}`).exec(html)?.[1] ?? '';
  const menu = rule('aside > .side-menu');
  expect(menu).toMatch(/flex:0 1 auto/);
  expect(menu).toMatch(/min-height:(1\d\d)px/); // pelo menos ~3 itens
  expect(menu).toMatch(/overflow-y:auto/);
  expect(rule('aside > .side-scroll')).toMatch(/flex:1 1 auto;[^}]*overflow-y:auto/);
  expect(html).toMatch(/aside > \* \{ flex:none; \}/);
  for (const edge of ['top', 'bottom', 'both']) expect(html).toContain(`.side-menu[data-fade="${edge}"]`);
});

const menu = () => g.window.RiceSidebarMenu;

it('fadeOf: indica onde há itens escondidos', () => {
  expect(menu().fadeOf(0, 300, 300)).toBe(''); // tudo cabe: sem fade
  expect(menu().fadeOf(0, 300, 120)).toBe('bottom');
  expect(menu().fadeOf(60, 300, 120)).toBe('both');
  expect(menu().fadeOf(180, 300, 120)).toBe('top'); // no fim
});

it('revealDelta: o item ativo sempre aparece (rola só o que falta, com folga)', () => {
  const m = { top: 100, bottom: 220 };
  expect(menu().revealDelta({ top: 120, bottom: 150 }, m)).toBe(0);
  expect(menu().revealDelta({ top: 200, bottom: 240 }, m, 6)).toBe(26); // escondido embaixo: rola 20 + 6
  expect(menu().revealDelta({ top: 80, bottom: 110 }, m, 6)).toBe(-26); // escondido em cima
});

it('attach: o fade acompanha a rolagem e o item ativo é trazido para a vista', () => {
  const el = g.document.createElement('nav');
  const a = g.document.createElement('button');
  a.className = 'nav-item active';
  el.append(a);
  let scrollTop = 0;
  Object.defineProperties(el, { scrollTop: { get: () => scrollTop, set: (v: number) => (scrollTop = v) }, scrollHeight: { value: 300 }, clientHeight: { value: 120 } });
  el.getBoundingClientRect = () => ({ top: 100, bottom: 220 }) as any;
  a.getBoundingClientRect = () => ({ top: 230 - scrollTop, bottom: 260 - scrollTop }) as any; // abaixo da área visível
  const { update } = menu().attach(el);
  update();
  expect(scrollTop).toBeGreaterThan(0); // trouxe o ativo para a vista
  expect(el.dataset.fade).toBe('both');
  scrollTop = 0;
  a.className = 'nav-item';
  update();
  expect(el.dataset.fade).toBe('bottom');
});
