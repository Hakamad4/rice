// @vitest-environment happy-dom
// Prévia de template (seletor de Ideias e de Notas): espaçamentos e tipografia medidos no CSS computado.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const doc = g.document;
const css = [...rendered('src/renderer/index.html').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

beforeAll(() => {
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.append(style);
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'template-preview']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const mountPreview = (template: any, options?: any) => {
  const host = doc.createElement('div');
  host.className = 'tpl-popover-preview';
  host.append(g.window.RiceTemplatePreview.render(template, options));
  doc.body.append(host);
  return host.firstElementChild as any;
};
const cs = (node: any) => g.getComputedStyle(node);
const px = (v: string) => parseFloat(v) || 0;
const ideas = {
  title: 'Retro', icon: 'lightbulb', description: 'Para revisar a semana.',
  instruction: 'Proponha melhorias concretas.', categories: ['Processo', 'Pessoas', 'Produto'],
};
const notes = {
  title: 'Reunião geral', icon: 'file-text', description: 'Resumo da reunião.',
  sections: [{ heading: 'Resumo', description: 'O que foi dito.' }, { heading: 'Decisões', description: 'O que ficou decidido.' }],
};

describe('prévia de template: espaçamento e rótulos', () => {
  it('ideias: padding 16px, título 15px/600 com 6px até a descrição, descrição 13px muted 1.5', () => {
    const p = mountPreview(ideas, { kind: 'ideas' });
    expect(px(cs(p).paddingTop)).toBe(16);
    expect(px(cs(p).paddingLeft)).toBe(16);
    const title = p.querySelector('.tpl-preview-title');
    expect(cs(title).fontSize).toBe('15px');
    expect(cs(title).fontWeight).toBe('600');
    expect(px(cs(title).marginBottom)).toBe(6);
    const desc = p.querySelector('.tpl-preview-desc');
    expect(cs(desc).fontSize).toBe('13px');
    expect(cs(desc).lineHeight).toBe('1.5');
  });

  it('ideias: rótulos de bloco 11px/600 maiúsculos com 16px antes e 6px até o conteúdo; sem "(opcional)" na prévia', () => {
    const p = mountPreview(ideas, { kind: 'ideas' });
    const [instr, cats] = [...p.querySelectorAll('.tpl-preview-heading')] as any[];
    expect(instr.textContent).toBe('Instrução');
    expect(cats.textContent).toBe('Categorias'); // sem "(opcional)": é informação de editor
    for (const h of [instr, cats]) {
      expect(cs(h).fontSize).toBe('11px');
      expect(cs(h).fontWeight).toBe('600');
      expect(cs(h).textTransform).toBe('uppercase');
      expect(cs(h).letterSpacing).toBe('0.66px'); // .06em de 11px
      expect(px(cs(h).marginTop)).toBe(16);
    }
    expect(px(cs(p.querySelector('.tpl-preview-section-desc')).marginTop)).toBe(6);
    expect(px(cs(p.querySelector('.tpl-chips')).marginTop)).toBe(6);
  });

  it('ideias: chips de categoria com gap 6px e padding 4px 10px', () => {
    const p = mountPreview(ideas, { kind: 'ideas' });
    const chips = p.querySelector('.tpl-chips') as any;
    expect(css).toMatch(/\.tpl-chips \{ display:flex; flex-wrap:wrap; gap:6px; \}/); // happy-dom não expõe o shorthand gap: medimos na regra
    const chip = chips.querySelector('.tpl-sec-chip') as any;
    expect(cs(chip).paddingTop).toBe('4px');
    expect(cs(chip).paddingLeft).toBe('10px');
  });

  it('notas: as seções seguem o mesmo espaçamento (16px entre blocos, 6px do rótulo ao texto)', () => {
    const p = mountPreview(notes);
    const heads = [...p.querySelectorAll('.tpl-preview-heading')] as any[];
    expect(heads.map((h) => h.textContent)).toEqual(['Resumo', 'Decisões']);
    for (const h of heads) expect(px(cs(h).marginTop)).toBe(16);
    expect(px(cs(p.querySelector('.tpl-preview-section-desc')).marginTop)).toBe(6);
  });
});
