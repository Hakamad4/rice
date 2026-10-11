// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const tick = () => new Promise((r) => setTimeout(r, 60));
const note = { id: 'general', title: 'Reunião geral', description: 'd', icon: 'file-text', sections: [{ heading: 'Resumo', description: '' }], builtin: true };
const ideaBuiltins = [
  { id: 'general', title: 'Geral', description: 'Ideias, perguntas e riscos.', icon: 'lightbulb', instruction: 'Sugira.', categories: [], builtin: true },
  { id: 'sales', title: 'Vendas', description: 'Objeções do cliente.', icon: 'briefcase', instruction: 'Aponte.', categories: ['Objeção', 'Próximo passo'], builtin: true, customized: true },
];

function boot(extra: Record<string, unknown> = {}) {
  const saveIdeaTemplate = vi.fn(async (input: any) => ({ ok: true, template: { ...input, id: 'novo', icon: 'lightbulb', builtin: false } }));
  const restoreIdeaTemplate = vi.fn(async () => ({ ok: true }));
  bootRenderer({
    listTemplates: async () => ({ templates: [note], warnings: [], defaultId: 'general' }),
    listIdeaTemplates: async () => ({ templates: [...ideaBuiltins, { id: 'u1', title: 'Cliente difícil', description: '', icon: 'lightbulb', instruction: 'Gatilhos', categories: [], builtin: false }], warnings: [], lastId: 'general' }),
    saveIdeaTemplate, restoreIdeaTemplate, deleteIdeaTemplate: vi.fn(async () => ({ ok: true })),
    ...extra,
  }, []);
  return { saveIdeaTemplate, restoreIdeaTemplate };
}
const tabs = () => [...g.document.querySelectorAll('.tpl-tabs .mt-tab')] as any[];

it('página Templates: o botão "Novo template de notas" na aba Notas e "Novo template de ideias" na aba Ideias (mesma grade); abas "Notas · Ideias" (sublinhadas); a aba Ideias lista embutidos e meus com categorias, "editado" e ações', async () => {
  boot();
  g.document.getElementById('templates-link').click();
  await vi.waitFor(() => expect(tabs()).toHaveLength(2));
  expect(tabs().map((b) => b.textContent)).toEqual(['Notas', 'Ideias']);
  expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  expect(g.document.querySelector('.tpl-head-grid .tpl-new').textContent).toBe('Novo template de notas');
  tabs()[1].click();
  await vi.waitFor(() => expect(g.document.querySelectorAll('.tpl-block')).toHaveLength(3));
  expect(g.document.querySelector('.tpl-head-grid .tpl-new').textContent).toBe('Novo template de ideias');
  expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
  const blocks = [...g.document.querySelectorAll('.tpl-block')] as any[];
  expect(blocks.map((b) => b.querySelector('.tpl-name').textContent)).toEqual(['Geral', 'Vendas', 'Cliente difícil']);
  expect([...blocks[1].querySelectorAll('.tpl-sec-chip')].map((c: any) => c.textContent)).toEqual(['Objeção', 'Próximo passo']);
  expect(blocks[1].querySelector('.tpl-edited')).not.toBeNull();
  expect([...blocks[1].querySelectorAll('.tpl-actions button')].map((b: any) => b.textContent)).toEqual(['Editar', 'Duplicar', 'Restaurar padrão']);
  expect([...blocks[2].querySelectorAll('.tpl-actions button')].map((b: any) => b.textContent)).toEqual(['Editar', 'Duplicar', 'Apagar']);
  tabs()[0].click(); // volta para Notas
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-block .tpl-name').textContent).toBe('Reunião geral'));
});

it('editor de template de ideias: nome, descrição, instrução e categorias em chips; salvar envia tudo', async () => {
  const { saveIdeaTemplate } = boot();
  g.document.getElementById('templates-link').click();
  await vi.waitFor(() => expect(tabs()).toHaveLength(2));
  tabs()[1].click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-new')).not.toBeNull());
  g.document.querySelector('.tpl-new').click();
  await vi.waitFor(() => expect(g.document.querySelector('.itpl-instruction')).not.toBeNull());
  const set = (sel: string, value: string) => {
    const node = g.document.querySelector(sel);
    node.value = value;
    node.dispatchEvent(new g.window.Event('input', { bubbles: true }));
  };
  set('.tpl-title-input', 'Cliente difícil');
  set('.tpl-desc-input', 'Gatilhos de conflito');
  set('.itpl-instruction', 'Aponte gatilhos de conflito.');
  const chipInput = g.document.querySelector('.chips input');
  chipInput.value = 'Gatilho';
  chipInput.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  ([...g.document.querySelectorAll('button.primary')].find((b: any) => b.textContent === 'Salvar') as any).click();
  await vi.waitFor(() => expect(saveIdeaTemplate).toHaveBeenCalled());
  expect(saveIdeaTemplate).toHaveBeenCalledWith({ title: 'Cliente difícil', description: 'Gatilhos de conflito', instruction: 'Aponte gatilhos de conflito.', categories: ['Gatilho'] });
  await tick();
});

it('erro de validação do main aparece no editor (nome vazio) e não sai da tela', async () => {
  boot({ saveIdeaTemplate: vi.fn(async () => ({ ok: false, message: 'O nome precisa ter de 1 a 80 caracteres.' })) });
  g.document.getElementById('templates-link').click();
  await vi.waitFor(() => expect(tabs()).toHaveLength(2));
  tabs()[1].click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-new')).not.toBeNull());
  g.document.querySelector('.tpl-new').click();
  await vi.waitFor(() => expect(g.document.querySelector('.itpl-instruction')).not.toBeNull());
  ([...g.document.querySelectorAll('button.primary')].find((b: any) => b.textContent === 'Salvar') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.feedback.bad').textContent).toContain('O nome precisa'));
});
