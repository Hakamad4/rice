// @vitest-environment happy-dom
// Edição no lugar: o campo em edição tem o MESMO corpo (tamanho, peso, altura de linha, espaçamento) do modo leitura,
// e, onde o texto fica no mesmo lugar, o mesmo x/y (padding + margem + borda compensados).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const doc = g.document;

const css = [...rendered('src/renderer/index.html').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const style = doc.createElement('style');
// happy-dom não resolve clamp(…cqi): fixa o tamanho do título só para medir (no app o clamp vale como está)
style.textContent = css.replaceAll('clamp(22px, 5cqi, 30px)', '20px'); // happy-dom não calcula clamp(): o título fixa em 20px, igual nos dois modos
doc.head.append(style);

const cases = [
  { name: 'título da reunião', read: '<div class="title-row"><h1 class="page-title">Reunião</h1></div>', edit: '<div class="title-row"><input class="page-title title-edit" value="Reunião"></div>', readSel: 'h1', editSel: 'input', position: true },
  { name: 'renomear reunião na lista', read: '<div class="meeting"><span class="m-title">Reunião</span></div>', edit: '<div class="meeting"><input class="title-edit" value="Reunião"></div>', readSel: '.m-title', editSel: 'input', position: true },
  { name: 'renomear pasta', read: '<div class="folder-row"><span class="folder-name">Clientes</span></div>', edit: '<div class="folder-row"><input class="title-edit" value="Clientes"></div>', readSel: '.folder-name', editSel: 'input', position: true },
  { name: 'criar pasta', read: '<div class="folder-row"><span class="folder-name">Clientes</span></div>', edit: '<div class="folder-row folder-new"><input class="title-edit" placeholder="Nova pasta"></div>', readSel: '.folder-name', editSel: 'input', position: true },
  { name: 'nome do falante', read: '<div class="t-row"><button class="t-who-btn">Pessoa 1</button></div>', edit: '<div class="speaker-pop"><div class="speaker-pop-row"><input value="Pessoa 1"></div></div>', readSel: '.t-who-btn', editSel: 'input', position: false },
  { name: 'vocabulário (termo digitado)', read: '<div class="chips"><span class="chip"><span class="chip-text">OKR</span></span></div>', edit: '<div class="chips"><input id="vocab-input"></div>', readSel: '.chip', editSel: 'input', position: false },
];

const mounted: any[] = [];
function mount(html: string): any {
  const host = doc.createElement('div');
  host.className = 'detail';
  host.innerHTML = html;
  doc.body.append(host);
  mounted.push(host);
  return host;
}
afterEach(() => {
  while (mounted.length) mounted.pop()!.remove();
});

const px = (v: string) => parseFloat(v) || 0;
function body(node: any) {
  const s = g.getComputedStyle(node);
  // 'normal' e 400 são o mesmo peso; espaçamento 'normal' vem como vazio em alguns casos
  return { fontSize: s.fontSize, fontWeight: s.fontWeight === 'normal' ? '400' : s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing || 'normal' };
}
/** Onde o texto começa dentro da caixa: padding + margem + borda (x e y). */
function origin(node: any) {
  const s = g.getComputedStyle(node);
  return { x: px(s.paddingLeft) + px(s.marginLeft) + px(s.borderLeftWidth), y: px(s.paddingTop) + px(s.marginTop) + px(s.borderTopWidth) };
}

describe('edição no lugar: mesmo corpo que o modo leitura', () => {
  for (const c of cases) {
    it(`${c.name}: tamanho, peso, altura de linha e espaçamento iguais${c.position ? ', e o texto no mesmo x/y' : ''}`, () => {
      const readHost = mount(c.read);
      const read = readHost.querySelector(c.readSel)!;
      const editHost = mount(c.edit);
      const edit = editHost.querySelector(c.editSel)!;
      expect(body(edit)).toEqual(body(read));
      if (c.position) expect(origin(edit)).toEqual(origin(read));
    });
  }
});
