// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { rendered, tokenValue } from '../helpers/tokens';

const g = globalThis as any;
const load = () => new Function(readFileSync('src/renderer/resize.js', 'utf8'))();
const make = (over: Record<string, unknown> = {}) => {
  const handle = g.document.createElement('div');
  g.document.body.append(handle);
  const r = g.window.RiceResize.create({ handle, key: 'k.side', cssVar: '--side-w', min: 200, max: 400, def: 232, edge: 'right', label: 'Largura', ...over });
  return { handle, r };
};
const css = () => g.document.documentElement.style.getPropertyValue('--side-w');
const key = (handle: any, k: string) => handle.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const pointer = (handle: any, type: string, x = 0) => {
  const e = new g.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, pointerId: 1 });
  handle.dispatchEvent(e);
};

beforeEach(() => {
  load();
  g.localStorage.clear();
  g.document.documentElement.removeAttribute('style');
  g.document.body.replaceChildren();
  g.document.body.className = '';
  g.HTMLElement.prototype.setPointerCapture = () => {};
});

it('alça com role=separator, valores e foco; começa no padrão', () => {
  const { handle } = make();
  expect(handle.getAttribute('role')).toBe('separator');
  expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  expect([handle.getAttribute('aria-valuemin'), handle.getAttribute('aria-valuemax'), handle.getAttribute('aria-valuenow')]).toEqual(['200', '400', '232']);
  expect(handle.tabIndex).toBe(0);
  expect(css()).toBe('232px');
});

it('teclado: → aumenta 16px, ← diminui 16px, com limites; salva e atualiza aria-valuenow', () => {
  const { handle } = make();
  key(handle, 'ArrowRight');
  expect(css()).toBe('248px');
  expect(handle.getAttribute('aria-valuenow')).toBe('248');
  expect(g.localStorage.getItem('k.side')).toBe('248');
  for (let i = 0; i < 20; i++) key(handle, 'ArrowRight');
  expect(css()).toBe('400px');
  for (let i = 0; i < 20; i++) key(handle, 'ArrowLeft');
  expect(css()).toBe('200px');
});

it('painel do chat (borda esquerda): ← aumenta; arrastar usa a largura da janela menos o x', () => {
  g.window.innerWidth = 1300;
  const { handle } = make({ key: 'k.chat', cssVar: '--chat-w', min: 280, max: 520, def: 320, edge: 'left' });
  key(handle, 'ArrowLeft');
  expect(g.document.documentElement.style.getPropertyValue('--chat-w')).toBe('336px');
  pointer(handle, 'pointerdown', 980);
  pointer(handle, 'pointermove', 900); // 1300 − 900 = 400
  expect(g.document.documentElement.style.getPropertyValue('--chat-w')).toBe('400px');
  pointer(handle, 'pointermove', 100); // passa do máximo
  expect(g.document.documentElement.style.getPropertyValue('--chat-w')).toBe('520px');
  pointer(handle, 'pointerup');
  expect(g.localStorage.getItem('k.chat')).toBe('520');
});

it('arrastar a sidebar: largura = x, com limites 200–400; só salva ao soltar; classe "dragging"', () => {
  const { handle } = make();
  pointer(handle, 'pointerdown', 232);
  expect(handle.classList.contains('dragging')).toBe(true);
  pointer(handle, 'pointermove', 300);
  expect(css()).toBe('300px');
  expect(g.localStorage.getItem('k.side')).toBeNull();
  pointer(handle, 'pointermove', 50);
  expect(css()).toBe('200px');
  pointer(handle, 'pointerup');
  expect(g.localStorage.getItem('k.side')).toBe('200');
  expect(handle.classList.contains('dragging')).toBe(false);
});

it('duplo clique volta ao padrão (e limpa o salvo); a largura salva volta ao recarregar', () => {
  g.localStorage.setItem('k.side', '300');
  const { handle } = make();
  expect(css()).toBe('300px');
  handle.dispatchEvent(new g.window.Event('dblclick', { bubbles: true }));
  expect(css()).toBe('232px');
  expect(g.localStorage.getItem('k.side')).toBeNull();
});

it('valor salvo fora dos limites é corrigido; localStorage bloqueado não quebra', () => {
  g.localStorage.setItem('k.side', '9999');
  make();
  expect(css()).toBe('400px');
  const orig = Object.getOwnPropertyDescriptor(g.window, 'localStorage');
  Object.defineProperty(g.window, 'localStorage', { get() { throw new Error('bloqueado'); }, configurable: true });
  try {
    const { handle } = make();
    expect(css()).toBe('232px'); // sem salvo: padrão
    key(handle, 'ArrowRight'); // ajusta mesmo sem conseguir salvar
    expect(css()).toBe('248px');
  } finally {
    if (orig) Object.defineProperty(g.window, 'localStorage', orig);
  }
});

it('CSS: variáveis de largura, alça de 6px sem arrasto da janela, --tools-left acompanha a sidebar, some quando recolhida', () => {
  const css = rendered('src/renderer/index.html');
  expect([tokenValue('--side-w'), tokenValue('--chat-w')]).toEqual(['232px', '320px']);
  expect(css).toMatch(/grid-template-columns:var\(--side-w\) minmax\(0,1fr\) 0;/);
  expect(css).toMatch(/--tools-left:calc\(var\(--side-w\) - 36px\)/);
  expect(css).toMatch(/\.rz-handle \{[^}]*width:6px[^}]*cursor:col-resize[^}]*-webkit-app-region:no-drag/);
  expect(css).toMatch(/\.rz-handle:hover::after[^}]*background:var\(--line\)/);
  expect(css).toMatch(/body\.side-collapsed \.rz-side \{ display:none; \}/);
});
