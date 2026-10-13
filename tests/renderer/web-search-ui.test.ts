// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer, flush } from '../helpers/boot-renderer';

const g = globalThis as any;
const MEETINGS = [
  { dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' },
  { dir: '/R/b', title: 'Sync', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' },
];
const toggle = () => g.document.getElementById('web-toggle') as any;
const note = () => g.document.getElementById('web-note') as any;

function boot(extra: Record<string, unknown> = {}) {
  return bootRenderer(
    {
      aiWebStatus: vi.fn(async () => ({ available: true, provider: 'claude-sub' })),
      ask: vi.fn(async (_id: number, _dir: string, _q: string, _web: boolean) => ({ ok: true, answer: 'ok', sources: [] })),
      askGlobal: vi.fn(async () => ({ ok: true, answer: 'ok', citations: [], terms: [], sources: [] })),
      globalHistory: vi.fn(async () => []),
      newGlobalChat: vi.fn(async () => ({ ok: true })),
      openLink: vi.fn(),
      ...extra,
    },
    MEETINGS,
  );
}
const ready = () => vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
const open = async (dir: string) => {
  [...g.document.querySelectorAll('.meeting')].find((m: any) => m.textContent.includes(dir === '/R/a' ? 'Kickoff' : 'Sync')).click();
  await vi.waitFor(() => expect(g.document.getElementById('question').disabled).toBe(false));
};
const ask = async (text: string) => {
  g.document.getElementById('question').value = text;
  g.document.getElementById('ask').requestSubmit();
  await flush();
};

it('começa desligado; ligar mostra o chip ativo; o aviso da primeira vez aparece uma só vez', async () => {
  const { rice } = boot();
  await ready();
  await open('/R/a');
  await vi.waitFor(() => expect(toggle().disabled).toBe(false));
  expect(toggle().getAttribute('aria-pressed')).toBe('false');
  expect(toggle().querySelector('.web-chip-text')).toBeNull();
  expect(note().hidden).toBe(true);
  toggle().click();
  expect(toggle().getAttribute('aria-pressed')).toBe('true');
  expect(toggle().classList.contains('on')).toBe(true);
  expect(toggle().textContent).toBe('Web');
  expect(note().hidden).toBe(false);
  expect(note().textContent).toContain('A pergunta é enviada para a busca do provedor de IA');
  note().querySelector('button').click();
  expect(note().hidden).toBe(true);
  toggle().click();
  toggle().click();
  expect(note().hidden).toBe(true); // já visto
  expect(rice.aiWebStatus).toHaveBeenCalled();
});

it('só a pergunta feita com o interruptor ligado leva a busca (true exato); desligado nunca liga sozinho', async () => {
  const { rice } = boot();
  await ready();
  await open('/R/a');
  await vi.waitFor(() => expect(toggle().disabled).toBe(false));
  await ask('primeira');
  await vi.waitFor(() => expect(rice.ask).toHaveBeenCalledTimes(1));
  expect(rice.ask.mock.calls[0][3]).toBe(false);
  toggle().click();
  await vi.waitFor(() => expect(g.document.getElementById('send').dataset.stop).not.toBe('1'));
  await ask('segunda');
  await vi.waitFor(() => expect(rice.ask).toHaveBeenCalledTimes(2));
  expect(rice.ask.mock.calls[1][3]).toBe(true);
});

it('o estado vale por conversa: cada reunião e o chat global guardam o seu', async () => {
  boot();
  await ready();
  await open('/R/a');
  await vi.waitFor(() => expect(toggle().disabled).toBe(false));
  toggle().click();
  expect(toggle().getAttribute('aria-pressed')).toBe('true');
  await open('/R/b');
  expect(toggle().getAttribute('aria-pressed')).toBe('false');
  await open('/R/a');
  expect(toggle().getAttribute('aria-pressed')).toBe('true');
});

it('provedor sem suporte: interruptor desabilitado, com o motivo no title, e a busca não segue', async () => {
  const { rice } = boot({ aiWebStatus: vi.fn(async () => ({ available: false, provider: 'agy-sub', hint: 'Busca na web indisponível em Antigravity.' })) });
  await ready();
  await open('/R/a');
  await vi.waitFor(() => expect(toggle().title).toContain('Busca na web indisponível em Antigravity.'));
  expect(toggle().disabled).toBe(true);
  toggle().click();
  expect(toggle().getAttribute('aria-pressed')).toBe('false');
  await ask('oi');
  await vi.waitFor(() => expect(rice.ask).toHaveBeenCalled());
  expect(rice.ask.mock.calls[0][3]).toBe(false);
});

it('fontes: título e domínio como texto puro; só https abre, via openLink; nada de innerHTML da IA ou da web', async () => {
  const sources = [
    { url: 'https://nodejs.org/en/download', title: 'Node.js <img src=x onerror=alert(1)>' },
    { url: 'javascript:alert(1)', title: 'malicioso' },
    { url: 'http://inseguro.com', title: 'sem tls' },
    { url: 'https://www.devx.com/a', title: '' },
    { url: 'https://www.devx.com/b', title: 'www.devx.com' },
  ];
  const { rice } = boot({ ask: vi.fn(async () => ({ ok: true, answer: 'Resposta', sources })) });
  await ready();
  await open('/R/a');
  await vi.waitFor(() => expect(toggle().disabled).toBe(false));
  toggle().click();
  await ask('versão do node?');
  await vi.waitFor(() => expect(g.document.querySelector('.web-sources')).not.toBeNull());
  const box = g.document.querySelector('.web-sources');
  const links = [...box.querySelectorAll('.web-source')] as any[];
  expect(links).toHaveLength(3);
  expect(box.querySelector('img')).toBeNull();
  expect(links[0].textContent).toBe('Node.js <img src=x onerror=alert(1)> · nodejs.org');
  expect(links[1].textContent).toBe('devx.com');
  expect(links[2].textContent).toBe('devx.com'); // título igual ao domínio (com www) não repete
  expect(links[0].title).toBe('Abrir nodejs.org no navegador');
  links[0].click();
  expect(rice.openLink).toHaveBeenCalledWith('https://nodejs.org/en/download');
});

it('chat global: leva o interruptor, mostra as fontes e "Nova conversa" volta a desligado', async () => {
  const { rice } = boot({ askGlobal: vi.fn(async () => ({ ok: true, answer: 'ok', citations: [], terms: [], sources: [{ url: 'https://endoflife.date/nodejs', title: 'endoflife.date' }] })) });
  await ready();
  g.document.getElementById('scope-chip').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => /todas/i.test(i.textContent)).click();
  await vi.waitFor(() => expect(toggle().disabled).toBe(false));
  toggle().click();
  await ask('qual a versão LTS?');
  await vi.waitFor(() => expect(rice.askGlobal).toHaveBeenCalled());
  expect(rice.askGlobal.mock.calls[0][3]).toBe(true);
  await vi.waitFor(() => expect(g.document.querySelector('#messages-global .web-sources')).not.toBeNull());
  g.document.getElementById('gchat-new').click();
  await vi.waitFor(() => expect(rice.newGlobalChat).toHaveBeenCalled());
  await vi.waitFor(() => expect(toggle().getAttribute('aria-pressed')).toBe('false'));
});

it('ao reabrir a reunião as fontes salvas voltam junto da resposta (e histórico antigo, sem fontes, segue igual)', async () => {
  const chat = [
    { question: 'antiga', answer: 'sem fontes' },
    { question: 'com busca', answer: 'Resposta', sources: [{ url: 'https://nodejs.org/en', title: 'Node.js' }, { url: 'javascript:alert(1)', title: 'x' }] },
  ];
  const { rice } = boot({ readMeeting: async () => ({ meta: { notesStatus: 'done', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done' }, transcript: '', annotations: '', notes: '', chat }) });
  await ready();
  await open('/R/a');
  await vi.waitFor(() => expect(g.document.querySelectorAll('#messages .msg.rice').length).toBe(2));
  const answers = [...g.document.querySelectorAll('#messages .msg.rice')] as any[];
  expect(answers[0].querySelector('.web-sources')).toBeNull();
  const links = answers[1].querySelectorAll('.web-source');
  expect(links).toHaveLength(1);
  links[0].click();
  expect(rice.openLink).toHaveBeenCalledWith('https://nodejs.org/en');
});

it('chat global: o histórico mostra as fontes salvas de cada turno', async () => {
  boot({ globalHistory: vi.fn(async () => [{ question: 'q', answer: 'a', citations: [], terms: [], scope: { kind: 'all' }, sources: [{ url: 'https://endoflife.date/nodejs', title: 'endoflife.date' }] }, { question: 'q2', answer: 'b', citations: [], terms: [], scope: { kind: 'all' } }]) });
  await ready();
  g.document.getElementById('scope-chip').click();
  [...g.document.querySelectorAll('.action-item')].find((i: any) => /todas/i.test(i.textContent)).click();
  await vi.waitFor(() => expect(g.document.querySelectorAll('#messages-global .msg.rice').length).toBe(2));
  expect(g.document.querySelectorAll('#messages-global .web-sources')).toHaveLength(1);
});
