// @vitest-environment happy-dom
// Editor de template (notas e ideias): rótulo acima de cada campo, nota antes do primeiro campo e rodapé com hairline.
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const doc = g.document;
const css = [...rendered('src/renderer/index.html').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const cs = (node: any) => g.getComputedStyle(node);
const px = (v: string) => parseFloat(v) || 0;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.append(style);
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'template-preview', 'template-picker', 'templates', 'chips', 'idea-templates']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const builtin = { id: 'reuniao-geral', title: 'Reunião geral', description: 'Geral', icon: 'file-text', builtin: true, customized: false, sections: [{ heading: 'Resumo', description: 'r' }] };
const ideaTpl = { id: 'perguntas', title: 'Perguntas para fazer agora', description: 'Dúvidas', icon: 'lightbulb', builtin: true, customized: false, instruction: 'Sugira perguntas.', categories: ['Cliente', 'Risco'] };
let rice: Record<string, any>;
beforeEach(() => {
  doc.body.innerHTML = '';
  rice = {
    listTemplates: vi.fn(async () => ({ templates: [builtin], defaultId: 'reuniao-geral', warnings: [] })),
    listIdeaTemplates: vi.fn(async () => ({ templates: [ideaTpl], defaultId: 'perguntas', warnings: [] })),
  };
  g.window.rice = rice;
});
const mountBox = () => {
  const box = doc.createElement('div');
  box.className = 'page';
  const detail = doc.createElement('div');
  detail.id = 'detail';
  detail.append(box);
  doc.body.append(detail);
  return box;
};
const labels = (box: any) => [...box.querySelectorAll('.tpl-form .tpl-label')].map((l: any) => l.textContent);

describe('editor de template: formulário com rótulos', () => {
  it('notas: Nome, Descrição, Seções (rótulo 12px/500 muted, 6px até o campo); nota "Ao salvar…" 12px com 8px abaixo', async () => {
    const box = mountBox();
    await g.window.RiceTemplates.render(box, { confirm: vi.fn(), tab: 'notes' });
    await flush();
    (box.querySelector('.tpl-new') as any).click();
    await flush();
    expect(labels(box)).toEqual(['Nome', 'Descrição', 'Seções']);
    const label = box.querySelector('.tpl-label') as any;
    expect(cs(label).fontSize).toBe('12px');
    expect(cs(label).fontWeight).toBe('500');
    expect(cs(label).color).toBeTruthy();
    // o rótulo aponta para o campo (acessível)
    const name = box.querySelector('.tpl-title-input') as any;
    expect(label.htmlFor).toBe(name.id);
    // nota da versão: 12px e 8px antes do primeiro campo
    box.innerHTML = '';
    rice.listTemplates = vi.fn(async () => ({ templates: [builtin], defaultId: 'reuniao-geral', warnings: [] }));
    await g.window.RiceTemplates.render(box, { confirm: vi.fn(), tab: 'notes' });
    await flush();
    const edit = [...box.querySelectorAll('button')].find((b: any) => b.textContent === 'Editar') as any;
    edit.click();
    await flush();
    const note = box.querySelector('.tpl-edit-note') as any;
    expect(note.textContent).toBe('Ao salvar, a sua versão passa a valer no lugar do template embutido.');
    expect(cs(note).fontSize).toBe('12px');
    expect(px(cs(note).marginBottom)).toBe(8);
    expect(box.querySelector('.tpl-form').firstElementChild).toBe(note); // antes do primeiro campo
  });

  it('nome: input normal de 15px (600), não um título sem caixa', async () => {
    const box = mountBox();
    await g.window.RiceTemplates.render(box, { confirm: vi.fn(), tab: 'notes' });
    await flush();
    (box.querySelector('.tpl-new') as any).click();
    await flush();
    const name = box.querySelector('.tpl-title-input') as any;
    expect(name.tagName).toBe('INPUT');
    expect(cs(name).fontSize).toBe('15px');
    expect(cs(name).fontWeight).toBe('600');
  });

  it('rodapé: hairline e 24px acima das ações; Restaurar padrão à direita', async () => {
    const box = mountBox();
    rice.listTemplates = vi.fn(async () => ({ templates: [{ ...builtin, customized: true }], defaultId: 'reuniao-geral', warnings: [] }));
    await g.window.RiceTemplates.render(box, { confirm: vi.fn(), tab: 'notes' });
    await flush();
    [...box.querySelectorAll('button')].find((b: any) => b.textContent === 'Editar')!.click();
    await flush();
    const footer = box.querySelector('.tpl-footer') as any;
    expect(footer.textContent).toContain('Restaurar padrão');
    expect(px(cs(footer).marginTop)).toBe(24);
    expect(cs(footer).borderTopWidth).toBe('1px');
    expect(footer.querySelector('.tpl-restore')).not.toBeNull();
    expect([...footer.querySelectorAll('button')].map((b: any) => b.textContent)).toEqual(['Salvar', 'Cancelar', 'Restaurar padrão']);
  });

  it('ideias: Nome, Descrição, Instrução e Categorias, com a mesma forma; a instrução e as categorias têm a sua ajuda embaixo', async () => {
    const box = mountBox();
    await g.window.RiceIdeaTemplates.render(box, { confirm: vi.fn(), tab: 'ideas' });
    await flush();
    [...box.querySelectorAll('button')].find((b: any) => b.textContent === 'Editar')!.click();
    await flush();
    expect(labels(box)).toEqual(['Nome', 'Descrição', 'Instrução', 'Categorias']);
    const hints = [...box.querySelectorAll('.tpl-field-hint')].map((h: any) => h.textContent);
    expect(hints.length).toBe(2);
    expect(box.querySelector('.tpl-form textarea.itpl-instruction')).not.toBeNull();
    expect(box.querySelector('.tpl-footer')).not.toBeNull();
    expect(px(cs(box.querySelector('.tpl-footer')).marginTop)).toBe(24);
  });
});

it('espaçamento do formulário nas regras: 20px entre campos, 6px rótulo→campo, 24px no rodapé', () => {
  expect(css).toMatch(/\.tpl-form \{ display:flex; flex-direction:column; gap:20px; \}/);
  expect(css).toMatch(/\.tpl-field \{ display:flex; flex-direction:column; gap:6px;/);
  expect(css).toMatch(/\.tpl-footer \{[^}]*margin-top:24px/);
});
