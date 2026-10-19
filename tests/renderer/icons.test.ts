// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
beforeAll(() => {
  new Function(readFileSync('src/renderer/icons.js', 'utf8'))();
});

const NEEDED = ['pencil', 'folder', 'folder-plus', 'trash', 'more', 'chevron-right', 'chevron-down', 'check', 'search', 'sidebar', 'settings', 'plus', 'file-text', 'mic', 'globe', 'move', 'copy', 'mail', 'share', 'download', 'message-circle', 'home', 'sparkles'];

it('tem todos os ícones pedidos, cada um com formas desenhadas', () => {
  for (const name of NEEDED) {
    expect(g.window.RiceIcons.NAMES, name).toContain(name);
    expect(g.window.RiceIcons.icon(name).childNodes.length, name).toBeGreaterThan(0);
  }
});

it('ícone: SVG de linha 16×16, stroke currentColor 1.5, sem preenchimento, pontas arredondadas, criado com createElementNS', () => {
  const svg = g.window.RiceIcons.icon('trash');
  expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(svg.tagName.toLowerCase()).toBe('svg');
  expect(svg.getAttribute('width')).toBe('16');
  expect(svg.getAttribute('height')).toBe('16');
  expect(svg.getAttribute('stroke')).toBe('currentColor');
  expect(svg.getAttribute('stroke-width')).toBe('1.5');
  expect(svg.getAttribute('fill')).toBe('none');
  expect(svg.getAttribute('stroke-linecap')).toBe('round');
  expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.firstChild.namespaceURI).toBe('http://www.w3.org/2000/svg');
});

it('caret dos dropdowns: chevron largo 12×12 (M3 4.5 L6 7.5 L9 4.5), traço 1.5 e arredondado', () => {
  const svg = g.window.RiceIcons.caret();
  expect(svg.getAttribute('width')).toBe('12');
  expect(svg.getAttribute('viewBox')).toBe('0 0 12 12');
  expect(svg.getAttribute('stroke-width')).toBe('1.5');
  expect(svg.querySelector('path').getAttribute('d')).toBe('M3 4.5 L6 7.5 L9 4.5');
  expect(svg.getAttribute('stroke-linecap')).toBe('round');
});

it('apply troca os [data-icon] do HTML estático pelo SVG', () => {
  const box = g.document.createElement('div');
  box.innerHTML = '<span data-icon="search"></span><span data-icon="plus"></span>';
  g.window.RiceIcons.apply(box);
  expect([...box.querySelectorAll('svg')].map((s: any) => s.getAttribute('class'))).toEqual(['icon icon-search', 'icon icon-plus']);
});

it('sem emojis de interface nem innerHTML no renderer (só o emoji dos templates e a marca 🍚 ficam)', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  const allowed = [/src\/renderer\/templates\.js.*icon: 'file-text'/, /<div class="brand">🍚 Rice<\/div>/];
  const offenders: string[] = [];
  const files = [...readdirSync('src/renderer').filter((f) => /\.(js|html)$/.test(f) && !f.startsWith('nub') && f !== 'markdown.js').map((f) => join('src/renderer', f)), ...readdirSync('src/renderer/locales').map((f) => join('src/renderer/locales', f))];
  for (const file of files) {
    for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (emoji.test(line) && !allowed.some((re) => re.test(`${file}${line}`) || re.test(line))) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
      if (/\.innerHTML\s*=/.test(line) && !file.endsWith('markdown.js')) offenders.push(`${file}:${i + 1}: innerHTML`);
    }
  }
  expect(offenders).toEqual([]);
});

it('ícone more (⋯): 3 pontos sólidos (fill currentColor, sem stroke) no centro vertical', () => {
  const dots = [...g.RiceIcons.icon('more').querySelectorAll('circle')];
  expect(dots).toHaveLength(3);
  for (const d of dots) {
    expect(d.getAttribute('fill')).toBe('currentColor');
    expect(d.getAttribute('stroke')).toBe('none');
    expect(d.getAttribute('cy')).toBe('12');
  }
  expect(dots.map((d: any) => Number(d.getAttribute('cx')))).toEqual([5, 12, 19]);
});

it('logo do Rice: ícone sólido (fill currentColor, sem traço) com o desenho do usuário; a sidebar usa o ícone, sem emoji', () => {
  const svg = g.window.RiceIcons.icon('rice');
  expect(g.window.RiceIcons.NAMES).toContain('rice');
  const shapes = [...svg.childNodes];
  expect(shapes.map((n: any) => n.tagName.toLowerCase())).toEqual(['path', 'path']);
  for (const n of shapes as any[]) {
    expect(n.getAttribute('fill')).toBe('currentColor');
    expect(n.getAttribute('stroke')).toBe('none');
  }
  expect((shapes[1] as any).getAttribute('d')).toBe('M223 490 H834 A305.5 305.5 0 0 1 223 490 Z');
  const html = rendered('src/renderer/index.html');
  expect(html).toContain('<span class="ico brand-mark" data-icon="rice"></span>');
  expect(html).not.toContain('🍚');
  expect(rendered('src/renderer/nub.html')).toContain('<path d="M223 490 H834 A305.5 305.5 0 0 1 223 490 Z"');
});
