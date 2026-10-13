// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';

const g = globalThis as any;
const document = g.document;

beforeAll(() => {
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'menu-select']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

function openAt(right: number) {
  document.body.replaceChildren();
  const picker = g.window.RiceMenuSelect.create({ items: [{ value: 'a', label: 'Automático: Haiku 5.5' }, { value: 'b', label: 'Igual ao principal' }], value: 'a', ariaLabel: 'x', onChoose: () => {} });
  document.body.append(picker.root);
  const proto = g.window.HTMLElement.prototype;
  const orig = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    return this.classList.contains('select-popover') ? { left: right - 240, right, top: 0, bottom: 100, width: 240, height: 100 } : orig.call(this);
  };
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1200 });
  document.querySelector('.menu-select-btn').dispatchEvent(new g.window.MouseEvent('click', { bubbles: true }));
  const pop = document.querySelector('.select-popover') as any;
  proto.getBoundingClientRect = orig;
  return pop;
}

it('menu perto da borda direita abre para a esquerda (sem rolagem horizontal)', () => {
  const pop = openAt(1290);
  expect(pop.style.right).toBe('0px');
  expect(pop.style.left).toBe('auto');
});

it('menu com espaço continua abrindo para a direita', () => {
  const pop = openAt(600);
  expect(pop.style.right).toBe('');
});
