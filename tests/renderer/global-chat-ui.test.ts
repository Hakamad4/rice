// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer, press, type } from '../helpers/boot-renderer';

const g = globalThis as any;
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const MEETINGS = [
  { dir: '/R/a', title: 'Kickoff Acme', startedAt: day(3), state: 'done' },
  { dir: '/R/b', title: 'Sync interno', startedAt: day(1), state: 'done' },
];
const CITATIONS = [
  { n: 1, dir: '/R/a', title: 'Kickoff Acme', date: day(3) },
  { n: 2, dir: '/R/b', title: 'Sync interno', date: day(1) },
];

function boot(extra: Record<string, unknown> = {}) {
  const askGlobal = vi.fn(async (id: number, _q: string, _scope: unknown) => {
    handlers.delta?.(id, 'Aprovado ');
    return { ok: true, answer: 'Orçamento aprovado [1] e adiado [1][2]. Veja [9] e <b>x</b>.', citations: CITATIONS, terms: ['orcamen'] };
  });
  const handlers: Record<string, any> = {};
  const out = bootRenderer(
    {
      askGlobal,
      globalHistory: vi.fn(async () => []),
      newGlobalChat: vi.fn(async () => ({ ok: true })),
      listFolders: async () => [{ id: 'f1', name: 'Acme', createdAt: '', order: 0 }],
      readMeeting: async (dir: string) => ({
        meta: { title: dir === '/R/a' ? 'Kickoff Acme' : 'Sync interno', startedAt: day(3), state: 'done', notesStatus: 'done' },
        transcript: '', annotations: '', notes: '- Orçamento aprovado em 50 mil\n', chat: [],
      }),
      onDelta: (fn: any) => (handlers.delta = fn),
      ...extra,
    },
    MEETINGS,
  );
  return { ...out, askGlobal };
}

it('Início tem o campo "Pergunte sobre suas reuniões"; perguntar abre o chat em "Todas as reuniões"', async () => {
  const { askGlobal } = boot();
  await vi.waitFor(() => expect(g.document.getElementById('home-ask-input')).not.toBeNull());
  const input = g.document.getElementById('home-ask-input');
  expect(g.document.querySelector('.home-ask .ph-long').textContent).toContain('Pergunte sobre suas reuniões'); // o exemplo é um rótulo por cima do campo
  expect(g.document.querySelector('.home-ask .ph-short').textContent).toBe('Pergunte…'); // versão curta para colunas estreitas
  expect(input.getAttribute('aria-label')).toBe('Pergunte sobre suas reuniões');
  expect(g.document.querySelector('.home-ask .kbd-hint').textContent).toBe('⌘J');
  // o campo vem ANTES do título "Próximas reuniões"
  const page = g.document.querySelector('#detail .page');
  expect(page.firstElementChild.className).toBe('ai-notice-slot'); // espaço do aviso de IA (vazio quando há IA)
  expect(page.children[1].className).toBe('home-ask-row'); // campo + "Nova war room" na mesma linha
  expect(page.children[1].firstElementChild.className).toBe('home-ask');
  expect(page.querySelector('h1').textContent).toBe('Agenda');
  expect(g.document.body.classList.contains('chat-open')).toBe(false);
  type(input, 'Qual o orçamento da Acme?');
  input.form.dispatchEvent(new g.window.Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(askGlobal).toHaveBeenCalledWith(expect.any(Number), 'Qual o orçamento da Acme?', { kind: 'all' }));
  expect(g.document.body.classList.contains('chat-open')).toBe(true);
  expect(g.document.getElementById('scope-label').textContent).toBe('Todas');
  expect(g.document.getElementById('messages-global').hidden).toBe(false);
  expect(g.document.getElementById('messages').hidden).toBe(true);
  expect(g.document.getElementById('gchat-new').hidden).toBe(false);
});

async function ask(question: string) {
  await vi.waitFor(() => expect(g.document.getElementById('home-ask-input')).not.toBeNull());
  const input = g.document.getElementById('home-ask-input');
  type(input, question);
  input.form.dispatchEvent(new g.window.Event('submit', { cancelable: true, bubbles: true }));
}

it('citações [n] viram botões seguros; [9] desconhecido e HTML da IA ficam como texto; há linha de fontes', async () => {
  boot();
  await ask('orçamento');
  const box = g.document.getElementById('messages-global');
  await vi.waitFor(() => expect(box.querySelectorAll('.cite').length).toBe(3));
  expect([...box.querySelectorAll('.cite')].map((b: any) => b.textContent)).toEqual(['1', '1', '2']);
  const answer = box.querySelector('.msg:last-child .md');
  expect(answer.textContent).toContain('[9]');
  expect(answer.textContent).toContain('<b>x</b>'); // tag da IA é texto, nunca elemento
  expect(answer.querySelector('b')).toBeNull();
  const sources = [...box.querySelectorAll('.source-link')].map((b: any) => b.textContent);
  expect(sources).toHaveLength(2);
  expect(sources[0]).toMatch(/^1\. Kickoff Acme · /);
});

it('clicar numa citação abre a reunião no trecho (destaca o termo) e o chat entre reuniões continua aberto', async () => {
  boot();
  g.window.HTMLElement.prototype.scrollIntoView = () => {};
  await ask('orçamento');
  const box = g.document.getElementById('messages-global');
  await vi.waitFor(() => expect(box.querySelectorAll('.cite').length).toBe(3));
  box.querySelector('.cite').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Kickoff Acme'));
  await vi.waitFor(() => expect(g.document.querySelector('.notes-body mark.hit-flash')?.textContent).toBe('Orçamen'.slice(0, 7)));
  expect(g.document.getElementById('scope-label').textContent).toBe('Todas');
  expect(g.document.body.classList.contains('chat-open')).toBe(true);
  expect(g.document.getElementById('messages-global').hidden).toBe(false);
});

it('abrir uma reunião pela lista volta o chat para ela; o chip troca entre esta reunião, todas e pasta', async () => {
  const { askGlobal } = boot();
  await ask('x');
  await vi.waitFor(() => expect(g.document.querySelector('#messages-global .cite')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
  expect(g.document.getElementById('scope-label').textContent).toBe('Esta reunião');
  expect(g.document.getElementById('messages').hidden).toBe(false);
  expect(g.document.getElementById('gchat-new').hidden).toBe(true);

  g.document.getElementById('scope-chip').click();
  const items = () => [...g.document.querySelectorAll('.action-item')] as any[];
  expect(items().map((i) => i.textContent.trim())).toEqual(['Esta reunião', 'Todas as reuniões', 'Acme']);
  items()[2].click(); // pasta
  expect(g.document.getElementById('scope-label').textContent).toBe('Pasta: Acme');
  type(g.document.getElementById('question'), 'prazo?');
  g.document.getElementById('ask').dispatchEvent(new g.window.Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(askGlobal).toHaveBeenLastCalledWith(expect.any(Number), 'prazo?', { kind: 'folder', folderId: 'f1' }));
});

it('⌘J abre o chat de todas as reuniões com foco na pergunta; Nova conversa limpa', async () => {
  const history = [{ at: '', question: 'antiga?', answer: 'Sim [1].', scope: { kind: 'all' }, citations: [CITATIONS[0]], terms: [] }];
  const { rice } = boot({ globalHistory: vi.fn(async () => history) });
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  press(g.document, 'j', { metaKey: true });
  expect(g.document.body.classList.contains('chat-open')).toBe(true);
  expect(g.document.activeElement).toBe(g.document.getElementById('question'));
  await vi.waitFor(() => expect(g.document.querySelectorAll('#messages-global .msg')).toHaveLength(2));
  expect(g.document.querySelector('#messages-global .cite').textContent).toBe('1');
  g.document.getElementById('gchat-new').click();
  await vi.waitFor(() => expect(rice.newGlobalChat).toHaveBeenCalled());
  await vi.waitFor(() => expect(g.document.querySelector('#messages-global .empty')?.textContent).toContain('Pergunte sobre qualquer reunião'));
});

it('erro do provedor aparece como texto na resposta e libera o botão de enviar', async () => {
  boot({ askGlobal: vi.fn(async () => ({ ok: false, kind: 'auth', message: 'Sessão expirada.' })) });
  await ask('x');
  await vi.waitFor(() => expect(g.document.querySelector('#messages-global .msg:last-child .md')?.textContent).toBe('Sessão expirada.'));
  expect(g.document.getElementById('send').disabled).toBe(false);
});

it('item "Início" é o primeiro da navegação, fica ativo no Início e volta para ele de qualquer tela', async () => {
  boot();
  await vi.waitFor(() => expect(g.document.getElementById('home-ask-input')).not.toBeNull());
  const nav = [...g.document.querySelectorAll('aside .nav-item')] as any[];
  expect(nav[0].id).toBe('home-link');
  expect(nav[0].textContent.trim()).toBe('Início');
  expect(nav[0].querySelector('svg.icon-home')).not.toBeNull();
  expect(nav[0].classList.contains('active')).toBe(true);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.getElementById('settings-link').classList.contains('active')).toBe(true));
  expect(nav[0].classList.contains('active')).toBe(false);
  nav[0].click();
  await vi.waitFor(() => expect(g.document.getElementById('home-ask-input')).not.toBeNull());
  expect(nav[0].classList.contains('active')).toBe(true);
  expect(g.document.getElementById('settings-link').classList.contains('active')).toBe(false);
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
  expect(nav[0].classList.contains('active')).toBe(false);
});
