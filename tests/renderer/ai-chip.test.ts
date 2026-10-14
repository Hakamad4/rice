// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer, type } from '../helpers/boot-renderer';

const g = globalThis as any;
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done' }];
const provider = (connected: boolean, extra: Record<string, unknown> = {}) => ({ installed: true, hasKey: false, connected, detail: '', ...extra });

type Opts = { active?: string; models?: Record<string, string>; providers?: Record<string, unknown>; catalogs?: Record<string, unknown[]>; extra?: Record<string, unknown> };

function boot(opts: Opts = {}) {
  let status: any = {
    active: opts.active ?? 'claude-sub',
    models: { ...(opts.models ?? {}) },
    providers: opts.providers ?? { 'claude-sub': provider(true), 'chatgpt-sub': provider(true), 'opencode-sub': provider(false, { loggedIn: false }) },
  };
  const catalogs: Record<string, unknown[]> = opts.catalogs ?? {
    'claude-sub': [{ id: '', label: '' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }],
    'chatgpt-sub': [{ id: '', label: '' }, { id: 'gpt-5.5', label: 'gpt-5.5' }],
    'opencode-sub': [{ id: '', label: '' }, { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' }, { id: 'opencode/big-pickle', label: 'opencode/big-pickle', free: true }],
  };
  const out = bootRenderer(
    {
      aiStatus: vi.fn(async () => JSON.parse(JSON.stringify(status))),
      aiModelCatalog: vi.fn(async (p: string) => ({ ok: true, models: catalogs[p] ?? [] })),
      setAiProvider: vi.fn(async (p: string) => { status.active = p; return { ok: true }; }),
      setAiModel: vi.fn(async (p: string, m: string) => { if (m) status.models[p] = m; else delete status.models[p]; return { ok: true }; }),
      globalHistory: vi.fn(async () => []),
      ...(opts.extra ?? {}),
    },
    MEETINGS,
  );
  return { ...out, setStatus: (fn: (s: any) => void) => fn(status) };
}

const chip = () => g.document.getElementById('ai-via') as any;
const menu = () => g.document.querySelector('.action-menu') as any;
const labels = () => [...menu().querySelectorAll('.action-label')].map((n: any) => n.textContent);
const heads = () => [...menu().querySelectorAll('.menu-head')].map((n: any) => n.textContent);
const item = (label: string) => [...menu().querySelectorAll('.action-item')].find((n: any) => n.querySelector('.action-label').textContent === label) as any;

it('o chip mostra o provedor e a família do modelo ("Claude · Sonnet"); sem escolha, "Padrão"; API usa o padrão dela', async () => {
  boot({ models: { 'claude-sub': 'claude-sonnet-5-5' } });
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude · Sonnet'));
  expect(chip().querySelector('.provider-logo.logo-claude')).not.toBeNull();
  expect(chip().querySelector('.icon-chevron-down')).not.toBeNull();
  boot({});
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude · Padrão'));
  boot({ active: 'claude-api', providers: { 'claude-api': provider(true) } });
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude (API) · Sonnet'));
  boot({ active: 'gemini-api', models: { 'gemini-api': 'gemini-2.5-pro' }, providers: { 'gemini-api': provider(true) } });
  await vi.waitFor(() => expect(chip().textContent).toBe('Gemini (API) · Pro'));
});

it('menu: só os provedores configurados têm modelos (o ativo primeiro, com ✓ no atual); os demais ficam no fim, esmaecidos, com "Configurar…"', async () => {
  boot({ active: 'chatgpt-sub', models: { 'chatgpt-sub': 'gpt-5.5' } });
  await vi.waitFor(() => expect(chip().textContent).toContain('ChatGPT'));
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(heads()).toEqual(['ChatGPT', 'Claude']); // ativo primeiro; Gemini e OpenCode não configurados não ganham cabeçalho
  expect(labels()).toEqual(['Padrão', 'gpt-5.5', 'Padrão', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Google Gemini', 'OpenCode', 'Antigravity', 'Modelo local']);
  expect(item('gpt-5.5').getAttribute('aria-checked')).toBe('true');
  expect(item('Padrão').getAttribute('aria-checked')).toBeNull();
  const missing = [...menu().querySelectorAll('.action-item.muted')];
  expect(missing.map((n: any) => n.querySelector('.action-label').textContent)).toEqual(['Google Gemini', 'OpenCode', 'Antigravity', 'Modelo local']);
  expect(missing.every((n: any) => n.querySelector('.action-hint').textContent === 'Configurar…')).toBe(true);
  expect(menu().textContent).toContain('Também usado nas notas.');
});

it('escolher um modelo troca a IA E o modelo ativos do app (mesma configuração de Configurações > IA) e o chip atualiza', async () => {
  const { rice } = boot({ active: 'chatgpt-sub', models: { 'chatgpt-sub': 'gpt-5.5' } });
  const changed = vi.fn();
  g.window.addEventListener('rice:ai-changed', changed);
  await vi.waitFor(() => expect(chip().textContent).toContain('ChatGPT'));
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  [...menu().querySelectorAll('.action-item')].filter((n: any) => n.querySelector('.action-label').textContent === 'Opus 5.5')[0].click();
  await vi.waitFor(() => expect(rice.setAiProvider).toHaveBeenCalledWith('claude-sub'));
  expect(rice.setAiModel).toHaveBeenCalledWith('claude-sub', 'claude-opus-5-5');
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude · Opus'));
  expect(changed).toHaveBeenCalled();
  expect(g.document.querySelector('.action-menu')).toBeNull(); // o menu fecha
});

it('voltar ao "Padrão" limpa o modelo salvo; escolher o que já está salvo não regrava', async () => {
  const { rice } = boot({ active: 'claude-sub', models: { 'claude-sub': 'claude-opus-5-5' } });
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude · Opus'));
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  item('Opus 5.5').click(); // já é o atual
  await vi.waitFor(() => expect(rice.setAiProvider).toHaveBeenCalled());
  expect(rice.setAiModel).not.toHaveBeenCalled();
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  [...menu().querySelectorAll('.action-item')].find((n: any) => n.querySelector('.action-label').textContent === 'Padrão').click();
  await vi.waitFor(() => expect(rice.setAiModel).toHaveBeenCalledWith('claude-sub', ''));
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude · Padrão'));
});

it('"Configurar…" leva a Configurações > IA (o passo de provedores)', async () => {
  boot({ extra: { asrStatus: async () => ({ state: 'ready' }), permissionStatus: async () => ({ microphone: 'granted' }), listAiModels: async () => ({ ok: true, models: [] }) } });
  await vi.waitFor(() => expect(chip().textContent).toContain('Claude'));
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  item('Google Gemini').click();
  await vi.waitFor(() => expect(g.document.getElementById('guide-link').classList.contains('active')).toBe(true));
});

it('OpenCode: o gratuito é uma opção explícita rotulada e, selecionado, o menu mostra o aviso de privacidade', async () => {
  boot({
    active: 'opencode-sub',
    models: { 'opencode-sub': 'opencode/big-pickle' },
    providers: { 'opencode-sub': provider(true, { loggedIn: true }) },
  });
  await vi.waitFor(() => expect(chip().textContent).toBe('OpenCode · Zen grátis'));
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(labels()).toEqual(['Padrão', 'anthropic/claude-sonnet-4-5', 'Gratuito (OpenCode Zen)', 'Claude', 'ChatGPT', 'Google Gemini', 'Antigravity', 'Modelo local']);
  expect(item('Gratuito (OpenCode Zen)').getAttribute('aria-checked')).toBe('true');
  expect(menu().textContent).toContain('pode usar suas transcrições');
});

it('desabilitado durante a resposta (chat de todas as reuniões): não abre o menu e volta ao terminar', async () => {
  let release!: () => void;
  const askGlobal = vi.fn(() => new Promise((resolve) => { release = () => resolve({ ok: true, answer: 'ok', citations: [] }); }));
  boot({ extra: { askGlobal } });
  await vi.waitFor(() => expect(chip().textContent).toContain('Claude'));
  g.document.getElementById('question').focus();
  g.document.querySelector('[data-icon="message-circle"]')?.click?.();
  // abre o chat entre reuniões pelo atalho do Início
  const home = g.document.querySelector('#home-ask, .home-ask input, input[placeholder*="Pergunte sobre suas reuniões"]') as any;
  if (home) {
    type(home, 'e agora?');
    home.form?.dispatchEvent(new g.window.Event('submit', { bubbles: true, cancelable: true }));
  } else {
    type(g.document.getElementById('question'), 'e agora?');
    g.document.getElementById('ask').dispatchEvent(new g.window.Event('submit', { bubbles: true, cancelable: true }));
  }
  await vi.waitFor(() => expect(askGlobal).toHaveBeenCalled());
  expect(chip().disabled).toBe(true);
  expect(chip().title).toBe('Disponível quando a resposta terminar');
  chip().click();
  expect(g.document.querySelector('.action-menu')).toBeNull();
  release();
  await vi.waitFor(() => expect(chip().disabled).toBe(false));
});

it('em inglês: textos do menu e do chip traduzidos', async () => {
  boot({});
  g.window.RiceI18n.setLanguage('en');
  await vi.waitFor(() => expect(chip().textContent).toBe('Claude · Default'));
  chip().click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(menu().textContent).toContain('Also used for notes.');
  expect([...menu().querySelectorAll('.action-hint')].map((n: any) => n.textContent)).toEqual(['Set up…', 'Set up…', 'Set up…', 'Set up…']);
  expect(chip().title).toContain('Change the AI and model');
});
