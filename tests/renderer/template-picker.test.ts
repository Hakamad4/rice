// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

const g = globalThis as any;
beforeAll(() => {
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'template-preview', 'template-picker']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const geral = { id: 'geral', title: 'Reunião geral', description: 'Geral\nsegunda linha', icon: 'file-text', builtin: true, sections: [{ heading: 'Resumo', description: 'Pontos' }, { heading: 'Decisões', description: 'D' }] };
const retro = { id: 'retro', title: 'Retro', description: 'Retrospectiva', icon: 'file-text', builtin: false, sections: [{ heading: 'Bom', description: 'b' }] };

let onChoose: any;
let onManage: any;
let picker: any;
beforeEach(() => {
  g.document.body.replaceChildren();
  onChoose = vi.fn();
  onManage = vi.fn();
  picker = g.window.RiceTemplatePicker.create({ templates: [geral, retro], selectedId: 'geral', onChoose, onManage });
  g.document.body.append(picker.root);
});

const chip = () => g.document.querySelector('.tpl-chip') as any;
const popover = () => g.document.querySelector('.tpl-popover') as any;
const options = () => [...g.document.querySelectorAll('[role=option]')] as any[];
const key = (target: any, k: string) => target.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: k, bubbles: true }));

it('chip mostra "📝 Reunião geral" e começa fechado', () => {
  expect(chip().textContent).toBe('Reunião geral');
  expect(chip().getAttribute('aria-expanded')).toBe('false');
  expect(popover()).toBeNull();
});

it('abre ao clicar: busca, listbox com seções, item atual com ✓ e rodapé', () => {
  chip().click();
  expect(chip().getAttribute('aria-expanded')).toBe('true');
  expect(popover().querySelector('input[type=search]')).not.toBeNull();
  expect(popover().querySelector('[role=listbox]')).not.toBeNull();
  expect([...popover().querySelectorAll('.tpl-group')].map((n: any) => n.textContent)).toEqual(['Embutidos', 'Meus templates']);
  expect(options().map((o: any) => o.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  expect(options()[0].querySelector('.check svg.icon-check')).not.toBeNull(); // ✓ é o ícone check
  expect(options()[1].querySelector('.check svg')).toBeNull();
  expect(options()[0].querySelector('.tpl-opt-desc').textContent).toBe('Geral'); // só a 1ª linha
  expect(popover().textContent).toContain('Gerenciar templates…');
});

it('Esc fecha e devolve o foco ao chip; clique fora fecha', () => {
  chip().click();
  key(popover().querySelector('input'), 'Escape');
  expect(popover()).toBeNull();
  expect(g.document.activeElement).toBe(chip());
  chip().click();
  g.document.body.dispatchEvent(new g.window.MouseEvent('mousedown', { bubbles: true }));
  expect(popover()).toBeNull();
});

it('↑/↓ navegam e Enter escolhe (chama onChoose e fecha)', () => {
  chip().click();
  const input = popover().querySelector('input');
  key(input, 'ArrowDown');
  expect(options()[1].classList.contains('active')).toBe(true);
  key(input, 'ArrowDown'); // não passa do fim
  expect(options()[1].classList.contains('active')).toBe(true);
  key(input, 'ArrowUp');
  key(input, 'ArrowDown');
  key(input, 'Enter');
  expect(onChoose).toHaveBeenCalledWith('retro');
  expect(popover()).toBeNull();
  expect(chip().textContent).toBe('Retro');
  expect(g.document.activeElement).toBe(chip());
});

it('busca filtra por título e descrição', () => {
  chip().click();
  const input = popover().querySelector('input');
  input.value = 'retrosp';
  input.dispatchEvent(new g.window.Event('input', { bubbles: true }));
  expect(options().map((o: any) => o.textContent)).toEqual([expect.stringContaining('Retro')]);
  expect(popover().querySelectorAll('.tpl-group')).toHaveLength(1);
  input.value = 'zzz';
  input.dispatchEvent(new g.window.Event('input', { bubbles: true }));
  expect(options()).toHaveLength(0);
  expect(popover().textContent).toContain('Nenhum template encontrado');
});

it('clicar num item escolhe; escolher o atual só fecha', () => {
  chip().click();
  options()[0].click();
  expect(onChoose).not.toHaveBeenCalled();
  expect(popover()).toBeNull();
  chip().click();
  options()[1].click();
  expect(onChoose).toHaveBeenCalledWith('retro');
});

it('hover mostra mini prévia das seções do template sob o cursor', () => {
  chip().click();
  options()[1].dispatchEvent(new g.window.MouseEvent('mouseover', { bubbles: true }));
  const preview = popover().querySelector('.tpl-popover-preview');
  expect([...preview.querySelectorAll('h3')].map((h: any) => h.textContent)).toEqual(['Bom']);
});

it('"Gerenciar templates…" chama onManage e fecha', () => {
  chip().click();
  [...popover().querySelectorAll('button')].find((b: any) => b.textContent === 'Gerenciar templates…').click();
  expect(onManage).toHaveBeenCalled();
  expect(popover()).toBeNull();
});

it('setSelected atualiza o chip sem chamar onChoose', () => {
  picker.setSelected('retro');
  expect(chip().textContent).toBe('Retro');
  expect(onChoose).not.toHaveBeenCalled();
});

it('embutido customizado ganha o rótulo "editado" e a prévia mostra a versão efetiva', () => {
  g.document.body.replaceChildren();
  const edited = { ...geral, title: 'Geral do time', customized: true, sections: [{ heading: 'Só isto', description: '' }] };
  const p = g.window.RiceTemplatePicker.create({ templates: [edited, retro], selectedId: 'geral', onChoose: vi.fn() });
  g.document.body.append(p.root);
  chip().click();
  expect(options()[0].querySelector('.tpl-edited').textContent).toBe('editado');
  expect(options()[1].querySelector('.tpl-edited')).toBeNull();
  expect([...popover().querySelectorAll('.tpl-popover-preview h3')].map((h: any) => h.textContent)).toEqual(['Só isto']);
});

it('chip, opções e prévia usam o ícone de linha do template (sem emoji)', () => {
  g.document.body.replaceChildren();
  const tpl = { ...geral, icon: 'users', symbol: '🤝' };
  const p = g.window.RiceTemplatePicker.create({ templates: [tpl, { ...retro, icon: 'lightbulb' }], selectedId: 'geral', onChoose: vi.fn() });
  g.document.body.append(p.root);
  expect(chip().querySelector('svg.icon-users')).not.toBeNull();
  expect(chip().textContent).toBe('Reunião geral');
  chip().click();
  expect(options()[1].querySelector('.tpl-opt-symbol svg.icon-lightbulb')).not.toBeNull();
  options()[1].dispatchEvent(new g.window.MouseEvent('mouseover', { bubbles: true }));
  expect(popover().querySelector('.tpl-popover-preview .tpl-preview-title svg.icon-lightbulb')).not.toBeNull();
  expect(g.document.body.textContent).not.toContain('🤝');
});

it('a prévia vai abaixo da lista quando não cabe na coluna do conteúdo (ex.: chat aberto)', () => {
  g.document.body.replaceChildren();
  const column = g.document.createElement('main');
  column.id = 'detail';
  column.getBoundingClientRect = () => ({ left: 0, right: 700, top: 0, bottom: 800, width: 700, height: 800 });
  const p = g.window.RiceTemplatePicker.create({ templates: [geral, retro], selectedId: 'geral', onChoose: vi.fn() });
  p.root.querySelector('.tpl-chip').getBoundingClientRect = () => ({ left: 400, right: 520, top: 0, bottom: 30, width: 120, height: 30 });
  column.append(p.root);
  g.document.body.append(column);
  chip().click();
  expect(popover().classList.contains('preview-below')).toBe(true); // 400 + 320 + 8 + 280 > 700
});
