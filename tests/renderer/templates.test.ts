// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

const g = globalThis as any;
beforeAll(() => {
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'template-preview', 'template-picker', 'templates']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const builtin = { id: 'reuniao-geral', title: 'Reunião geral', description: 'Geral', icon: 'file-text', builtin: true, sections: [{ heading: 'Resumo', description: 'r' }] };
const mine = { id: 'abc', title: 'Retro', description: 'Retrospectiva', icon: 'file-text', builtin: false, sections: [{ heading: 'Bom', description: 'b' }, { heading: 'Ruim', description: 'r' }] };

let rice: Record<string, any>;
beforeEach(() => {
  rice = {
    listTemplates: vi.fn(async () => ({ templates: [builtin, mine], defaultId: 'reuniao-geral', warnings: [] })),
    saveTemplate: vi.fn(async (t: any) => ({ ok: true, template: { ...t, id: t.id ?? 'novo', builtin: false } })),
    deleteTemplate: vi.fn(async () => ({ ok: true })),
    setDefaultTemplate: vi.fn(async () => ({ ok: true })),
  };
  g.window.rice = rice;
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const buttons = (box: any, text: string) => [...box.querySelectorAll('button')].filter((b: any) => b.textContent === text) as any[];

async function open(confirm = vi.fn(async () => true)) {
  const box = g.document.createElement('div');
  await g.window.RiceTemplates.render(box, { confirm, onError: vi.fn() });
  return { box, confirm };
}

it('moveSection troca com a vizinha e ignora limites', () => {
  const { moveSection } = g.window.RiceTemplates;
  const s = [{ heading: 'a' }, { heading: 'b' }, { heading: 'c' }];
  expect(moveSection(s, 1, -1).map((x: any) => x.heading)).toEqual(['b', 'a', 'c']);
  expect(moveSection(s, 1, 1).map((x: any) => x.heading)).toEqual(['a', 'c', 'b']);
  expect(moveSection(s, 0, -1)).toEqual(s);
  expect(moveSection(s, 2, 1)).toEqual(s);
});

it('lista embutidos e meus; marca o padrão; embutido não tem Apagar', async () => {
  const { box } = await open();
  const rows = [...box.querySelectorAll('.tpl-block')] as any[];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Reunião geral');
  expect(rows[0].querySelector('.tpl-badge').textContent).toBe('Padrão');
  const actions = (row: any) => [...row.querySelectorAll('.tpl-actions button')].map((b: any) => b.textContent);
  expect(actions(rows[0])).toEqual(['Editar', 'Duplicar']); // padrão: sem "Usar como padrão"; embutido: sem Apagar
  expect(actions(rows[1])).toEqual(['Editar', 'Duplicar', 'Usar como padrão', 'Apagar']); // Apagar por último
});

it('cada template é um bloco de 3 linhas: título inteiro, descrição completa e ações em linha própria', async () => {
  const long = { ...mine, title: 'Reunião com cliente / vendas — um título bem longo que não pode ser cortado', description: 'Conversa com cliente ou prospect, de descoberta, demonstração ou negociação, com bastante texto para ocupar a largura inteira.' };
  rice.listTemplates = vi.fn(async () => ({ templates: [builtin, long], defaultId: 'reuniao-geral', warnings: [] }));
  const { box } = await open();
  const blocks = [...box.querySelectorAll('.tpl-block')] as any[];
  for (const b of blocks) {
    expect([...b.children].map((c: any) => c.className)).toEqual(['tpl-symbol tpl-ico', 'tpl-line1', 'tpl-desc', 'tpl-actions']);
    expect(b.querySelector('.tpl-line1 .tpl-name').textContent.length).toBeGreaterThan(0);
    expect(b.querySelector('.tpl-actions').querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
    expect(b.querySelector('.tpl-line1 .tpl-actions, .tpl-desc .tpl-actions')).toBeNull(); // ações nunca dentro do texto
  }
  expect(blocks[1].querySelector('.tpl-name').textContent).toBe(long.title); // título inteiro, sem corte
  expect(blocks[1].querySelector('.tpl-desc').textContent).toBe(long.description);
  expect(blocks[1].querySelector('.tpl-desc').title).toBe(long.description); // tooltip com o texto todo
  expect(box.querySelector('.tpl-head-grid .tpl-new').textContent).toBe('Novo template de notas'); // título à esquerda, botão à direita
  expect([...box.querySelectorAll('h2.section-title')].map((h: any) => h.textContent)).toEqual(['Embutidos', 'Meus templates']);
  expect(box.querySelector('.tpl-block button.tpl-act:not(.danger)')).not.toBeNull();
  for (const hidden of box.querySelectorAll('.tpl-actions')) expect(hidden.hidden).toBe(false); // sempre visíveis (teclado)
});

it('clicar no título ou no bloco abre a edição; clicar numa ação não abre', async () => {
  const { box } = await open();
  const [first, second] = [...box.querySelectorAll('.tpl-block')] as any[];
  first.querySelector('.tpl-name').click();
  expect(box.querySelector('.tpl-title-input').value).toBe('Reunião geral');
  buttons(box, 'Cancelar')[0].click();
  await flush();
  const again = [...box.querySelectorAll('.tpl-block')] as any[];
  again[1].querySelector('.tpl-desc').click(); // área do bloco (não é botão)
  expect(box.querySelector('.tpl-title-input').value).toBe('Retro');
  buttons(box, 'Cancelar')[0].click();
  await flush();
  [...box.querySelectorAll('.tpl-block')][1].querySelector('.tpl-act:nth-child(2)').click(); // Duplicar: cria a cópia, não só abre
  await flush();
  expect(rice.saveTemplate).toHaveBeenCalled();
  void second;
});

it('CSS da lista: grade emoji|conteúdo, ações alinhadas ao título, sem position:absolute, padding 12×14 e raio 10', () => {
  const css = readFileSync('src/renderer/index.html', 'utf8');
  const block = css.split('.tpl-block {')[1]?.split('}')[0] ?? '';
  for (const p of ['grid-template-columns:28px minmax(0,1fr)', 'padding:12px 14px', 'border-radius:10px', 'margin:0 -14px 4px']) expect(block).toContain(p);
  expect(css).toMatch(/\.tpl-actions \{[^}]*gap:4px 16px/);
  expect(css).toMatch(/\.tpl-actions \{[^}]*grid-column:2/);
  expect(css).toMatch(/\.tpl-desc \{[^}]*-webkit-line-clamp:2/);
  expect(css).toMatch(/\.tpl-block:hover[^{]*\{ background:var\(--hover\); \}/);
  const tplRules = css.split('\n').filter((l) => /\.tpl-(block|name|desc|actions|act|line1|header)\b/.test(l)).join('\n');
  expect(tplRules).not.toContain('position:absolute');
  expect(tplRules).not.toMatch(/text-overflow:ellipsis|white-space:nowrap/); // título nunca truncado
});

it('usar como padrão chama o IPC', async () => {
  const { box } = await open();
  buttons(box, 'Usar como padrão')[0].click();
  await flush();
  expect(rice.setDefaultTemplate).toHaveBeenCalledWith('abc');
});

it('apagar pede confirmação; cancelar não apaga', async () => {
  const no = await open(vi.fn(async () => false));
  buttons(no.box, 'Apagar')[0].click();
  await flush();
  expect(rice.deleteTemplate).not.toHaveBeenCalled();
  const yes = await open();
  buttons(yes.box, 'Apagar')[0].click();
  await flush();
  expect(yes.confirm).toHaveBeenCalled();
  expect(rice.deleteTemplate).toHaveBeenCalledWith('abc');
});

it('duplicar salva uma cópia e abre o editor dela', async () => {
  const { box } = await open();
  buttons(box, 'Duplicar')[0].click();
  await flush();
  expect(rice.saveTemplate.mock.calls[0][0]).toMatchObject({ title: 'Reunião geral (cópia)', sections: [{ heading: 'Resumo' }] });
  expect(rice.saveTemplate.mock.calls[0][0].id).toBeUndefined();
  expect(box.querySelector('.tpl-title-input').value).toBe('Reunião geral (cópia)');
});

it('embutido abre editável, sem o aviso antigo, e salvar envia o mesmo id (override)', async () => {
  const { box } = await open();
  buttons(box, 'Editar')[0].click();
  expect(box.querySelector('.tpl-title-input').disabled).toBe(false);
  expect(box.textContent).not.toContain('não podem ser editados');
  expect(buttons(box, 'Restaurar padrão')).toHaveLength(0); // ainda não editado
  const title = box.querySelector('.tpl-title-input');
  title.value = 'Geral do time';
  title.oninput();
  buttons(box, 'Salvar')[0].click();
  await flush();
  expect(rice.saveTemplate.mock.calls[0][0]).toMatchObject({ id: 'reuniao-geral', title: 'Geral do time' });
});

it('embutido editado: rótulo "editado" e Restaurar padrão com confirmação', async () => {
  const edited = { ...builtin, title: 'Geral do time', customized: true };
  rice.listTemplates = vi.fn(async () => ({ templates: [edited, mine], defaultId: 'reuniao-geral', warnings: [] }));
  rice.restoreTemplate = vi.fn(async () => ({ ok: true, template: builtin }));
  const no = await open(vi.fn(async () => false));
  expect(no.box.querySelector('.tpl-block .tpl-edited').textContent).toBe('editado');
  buttons(no.box, 'Restaurar padrão')[0].click();
  await flush();
  expect(rice.restoreTemplate).not.toHaveBeenCalled();
  const yes = await open();
  buttons(yes.box, 'Restaurar padrão')[0].click();
  await flush();
  expect(yes.confirm).toHaveBeenCalled();
  expect(rice.restoreTemplate).toHaveBeenCalledWith('reuniao-geral');
  expect(buttons(yes.box, 'Apagar')).toHaveLength(1); // só o do usuário
});

it('editor: reordena, remove, adiciona e salva na ordem nova', async () => {
  const { box } = await open();
  buttons(box, 'Editar')[1].click(); // [0] é o embutido
  expect([...box.querySelectorAll('.tpl-heading')].map((i: any) => i.value)).toEqual(['Bom', 'Ruim']);
  buttons(box, '↓')[0].click(); // Bom desce
  expect([...box.querySelectorAll('.tpl-heading')].map((i: any) => i.value)).toEqual(['Ruim', 'Bom']);
  expect(buttons(box, '↑')[0].disabled).toBe(true);
  buttons(box, '＋ Adicionar seção')[0].click();
  const headings = [...box.querySelectorAll('.tpl-heading')] as any[];
  headings[2].value = 'Ações';
  headings[2].oninput();
  buttons(box, '✕')[1].click(); // remove "Bom"
  buttons(box, 'Salvar')[0].click();
  await flush();
  const saved = rice.saveTemplate.mock.calls[0][0];
  expect(saved.id).toBe('abc');
  expect(saved.sections.map((s: any) => s.heading)).toEqual(['Ruim', 'Ações']);
});

it('erro de validação aparece no editor e mantém o formulário', async () => {
  rice.saveTemplate = vi.fn(async () => ({ ok: false, message: 'O título precisa ter de 1 a 80 caracteres.' }));
  const { box } = await open();
  buttons(box, 'Novo template de notas')[0].click();
  buttons(box, 'Salvar')[0].click();
  await flush();
  expect(box.querySelector('.feedback.bad').textContent).toContain('título');
  expect(box.querySelector('.tpl-title-input')).not.toBeNull();
});

it('avisa quando arquivos de template inválidos foram ignorados', async () => {
  rice.listTemplates = vi.fn(async () => ({ templates: [builtin], defaultId: 'reuniao-geral', warnings: ['Template ignorado (x.json): y'] }));
  const { box } = await open();
  expect(box.querySelector('.tpl-warning').textContent).toContain('1 arquivo');
});

it('seletor de padrão na tela Templates chama setDefaultTemplate', async () => {
  const { box } = await open();
  const chip = box.querySelector('.tpl-default .tpl-chip');
  expect(chip.textContent).toBe('Reunião geral');
  g.document.body.append(box);
  chip.click();
  [...box.querySelectorAll('[role=option]')][1].click();
  await flush();
  expect(rice.setDefaultTemplate).toHaveBeenCalledWith('abc');
});

it('templates sem emoji: ícone de linha por tipo na lista e nenhum campo de emoji/ícone no editor', async () => {
  const lamp = { ...builtin, id: 'brainstorm', title: 'Brainstorm', icon: 'lightbulb', symbol: '💡' }; // symbol legado é ignorado
  const mineNoIcon = { ...mine, icon: undefined };
  rice.listTemplates = vi.fn(async () => ({ templates: [builtin, lamp, mineNoIcon], defaultId: 'reuniao-geral', warnings: [] }));
  const { box } = await open();
  const icons = [...box.querySelectorAll('.tpl-block .tpl-ico svg')].map((s: any) => s.getAttribute('class'));
  expect(icons).toEqual(['icon icon-file-text', 'icon icon-lightbulb', 'icon icon-file-text']); // sem ícone: file-text
  expect(box.textContent).not.toContain('💡');
  buttons(box, 'Editar')[0].click();
  expect(box.querySelector('.tpl-symbol-input')).toBeNull();
  expect(box.querySelectorAll('.tpl-title-input')).toHaveLength(1); // só o campo Nome
  buttons(box, 'Salvar')[0].click();
  await flush();
  expect(rice.saveTemplate.mock.calls.at(-1)![0]).not.toHaveProperty('symbol');
  expect(rice.saveTemplate.mock.calls.at(-1)![0]).not.toHaveProperty('icon');
});
