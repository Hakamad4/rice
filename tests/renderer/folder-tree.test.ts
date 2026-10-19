// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const now = new Date().toISOString();
const F = (id: string, name: string, order: number, parentId?: string) => ({ id, name, createdAt: '', order, ...(parentId ? { parentId } : {}) });
const FOLDERS = [F('f1', 'Clientes', 0), F('f2', 'Acme', 0, 'f1'), F('f3', 'Contratos', 0, 'f2'), F('f4', 'Time', 1), F('f5', 'Vazia', 1, 'f1')];
const M = (dir: string, title: string, folderId?: string) => ({ dir, title, startedAt: now, state: 'done', notesStatus: 'done', ...(folderId ? { folderId } : {}) });
const MEETINGS = [M('/R/1', 'Kickoff', 'f2'), M('/R/2', 'Geral Clientes', 'f1'), M('/R/3', 'Contrato final', 'f3'), M('/R/4', 'Avulsa')];

function boot(folders = FOLDERS, extra: Record<string, unknown> = {}) {
  const api = {
    listFolders: vi.fn(async () => folders),
    createFolder: vi.fn(async (name: string) => ({ ok: true, value: { id: 'novo', name } })),
    moveFolder: vi.fn(async () => ({ ok: true, value: {} })),
    reorderFolders: vi.fn(async () => ({ ok: true, value: [] })),
    deleteFolder: vi.fn(async () => ({ ok: true, value: undefined })),
    renameFolder: vi.fn(async () => ({ ok: true, value: {} })),
    setMeetingFolder: vi.fn(async () => ({ ok: true })),
    ...extra,
  };
  bootRenderer(api, MEETINGS);
  return api;
}
const ready = () => vi.waitFor(() => expect(g.document.querySelector('.folder-row')).not.toBeNull());
const rowOf = (name: string) => [...g.document.querySelectorAll('.folder-row')].find((r: any) => r.querySelector('.folder-name')?.textContent === name) as any;
const names = (root: any) => [...root.querySelectorAll(':scope > .folder-block > .folder-row .folder-name')].map((n: any) => n.textContent);

it('árvore: subpastas dentro das pastas, contagem com tudo que está dentro, pasta sem filhos sem chevron, reuniões com ponto', async () => {
  boot();
  await ready();
  const top = [...g.document.querySelectorAll('#folders > .folder-block')] as any[];
  expect(top.map((b) => b.querySelector('.folder-name').textContent)).toEqual(['Clientes', 'Time']);
  const clientes = top[0];
  expect(names(clientes.querySelector(':scope > .folder-children'))).toEqual(['Acme', 'Vazia']);
  const acme = clientes.querySelector(':scope > .folder-children > .folder-block');
  expect(names(acme.querySelector(':scope > .folder-children'))).toEqual(['Contratos']);
  // contagem total (inclui descendentes): Clientes = Geral + Kickoff + Contrato final
  expect(rowOf('Clientes').querySelector('.folder-count').textContent).toBe('3');
  expect(rowOf('Acme').querySelector('.folder-count').textContent).toBe('2');
  expect(rowOf('Vazia').querySelector('.folder-count').textContent).toBe('0');
  // chevron só em quem tem filhos (subpastas ou reuniões)
  expect(rowOf('Clientes').classList.contains('leaf')).toBe(false);
  expect(rowOf('Vazia').classList.contains('leaf')).toBe(true);
  expect(rowOf('Time').classList.contains('leaf')).toBe(true);
  // reuniões na árvore ganham o ponto; a lista por data não ganha nada de árvore
  const inTree = [...g.document.querySelectorAll('.folder-children .meeting')] as any[];
  expect(inTree.length).toBe(3);
  expect(inTree.every((m) => m.classList.contains('in-tree') && m.querySelector('.tree-dot'))).toBe(true);
  const dated = g.document.querySelector('#list .meeting');
  expect(dated.querySelector('.m-title').textContent).toBe('Avulsa');
  expect(dated.classList.contains('in-tree')).toBe(false);
  expect(dated.querySelector('.tree-dot')).toBeNull();
  expect(g.document.querySelector('#list .folder-children')).toBeNull();
});

it('recolher esconde a subárvore inteira (sem linhas penduradas) e lembra por pasta', async () => {
  boot();
  await ready();
  rowOf('Acme').querySelector('.folder-toggle').click();
  await vi.waitFor(() => expect(g.document.querySelector('.folder-block.collapsed')).not.toBeNull());
  expect(rowOf('Contratos')).toBeUndefined();
  expect(JSON.parse(g.localStorage.getItem('rice.folderCollapsed'))).toEqual({ f2: true });
  const acme = rowOf('Acme').parentElement;
  expect(acme.querySelector('.folder-children')).toBeNull(); // nada de contêiner vazio que desenharia linha
  expect(rowOf('Acme').querySelector('.folder-toggle').getAttribute('aria-expanded')).toBe('false');
  expect(rowOf('Acme').querySelector('.folder-toggle .icon-chevron-right')).not.toBeNull();
  rowOf('Acme').querySelector('.folder-toggle').click();
  await vi.waitFor(() => expect(rowOf('Contratos')).toBeDefined());
  expect(JSON.parse(g.localStorage.getItem('rice.folderCollapsed'))).toEqual({});
});

it('⋯ da pasta: Nova subpasta pede o nome e cria dentro dela', async () => {
  const api = boot();
  await ready();
  rowOf('Clientes').querySelector('.f-more').click();
  const items = [...g.document.querySelectorAll('.action-item')] as any[];
  expect(items.map((i) => i.textContent.trim())).toEqual(['Renomear', 'Nova reunião nesta pasta', 'Nova subpasta', 'Mover para', 'Pasta sensível', 'Tempo de guarda…', 'Apagar pasta']);
  items[2].click();
  const dialog = g.document.querySelector('[role=dialog]');
  const input = dialog.querySelector('input');
  input.value = 'Beta';
  input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await vi.waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('Beta', 'f1'));
});

it('no 4º nível não há "Nova subpasta"', async () => {
  boot([F('a', 'A', 0), F('b', 'B', 0, 'a'), F('c', 'C', 0, 'b'), F('d', 'D', 0, 'c')]);
  await ready();
  rowOf('D').querySelector('.f-more').click();
  const sub = [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.trim() === 'Nova subpasta') as any;
  expect(sub.classList.contains('disabled')).toBe(true);
  expect(sub.title).toBe('As pastas podem ter até 4 níveis.');
});

it('Mover para ▸: árvore indentada; a própria pasta e as de dentro ficam desabilitadas; escolher chama moveFolder', async () => {
  const api = boot();
  await ready();
  rowOf('Acme').querySelector('.f-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.trim() === 'Mover para').click();
  const sub = [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
  expect(sub.map((i) => i.textContent.trim())).toEqual(['Nível principal', 'Clientes', 'Acme', 'Contratos', 'Vazia', 'Time']);
  expect(sub.map((i) => i.style.paddingLeft)).toEqual(['', '24px', '38px', '52px', '38px', '24px']);
  expect(sub.map((i) => i.classList.contains('disabled'))).toEqual([false, false, true, true, false, false]);
  expect(sub[1].getAttribute('aria-checked')).toBe('true'); // Clientes é o pai atual
  sub[5].click(); // Time
  await vi.waitFor(() => expect(api.moveFolder).toHaveBeenCalledWith('f2', 'f4'));
});

it('Mover para ▸ com subárvore alta desabilita destinos que passariam de 4 níveis', async () => {
  boot([F('a', 'A', 0), F('b', 'B', 0, 'a'), F('x', 'X', 1), F('y', 'Y', 0, 'x'), F('z', 'Z', 0, 'y')]);
  await ready();
  rowOf('A').querySelector('.f-more').click(); // A > B (altura 2)
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.trim() === 'Mover para').click();
  const sub = [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
  const byName = (n: string) => sub.find((i) => i.textContent.trim() === n);
  expect(byName('Z').classList.contains('disabled')).toBe(true); // profundidade 3 + altura 2 = 5
  expect(byName('Y').classList.contains('disabled')).toBe(false); // 2 + 2 = 4
});

it('Mover reunião para pasta: a lista é a árvore indentada', async () => {
  boot();
  await ready();
  g.document.querySelector('#list .meeting .m-more').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.trim() === 'Mover para pasta').click();
  const sub = [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
  expect(sub.slice(0, 6).map((i) => `${i.textContent.trim()}:${i.style.paddingLeft}`)).toEqual(['Clientes:', 'Acme:24px', 'Contratos:38px', 'Vazia:24px', 'Time:', 'Nova pasta…:']);
});

function drag(target: any, data: Record<string, string>, type: 'dragover' | 'drop', y = 15) {
  target.getBoundingClientRect = () => ({ top: 0, height: 30, left: 0, right: 200, bottom: 30, width: 200 });
  const e: any = new g.window.Event(type, { bubbles: true, cancelable: true });
  e.clientY = y;
  e.dataTransfer = { types: Object.keys(data), getData: (k: string) => data[k] ?? '' };
  target.dispatchEvent(e);
  return e;
}
const start = (row: any) => {
  const e: any = new g.window.Event('dragstart', { bubbles: true });
  e.dataTransfer = { setData() {}, effectAllowed: '' };
  row.dispatchEvent(e);
};
const FOLDER = 'application/x-rice-folder';

it('arrastar pasta sobre pasta: meio = mover para dentro (destaque); borda = reordenar (linha fina)', async () => {
  const api = boot();
  await ready();
  start(rowOf('Time'));
  const target = rowOf('Clientes');
  drag(target, { [FOLDER]: 'f4' }, 'dragover', 15);
  expect(target.classList.contains('drop-target')).toBe(true);
  drag(target, { [FOLDER]: 'f4' }, 'dragover', 3);
  expect(target.classList.contains('drop-before')).toBe(true);
  expect(target.classList.contains('drop-target')).toBe(false);
  drag(target, { [FOLDER]: 'f4' }, 'dragover', 27);
  expect(target.classList.contains('drop-after')).toBe(true);

  drag(target, { [FOLDER]: 'f4' }, 'drop', 15); // meio: dentro
  await vi.waitFor(() => expect(api.moveFolder).toHaveBeenCalledWith('f4', 'f1'));
  expect(api.reorderFolders).not.toHaveBeenCalled();
  expect(target.classList.contains('drop-target')).toBe(false);
});

it('soltar na borda entre irmãs da raiz só reordena; entre irmãs de outro pai muda o pai e depois ordena', async () => {
  const api = boot();
  await ready();
  start(rowOf('Time'));
  drag(rowOf('Clientes'), { [FOLDER]: 'f4' }, 'drop', 2); // antes de Clientes (raiz → raiz)
  await vi.waitFor(() => expect(api.reorderFolders).toHaveBeenCalledWith(['f4', 'f1']));
  expect(api.moveFolder).not.toHaveBeenCalled();

  api.reorderFolders.mockClear();
  start(rowOf('Time'));
  drag(rowOf('Vazia'), { [FOLDER]: 'f4' }, 'drop', 28); // depois de Vazia (irmã de Acme, dentro de Clientes)
  await vi.waitFor(() => expect(api.moveFolder).toHaveBeenCalledWith('f4', 'f1'));
  await vi.waitFor(() => expect(api.reorderFolders).toHaveBeenCalledWith(['f2', 'f5', 'f4']));
});

it('pasta não aceita ser solta sobre si mesma nem sobre uma descendente', async () => {
  boot();
  await ready();
  start(rowOf('Clientes'));
  expect(drag(rowOf('Acme'), { [FOLDER]: 'f1' }, 'dragover').defaultPrevented).toBe(false);
  expect(drag(rowOf('Contratos'), { [FOLDER]: 'f1' }, 'dragover').defaultPrevented).toBe(false);
  expect(drag(rowOf('Clientes'), { [FOLDER]: 'f1' }, 'dragover').defaultPrevented).toBe(false);
  expect(drag(rowOf('Time'), { [FOLDER]: 'f1' }, 'dragover').defaultPrevented).toBe(true);
});

it('soltar uma pasta fora de qualquer pasta (área abaixo) leva ao nível principal', async () => {
  const api = boot();
  await ready();
  start(rowOf('Acme'));
  const list = g.document.getElementById('list');
  expect(drag(list, { [FOLDER]: 'f2' }, 'dragover').defaultPrevented).toBe(true);
  drag(list, { [FOLDER]: 'f2' }, 'drop');
  await vi.waitFor(() => expect(api.moveFolder).toHaveBeenCalledWith('f2', null));
});

it('erro do main ao mover (ciclo, nível, nome) aparece como aviso', async () => {
  boot(FOLDERS, { moveFolder: vi.fn(async () => ({ ok: false, message: 'As pastas podem ter até 4 níveis.' })) });
  await ready();
  start(rowOf('Time'));
  drag(rowOf('Clientes'), { [FOLDER]: 'f4' }, 'drop', 15);
  await vi.waitFor(() => expect(g.document.getElementById('status').textContent).toContain('até 4 níveis'));
});

it('apagar pasta com filhos: a confirmação diz quantas subpastas e reuniões sobem e para onde', async () => {
  const api = boot();
  await ready();
  const ask = async (name: string) => {
    rowOf(name).querySelector('.f-more').click();
    [...g.document.querySelectorAll('.action-item')].find((i: any) => i.classList.contains('danger')).click();
    return g.document.querySelector('[role=dialog]') as any;
  };
  let dialog = await ask('Acme'); // 1 subpasta (Contratos) + 1 reunião direta (Kickoff), pai Clientes
  expect(dialog.textContent).toContain('Apagar a pasta “Acme”?');
  expect(dialog.textContent).toContain('1 subpasta · 1 reunião');
  expect(dialog.textContent).toContain('passa para “Clientes”');
  expect(dialog.textContent).toContain('nada é apagado');
  [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Cancelar').click();

  dialog = await ask('Clientes'); // raiz: 2 subpastas... (Acme, Contratos, Vazia = 3) + 1 reunião
  expect(dialog.textContent).toContain('3 subpastas · 1 reunião');
  expect(dialog.textContent).toContain('nível principal');
  [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Cancelar').click();

  dialog = await ask('Vazia');
  expect(dialog.textContent).toContain('Ela está vazia');
  [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Apagar pasta').click();
  await vi.waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('f5'));

  dialog = await ask('Time'); // raiz sem filhos: texto antigo
  expect(dialog.textContent).toContain('voltam para a lista sem pasta');
});

it('a busca (sem índice) mostra o caminho da pasta e só os ramos com resultado', async () => {
  boot();
  await ready();
  const input = g.document.getElementById('search');
  input.value = 'contrato final';
  input.dispatchEvent(new g.window.Event('input'));
  // não há rice.search no mock? há (undefined): cai no filtro local por título/pasta
  await vi.waitFor(() => expect(g.document.querySelectorAll('.folder-row').length).toBe(3)); // Clientes > Acme > Contratos
  expect(names(g.document.querySelector('#folders'))).toEqual(['Clientes']);
});

it('o chip do chat lista as pastas em árvore e mostra o caminho', async () => {
  boot();
  await ready();
  g.document.getElementById('scope-chip').click();
  const items = [...g.document.querySelectorAll('.action-item')] as any[];
  expect(items.map((i) => `${i.textContent.trim()}:${i.style.paddingLeft}`)).toEqual(['Esta reunião:', 'Todas as reuniões:', 'Clientes:', 'Acme:24px', 'Contratos:38px', 'Vazia:24px', 'Time:']);
  items[4].click();
  expect(g.document.getElementById('scope-label').textContent).toBe('Pasta: Clientes / Acme / Contratos');
});

it('CSS da árvore: 14px por nível, linha de 1px, canto arredondado de 4px no último filho, conector curto, ponto de 4px; sem caracteres de desenho', () => {
  const html = rendered('src/renderer/index.html');
  const js = readFileSync('src/renderer/renderer.js', 'utf8');
  expect(html).toMatch(/\.folder-children \{ margin:0 0 2px 14px; \}/);
  expect(html).toMatch(/\.folder-children > :last-child::before \{[^}]*border-bottom-left-radius:4px/);
  // a linha é feita só de bordas de 1px (espessura e cor iguais em qualquer zoom; fundo de 1px borra com zoom fracionário)
  const guideRules = html.split('\n').filter((l) => /^\s*\.folder-children >.*::(before|after)/.test(l));
  expect(guideRules.length).toBeGreaterThan(3);
  expect(guideRules.join('\n')).not.toMatch(/background:/);
  expect(html).toMatch(/\.folder-children > \.folder-block::before[^{]*\{[^}]*border-left:1px solid var\(--guide\)/);
  expect(html).toMatch(/\.folder-children > \.folder-block::after[^{]*\{[^}]*border-top:1px solid var\(--guide\)/);
  // o hover da reunião começa depois do conector
  expect(html).toMatch(/\.folder-children > \.meeting \{[^}]*margin-left:12px/);
  expect(html).toMatch(/--branch:8px/);
  expect(html).toMatch(/\.tree-dot \{[^}]*width:4px; height:4px/);
  expect(html).not.toMatch(/[├└│─┬]/);
  expect(js).not.toMatch(/[├└│─┬]/);
  // a lista por data não entra nas regras da árvore
  expect(html).not.toMatch(/#list[^{]*::before/);
});
