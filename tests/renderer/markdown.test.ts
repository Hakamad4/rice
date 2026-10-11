// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const doc = (globalThis as any).document;
let render: (text: string, doc: unknown) => unknown;

beforeAll(() => {
  const src = readFileSync('src/renderer/markdown.js', 'utf8');
  new Function(src)();
  render = (globalThis as any).RiceMarkdown.renderMarkdown;
});

function html(text: string): any {
  const div = doc.createElement('div');
  div.append(render(text, doc));
  return div;
}

describe('renderMarkdown', () => {
  it('renders headings and paragraphs with line breaks', () => {
    const el = html('# T\n\n## Resumo\n### Sub\nlinha 1\nlinha 2');
    expect(el.querySelector('h1')?.textContent).toBe('T');
    expect(el.querySelector('h2')?.textContent).toBe('Resumo');
    expect(el.querySelector('h3')?.textContent).toBe('Sub');
    expect(el.querySelector('p')?.innerHTML).toBe('linha 1<br>linha 2');
  });

  it('renders unordered, ordered and task lists', () => {
    const el = html('- a\n* b\n\n1. um\n2. dois\n\n- [ ] pendente\n- [x] feito');
    expect(el.querySelectorAll('ul')).toHaveLength(2);
    expect(el.querySelectorAll('ol li')).toHaveLength(2);
    const boxes = el.querySelectorAll('input[type=checkbox]') as any[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    expect(boxes[0].disabled).toBe(true);
    expect(el.querySelectorAll('li')[5].textContent).toBe('feito');
  });

  it('renders bold, italic and code inline', () => {
    const el = html('a **negrito com *itálico*** e `x*y*` fim');
    expect(el.querySelector('strong')?.textContent).toBe('negrito com itálico');
    expect(el.querySelector('strong em')?.textContent).toBe('itálico');
    expect(el.querySelector('code')?.textContent).toBe('x*y*');
  });

  it('never creates elements from injected HTML', () => {
    const el = html('<img src=x onerror=alert(1)>\n\n- <script>alert(1)</script>\n\n**<b>x</b>**');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('marcador das anotações do usuário', () => {
  it('o texto do usuário vira .from-user e a expansão da IA .ai-exp, sem mostrar o marcador', () => {
    const box = html('- <!--u:2-->confirmar orçamento<!--/u--> o time vai revisar o valor até sexta, com **aprovação** do financeiro');
    const li = box.querySelector('li');
    expect(li.querySelector('.from-user').textContent).toBe('confirmar orçamento');
    expect(li.querySelector('.ai-exp').textContent).toContain('o time vai revisar');
    expect(li.querySelector('.ai-exp strong').textContent).toBe('aprovação');
    expect(box.textContent).not.toContain('<!--');
    expect(box.textContent).not.toContain('u:2');
  });

  it('sem expansão, só o texto do usuário; notas comuns não mudam', () => {
    expect(html('<!--u:1-->só isso<!--/u-->').querySelector('.ai-exp')).toBeNull();
    expect(html('- item comum').querySelector('.from-user')).toBeNull();
  });
});
