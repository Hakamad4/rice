// @vitest-environment happy-dom
// Anotações da reunião: leitura em Markdown, edição no mesmo lugar, auto-altura, atalhos de lista e "Salvo".
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const doc = g.document;
const css = [...rendered('src/renderer/index.html').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const cs = (node: any) => g.getComputedStyle(node);
const px = (v: string) => parseFloat(v) || 0;

beforeAll(() => {
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.append(style);
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

let box: any;
let onChange: ReturnType<typeof vi.fn>;
let ann: any;
beforeEach(() => {
  doc.body.innerHTML = '';
  box = doc.createElement('div');
  doc.body.append(box);
  onChange = vi.fn();
  ann = g.window.RiceAnnotations.create({ value: '', onChange });
  box.append(ann.heading, ann.body);
});
const area = () => box.querySelector('textarea.anot-edit') as any;
const key = (node: any, k: string, init: Record<string, unknown> = {}) => {
  const e = new g.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(e);
  return e;
};
/** Digita: põe o texto e o cursor, como o usuário faria. */
const typeAt = (text: string, caret = text.length) => {
  const a = area();
  a.value = text;
  a.setSelectionRange(caret, caret);
  a.dispatchEvent(new g.window.Event('input', { bubbles: true }));
};

describe('leitura', () => {
  it('Markdown renderizado: "##" vira título de peso 600 no MESMO tamanho do corpo; listas e checkboxes normais', () => {
    ann.value = '## Ideias da reunião\n\n- Falar com o cliente\n- [x] Enviar proposta';
    expect(box.querySelector('.anot-read h2').textContent).toBe('Ideias da reunião');
    expect(box.querySelectorAll('.anot-read li')).toHaveLength(2);
    expect(box.querySelector('.anot-read li.task input[type=checkbox]')).not.toBeNull();
    const h = cs(box.querySelector('.anot-read h2'));
    const body = cs(box.querySelector('.anot-read'));
    expect(h.fontSize).toBe(body.fontSize);
    expect(h.fontWeight).toBe('600');
  });

  it('vazio: linha clicável "Escreva suas anotações… (salvas automaticamente)"', () => {
    expect(box.querySelector('.anot-empty').textContent).toBe('Escreva suas anotações… (salvas automaticamente)');
  });

  it('clicar no texto entra em edição no mesmo lugar, e o texto não muda de tamanho nem de lugar', () => {
    ann.value = 'Primeira linha\n\nSegunda';
    const read = box.querySelector('.anot-read') as any;
    const before = { fs: cs(read).fontSize, lh: cs(read).lineHeight, x: px(cs(read).paddingLeft) + px(cs(read).marginLeft), y: px(cs(read).paddingTop) + px(cs(read).marginTop) };
    read.click();
    const a = area();
    expect(a).not.toBeNull();
    const after = cs(a);
    expect(after.fontSize).toBe(before.fs);
    expect(after.lineHeight).toBe(before.lh);
    expect(px(after.paddingLeft) + px(after.marginLeft)).toBe(before.x);
    expect(px(after.paddingTop) + px(after.marginTop)).toBe(before.y);
    expect(after.borderTopWidth).toBe('0px');
    expect(a.value).toBe('Primeira linha\n\nSegunda');
  });

  it('auto-altura pelo conteúdo, sem rolagem interna; mínimo de 3 linhas', () => {
    ann.value = '';
    box.querySelector('.anot-empty').click();
    expect(area().getAttribute('rows')).toBe('3');
    expect(area().style.height).not.toBe('');
    expect(cs(area()).overflowY === 'hidden' || cs(area()).overflow === 'hidden').toBe(true);
    expect(css).toMatch(/textarea\.anot-edit \{[^}]*min-height:calc\(1\.6em \* 3 \+ 16px\)/);
  });

  it('Esc e perder o foco voltam à leitura', () => {
    ann.value = 'Nota';
    box.querySelector('.anot-read').click();
    key(area(), 'Escape');
    expect(area()).toBeNull();
    expect(box.querySelector('.anot-read')).not.toBeNull();
    box.querySelector('.anot-read').click();
    area().dispatchEvent(new g.window.FocusEvent('blur'));
    expect(area()).toBeNull();
  });
});

describe('atalhos de lista', () => {
  beforeEach(() => {
    ann.value = '';
    box.querySelector('.anot-empty').click();
  });
  it('Enter numa lista "- " continua com "- "', () => {
    typeAt('- Falar com o cliente');
    const e = key(area(), 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(area().value).toBe('- Falar com o cliente\n- ');
    expect(area().selectionStart).toBe(area().value.length);
  });
  it('Enter numa tarefa "- [ ] " continua com "- [ ] "', () => {
    typeAt('- [ ] Enviar proposta');
    key(area(), 'Enter');
    expect(area().value).toBe('- [ ] Enviar proposta\n- [ ] ');
  });
  it('lista numerada incrementa o número', () => {
    typeAt('1. Primeiro');
    key(area(), 'Enter');
    expect(area().value).toBe('1. Primeiro\n2. ');
  });
  it('Enter em item vazio sai da lista (apaga o marcador)', () => {
    typeAt('- um\n- ');
    key(area(), 'Enter');
    expect(area().value).toBe('- um\n');
  });
  it('Tab indenta a linha e Shift+Tab desfaz', () => {
    typeAt('- item');
    key(area(), 'Tab');
    expect(area().value).toBe('  - item');
    key(area(), 'Tab', { shiftKey: true });
    expect(area().value).toBe('- item');
  });
  it('Enter comum (fora de lista) não mexe no texto', () => {
    typeAt('linha comum');
    const e = key(area(), 'Enter');
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('salvar e "Salvo"', () => {
  it('cada alteração chama onChange com o texto; markSaved mostra "Salvo" discreto ao lado do título', () => {
    ann.value = '';
    box.querySelector('.anot-empty').click();
    typeAt('oi');
    expect(onChange).toHaveBeenLastCalledWith('oi');
    const saved = box.querySelector('.anot-saved') as any;
    expect(saved.hidden).toBe(true);
    ann.markSaved();
    expect(saved.hidden).toBe(false);
    expect(saved.textContent).toBe('Salvo');
    expect(box.querySelector('.anot-head h2').textContent).toBe('Suas anotações');
  });
});

describe('reunião: salvar continua o mesmo IPC', () => {
  it('digitar nas Anotações chama saveAnnotations(dir, texto) depois do intervalo', async () => {
    const saveAnnotations = vi.fn(async () => ({ ok: true }));
    const meeting = { dir: '/R/a', title: 'Daily', startedAt: new Date().toISOString(), state: 'recording' };
    bootRenderer({ saveAnnotations }, [meeting]);
    await vi.waitFor(() => expect(doc.querySelector('.meeting')).not.toBeNull());
    doc.querySelector('.meeting').click();
    await vi.waitFor(() => expect(doc.querySelector('.anot-empty')).not.toBeNull());
    (doc.querySelector('.anot-empty') as any).click();
    const a = doc.querySelector('textarea.anot-edit') as any;
    a.value = '- Pauta';
    a.dispatchEvent(new g.window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(saveAnnotations).toHaveBeenCalledWith('/R/a', '- Pauta'), { timeout: 2000 });
  });
});
