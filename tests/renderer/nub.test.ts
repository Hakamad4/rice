// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const loadNub = () => {
  for (const f of ['i18n', 'locales/pt-BR', 'locales/en', 'nub']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
};
let handlers: Record<string, (p: any) => void>;
let nub: Record<string, any>;

beforeEach(() => {
  handlers = {};
  nub = { uiLanguage: 'pt-BR', on: vi.fn((c: string, fn: any) => (handlers[c] = fn)), openMain: vi.fn(), stop: vi.fn(), dragEnd: vi.fn() };
  g.window.nub = nub;
  g.document.documentElement.innerHTML = rendered('src/renderer/nub.html')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  loadNub();
});

it('minimalista: logo em SVG, 3 barras verdes, sem tempo, ponto ou emoji', () => {
  expect(g.document.querySelector('svg.logo')).not.toBeNull();
  expect(g.document.querySelectorAll('.bar')).toHaveLength(3);
  expect(g.document.getElementById('time')).toBeNull();
  expect(g.document.querySelector('.dot')).toBeNull();
  expect(g.document.body.textContent).not.toContain('🍚');
  expect(g.window.RiceNub.formatElapsed).toBeUndefined();
});

it('em silêncio as barras são pontinhos; com nível crescem', () => {
  const { barHeights } = g.window.RiceNub;
  expect(barHeights(0, 123)).toEqual([3, 3, 3]);
  const loud = barHeights(1, 123);
  expect(Math.max(...loud)).toBeGreaterThan(8);
  expect(Math.max(...loud)).toBeLessThanOrEqual(16);
});

it('nível recebido altera a altura das barras e relaxa em silêncio', async () => {
  vi.useFakeTimers();
  try {
    g.document.getElementById('bars').replaceChildren();
    loadNub(); // recarrega com relógio falso
    handlers['nub:level']!({ mic: 0.9, sys: 0.1 });
    await vi.advanceTimersByTimeAsync(100);
    const heights = () => [...g.document.querySelectorAll('.bar')].map((b: any) => parseInt(b.style.height, 10));
    expect(Math.max(...heights())).toBeGreaterThan(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(heights()).toEqual([3, 3, 3]);
  } finally {
    vi.useRealTimers();
  }
});

it('botão de parar chama stop sem abrir o app; clicar no resto abre o app', () => {
  g.document.getElementById('stop').click();
  expect(nub.stop).toHaveBeenCalledTimes(1);
  expect(nub.openMain).not.toHaveBeenCalled();
  g.document.getElementById('hit').click();
  expect(nub.openMain).toHaveBeenCalledTimes(1);
});

describe('painel de chat', () => {
  const $ = (id: string) => g.document.getElementById(id) as any;
  const type = (text: string) => {
    $('question').value = text;
    $('ask').dispatchEvent(new g.window.Event('submit', { cancelable: true, bubbles: true }));
  };

  beforeEach(() => {
    nub.expand = vi.fn(async () => ({ ok: true, title: 'Daily do time', lines: [{ who: 'Eu', text: 'bom dia' }] }));
    nub.collapse = vi.fn(async () => {});
    nub.ask = vi.fn(async () => ({ ok: true, answer: 'Decidimos X.' }));
    nub.cancel = vi.fn();
  });

  it('a pílula tem os botões de chat e parar (mostrados no hover) e o painel começa fechado', () => {
    expect($('chat')).not.toBeNull();
    expect($('stop')).not.toBeNull();
    expect(g.document.querySelector('.btns')).not.toBeNull();
    expect(g.document.body.classList.contains('open')).toBe(false);
  });

  it('clicar no chat expande: título, últimas linhas, foco no campo; não abre o app', async () => {
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    expect(nub.expand).toHaveBeenCalled();
    expect(nub.openMain).not.toHaveBeenCalled();
    expect($('panel-title').textContent).toBe('Daily do time');
    expect($('lines').textContent).toContain('bom dia');
    expect(g.document.activeElement).toBe($('question'));
  });

  it('se o main recusa (sem gravação), o painel não abre', async () => {
    nub.expand = vi.fn(async () => ({ ok: false, message: 'Nenhuma gravação em andamento.' }));
    $('chat').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(g.document.body.classList.contains('open')).toBe(false);
  });

  it('Enter (submit) envia a pergunta, mostra o streaming e a resposta final; vazio não envia', async () => {
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    type('   ');
    expect(nub.ask).not.toHaveBeenCalled();
    let finish!: (v: unknown) => void;
    nub.ask = vi.fn(() => new Promise((r) => (finish = r)));
    type('quais decisões?');
    expect(nub.ask).toHaveBeenCalledWith('quais decisões?');
    expect($('question').value).toBe('');
    handlers['nub:delta']!('Deci');
    handlers['nub:delta']!('dimos');
    expect(g.document.querySelector('.a').textContent).toBe('Decidimos');
    finish({ ok: true, answer: 'Decidimos X.' });
    await vi.waitFor(() => expect(g.document.querySelector('.a').textContent).toBe('Decidimos X.'));
    expect(g.document.querySelector('.q').textContent).toBe('quais decisões?');
  });

  it('erro da pergunta aparece na resposta', async () => {
    nub.ask = vi.fn(async () => ({ ok: false, message: 'sem login' }));
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    type('oi');
    await vi.waitFor(() => expect(g.document.querySelector('.a').textContent).toBe('Erro: sem login'));
  });

  it('transcrição ao vivo: parcial em cinza é trocado pelo segmento final', async () => {
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    handlers['nub:partial']!({ source: 'Outros', text: 'vamos fech', segmentId: '1', startMs: 0 });
    expect(g.document.querySelectorAll('.line.partial')).toHaveLength(1);
    handlers['nub:segment']!({ source: 'Outros', text: 'vamos fechar.' });
    expect(g.document.querySelectorAll('.line.partial')).toHaveLength(0);
    expect($('lines').textContent).toContain('vamos fechar.');
  });

  it('rótulos Eu/Outros aparecem no idioma do app (Me/Others em inglês), sem mudar quem é "eu"', async () => {
    nub.uiLanguage = 'en';
    g.window.RiceI18n.setLanguage('en');
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    handlers['nub:segment']!({ source: 'Eu', text: 'hello' });
    handlers['nub:segment']!({ source: 'Outros', text: 'hi' });
    const rows = [...g.document.querySelectorAll('#lines .line')].slice(-2);
    expect(rows.map((r: any) => r.querySelector('b').textContent)).toEqual(['Me', 'Others']);
    expect(rows.map((r: any) => r.classList.contains('me'))).toEqual([true, false]);
  });

  it('Esc e × recolhem e limpam a conversa; main recolhendo (gravação parou) fecha o painel', async () => {
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    type('oi');
    await vi.waitFor(() => expect(g.document.querySelector('.a').textContent).toBe('Decidimos X.'));
    g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(g.document.body.classList.contains('open')).toBe(false);
    expect(nub.collapse).toHaveBeenCalledTimes(1);
    expect(g.document.querySelector('.q')).toBeNull();
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    $('close').click();
    expect(g.document.body.classList.contains('open')).toBe(false);
    expect(nub.collapse).toHaveBeenCalledTimes(2);
    $('chat').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    handlers['nub:collapsed']!(null);
    expect(g.document.body.classList.contains('open')).toBe(false);
  });
});

describe('hover do nub', () => {
  const fire = (id: string, type: string) => g.document.getElementById(id).dispatchEvent(new g.window.MouseEvent(type));

  it('o main manda nub:hover: a barra estende e recolhe; o renderer não detecta mouse sozinho', () => {
    handlers['nub:hover']!(true);
    expect(g.document.body.classList.contains('hover')).toBe(true);
    handlers['nub:hover']!(false);
    expect(g.document.body.classList.contains('hover')).toBe(false);
    fire('pill', 'mouseenter');
    expect(g.document.body.classList.contains('hover')).toBe(false);
  });

  it('botões com rótulo; Perguntar abre o painel e zera o hover local; Parar não abre o app', async () => {
    nub.expand = vi.fn(async () => ({ ok: true, title: 'Daily', lines: [] }));
    expect(g.document.getElementById('chat').textContent).toContain('Perguntar');
    expect(g.document.getElementById('stop').textContent).toContain('Parar');
    handlers['nub:hover']!(true);
    g.document.getElementById('chat').click();
    expect(nub.expand).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(g.document.body.classList.contains('open')).toBe(true));
    expect(g.document.body.classList.contains('hover')).toBe(false);
    expect(nub.openMain).not.toHaveBeenCalled();
  });

  it('nub:side muda o lado em que a barra cresce', () => {
    handlers['nub:side']!('left');
    expect(g.document.body.classList.contains('side-left')).toBe(true);
    handlers['nub:side']!('right');
    expect(g.document.body.classList.contains('side-left')).toBe(false);
  });
});

describe('idioma do nub', () => {
  it('abre no idioma do app (en) e troca na hora quando o main avisa', () => {
    nub.uiLanguage = 'en';
    g.document.documentElement.innerHTML = rendered('src/renderer/nub.html')
      .replace(/<script[^>]*><\/script>/g, '')
      .replace(/^[\s\S]*?<html[^>]*>/, '');
    for (const f of ['i18n', 'locales/pt-BR', 'locales/en', 'nub']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
    expect(g.document.querySelector('#stop [data-i18n="nub.stop"]').textContent).toBe('Stop');
    expect(g.document.getElementById('question').placeholder).toBe('Ask about the meeting…');
    expect(g.document.getElementById('chat').title).toBe('Ask about the meeting');
    handlers['ui:language']!('pt-BR');
    expect(g.document.querySelector('#stop [data-i18n="nub.stop"]').textContent).toBe('Parar');
    expect(g.document.getElementById('question').placeholder).toBe('Pergunte sobre a reunião…');
  });
});
