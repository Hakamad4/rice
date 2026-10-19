// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { normalizeSavedPrompts } from '../../src/shared/saved-prompts';
import { bootRenderer, type } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }];
const btn = () => g.document.getElementById('prompts-btn') as any;
const items = () => [...g.document.querySelectorAll('.action-menu .action-item')] as any[];
const item = (text: string) => items().find((i) => i.textContent.includes(text)) as any;
const isDisabled = (i: any) => i.getAttribute('aria-disabled') === 'true' || i.disabled === true;

function boot(extra: Record<string, unknown> = {}, lang: 'pt-BR' | 'en' = 'pt-BR', saved: string[] = []) {
  const setSavedPrompts = vi.fn(async (list: string[]) => normalizeSavedPrompts(list));
  const out = bootRenderer({
    uiLanguage: lang,
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, savedPrompts: saved }),
    setSavedPrompts,
    ask: vi.fn(async () => ({ ok: true, answer: 'ok', sources: [] })),
    askGlobal: vi.fn(async () => ({ ok: true, answer: 'ok', citations: [], terms: [], sources: [] })),
    globalHistory: vi.fn(async () => []),
    ...extra,
  }, MEETINGS);
  return { ...out, setSavedPrompts };
}
const open = async () => {
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('question').disabled).toBe(false));
};
const goGlobal = async () => {
  g.document.getElementById('scope-chip').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => /todas|all/i.test(i.textContent)).click();
  await vi.waitFor(() => expect(g.document.getElementById('messages-global').hidden).toBe(false));
};
const ask = async (text: string) => {
  g.document.getElementById('question').value = text;
  g.document.getElementById('ask').requestSubmit();
  await vi.waitFor(() => expect(g.document.querySelectorAll('.msg.user').length).toBeGreaterThan(0));
};

it('o botão fica no campo, à esquerda do enviar, com ícone de linha, title e aria-label; não há mais chips', async () => {
  boot();
  await open();
  expect(btn().nextElementSibling).toBe(g.document.getElementById('send'));
  expect(btn().parentElement.classList.contains('ask-box')).toBe(true);
  expect(btn().title).toBe('Perguntas prontas');
  expect(btn().getAttribute('aria-label')).toBe('Perguntas prontas');
  expect(btn().querySelector('svg')).not.toBeNull();
  expect(g.document.getElementById('prompt-chips')).toBeNull();
  expect(g.document.querySelector('#messages .empty')).not.toBeNull(); // o estado vazio volta a ser só o texto discreto
  expect(g.document.body.classList.contains('chips-on')).toBe(false);
});

it('em inglês: title e aria-label "Saved questions" e itens traduzidos', async () => {
  boot({}, 'en');
  await open();
  expect(btn().title).toBe('Saved questions');
  expect(btn().getAttribute('aria-label')).toBe('Saved questions');
  btn().click();
  expect(items().map((i) => i.textContent.trim()).slice(0, 3)).toEqual(['Summary for someone who missed it', 'Next steps per person', 'Risks and open items']);
  expect(item('Save last question')).toBeDefined();
  expect(item('Add saved question')).toBeDefined();
});

it('abre acima do campo; padrão da reunião; clicar envia a pergunta pronta', async () => {
  const { rice } = boot();
  await open();
  const spy = vi.spyOn(g.window.RiceActionMenu, 'open');
  btn().click();
  expect(spy.mock.calls[0]![0]).toMatchObject({ placement: 'above', anchor: btn() });
  expect(items().slice(0, 3).map((i) => i.textContent.trim())).toEqual(['Resumo para quem faltou', 'Próximos passos por pessoa', 'Riscos e pendências']);
  item('Riscos e pendências').click();
  await vi.waitFor(() => expect(rice.ask).toHaveBeenCalledTimes(1));
  expect(rice.ask.mock.calls[0][2]).toBe('Quais são os riscos e as pendências em aberto desta reunião?');
});

it('visível sempre: com histórico no chat o botão e o menu continuam; no chat global vêm as perguntas da semana', async () => {
  const { rice } = boot({ readMeeting: async () => ({ meta: { notesStatus: 'done', title: 'K', startedAt: new Date().toISOString(), state: 'done' }, transcript: '', annotations: '', notes: '', chat: [{ question: 'q', answer: 'a' }] }) });
  await open();
  await vi.waitFor(() => expect(g.document.querySelectorAll('#messages .msg.rice').length).toBe(1));
  btn().click();
  expect(items()).not.toHaveLength(0);
  g.window.RiceActionMenu.close();
  await goGlobal();
  btn().click();
  expect(items().slice(0, 3).map((i) => i.textContent.trim())).toEqual(['O que ficou pendente esta semana?', 'Decisões desta semana', 'Próximos passos por pessoa']);
  item('O que ficou pendente').click();
  await vi.waitFor(() => expect(rice.askGlobal).toHaveBeenCalled());
  expect(rice.askGlobal.mock.calls[0][1]).toBe('O que ficou pendente esta semana?');
});

it('as salvas aparecem abaixo das padrão, sob "Suas perguntas", e também enviam', async () => {
  const { rice } = boot({}, 'pt-BR', ['Quais perguntas ficaram sem resposta?']);
  await open();
  btn().click();
  expect(g.document.querySelector('.action-menu .menu-heading').textContent).toBe('Suas perguntas');
  item('Quais perguntas ficaram sem resposta?').click();
  await vi.waitFor(() => expect(rice.ask).toHaveBeenCalled());
  expect(rice.ask.mock.calls[0][2]).toBe('Quais perguntas ficaram sem resposta?');
});

it('"Salvar a última pergunta": desabilitado sem pergunta; depois salva e fica desabilitado por duplicata', async () => {
  const t = boot();
  await open();
  btn().click();
  expect(isDisabled(item('Salvar a última pergunta'))).toBe(true);
  expect(item('Salvar a última pergunta').title).toBe('Envie uma pergunta primeiro para salvá-la');
  g.window.RiceActionMenu.close();
  await ask('Qual o prazo do projeto?');
  btn().click();
  item('Salvar a última pergunta').click();
  await vi.waitFor(() => expect(t.setSavedPrompts).toHaveBeenCalledWith(['Qual o prazo do projeto?']));
  btn().click();
  expect(isDisabled(item('Salvar a última pergunta'))).toBe(true);
  expect(item('Salvar a última pergunta').title).toBe('Já é uma pergunta pronta');
});

it('"Adicionar pergunta pronta…" abre o diálogo; Salvar só habilita com texto novo (ignora caixa)', async () => {
  const t = boot({}, 'pt-BR', ['Já existe']);
  await open();
  btn().click();
  item('Adicionar pergunta pronta').click();
  const dialog = () => g.document.querySelector('[role=dialog]') as any;
  const save = () => [...dialog().querySelectorAll('button')].find((b: any) => b.textContent === 'Salvar');
  expect(save().disabled).toBe(true);
  type(dialog().querySelector('input'), 'já EXISTE');
  expect(save().disabled).toBe(true);
  type(dialog().querySelector('input'), 'Quem ficou de enviar a proposta?');
  expect(save().disabled).toBe(false);
  save().click();
  await vi.waitFor(() => expect(t.setSavedPrompts).toHaveBeenCalledWith(['Já existe', 'Quem ficou de enviar a proposta?']));
  await vi.waitFor(() => expect(dialog()).toBeNull());
});

it('remover: submenu "Remover pergunta salva" lista as salvas e grava a lista nova', async () => {
  const t = boot({}, 'pt-BR', ['Primeira', 'Segunda']);
  await open();
  btn().click();
  item('Remover pergunta salva').click();
  const sub = [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
  expect(sub.map((i) => i.textContent.trim())).toEqual(['Primeira', 'Segunda']);
  sub[0].click();
  await vi.waitFor(() => expect(t.setSavedPrompts).toHaveBeenCalledWith(['Segunda']));
  btn().click();
  expect(items().map((i) => i.textContent.trim())).not.toContain('Primeira');
});

it('limite de 8: "Adicionar" e "Salvar a última" ficam desabilitados com a explicação', async () => {
  const eight = Array.from({ length: 8 }, (_, i) => `Pergunta ${i + 1}`);
  const t = boot({}, 'pt-BR', eight);
  await open();
  await ask('Uma nona pergunta');
  btn().click();
  const msg = 'Limite de 8 perguntas prontas; remova uma para salvar outra';
  expect(isDisabled(item('Adicionar pergunta pronta'))).toBe(true);
  expect(item('Adicionar pergunta pronta').title).toBe(msg);
  expect(isDisabled(item('Salvar a última pergunta'))).toBe(true);
  expect(item('Salvar a última pergunta').title).toBe(msg);
  item('Salvar a última pergunta').click();
  expect(t.setSavedPrompts).not.toHaveBeenCalled();
});

it('o ⋯ da pergunta enviada continua oferecendo "Salvar como pergunta pronta"', async () => {
  const t = boot();
  await open();
  await ask('Qual o orçamento?');
  g.document.querySelector('#messages .msg.user .msg-more').click();
  item('Salvar como pergunta pronta').click();
  await vi.waitFor(() => expect(t.setSavedPrompts).toHaveBeenCalledWith(['Qual o orçamento?']));
});

it('o main normaliza: texto puro, uma linha, sem repetir, no máximo 8 e 300 caracteres', () => {
  const out = normalizeSavedPrompts(['  a\nb  ', 'A B', 42, null, '', 'x'.repeat(500), ...Array.from({ length: 12 }, (_, i) => `p${i}`)]);
  expect(out).toHaveLength(8);
  expect(out[0]).toBe('a b');
  expect(out[1]).toHaveLength(300);
  expect(normalizeSavedPrompts('lixo')).toEqual([]);
});

it('menu acima do campo e botão de 28px na linha do campo (CSS)', () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.prompts-btn \{[^}]*width:\s*28px[^}]*height:\s*28px/);
  expect(readFileSync('src/renderer/action-menu.js', 'utf8')).toMatch(/placement === 'above'/);
});

it('a seta do submenu é cinza (só o ✓ de item marcado usa o destaque)', () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.menu-item\.has-submenu > \.check \{ color:var\(--muted\); \}/);
  expect(css).toMatch(/\.menu-item \.check \{[^}]*color:var\(--accent\)/);
});
