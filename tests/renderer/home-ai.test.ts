// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const css = [...readFileSync('src/renderer/index.html', 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const now = new Date().toISOString();
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: now, state: 'done', notesStatus: 'done' }];
const status = (over: Record<string, any> = {}) => ({ active: 'claude-sub', models: {}, providers: { 'claude-sub': { connected: false, hasKey: false, detail: 'x' }, 'opencode-sub': { connected: false, installed: true, detail: 'x' } }, ...over });
const home = async (aiStatus: () => Promise<unknown>, extra: Record<string, unknown> = {}) => {
  const out = bootRenderer({ aiStatus, asrStatus: async () => ({ state: 'ready' }), permissionStatus: async () => ({ microphone: 'granted' }), ...extra }, MEETINGS);
  await vi.waitFor(() => expect(g.document.getElementById('home-ask-input')).not.toBeNull());
  return out;
};

it('sem IA configurada: cartão "Configure sua IA" no topo do Início, com Configurar; o campo de perguntas fica desabilitado com a dica', async () => {
  await home(async () => status());
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice')).not.toBeNull());
  const card = g.document.querySelector('.ai-notice');
  expect(card.parentElement.className).toBe('ai-notice-slot');
  expect(g.document.querySelector('.page').firstElementChild).toBe(card.parentElement); // no TOPO
  expect(card.querySelector('svg.icon-plug')).not.toBeNull();
  expect(card.querySelector('strong').textContent).toBe('Configure sua IA');
  expect(card.querySelector('p').textContent).toBe('Escolha a IA e o modelo que vão escrever as notas e responder às perguntas.');
  expect(card.querySelector('button').textContent).toBe('Configurar');
  expect(card.querySelector('button').className).toBe('btn primary');
  const input = g.document.getElementById('home-ask-input');
  expect(input.disabled).toBe(true);
  expect(input.closest('.home-ask').title).toBe('Configure uma IA para perguntar');
  expect(input.closest('.home-ask').classList.contains('disabled')).toBe(true);
});

it('Configurar abre Configurações na seção de IA, com o provedor sugerido (o ativo) já aberto', async () => {
  const { rice } = await home(async () => status({ active: 'chatgpt-sub', providers: { 'chatgpt-sub': { connected: false, installed: true, detail: 'x' } } }));
  void rice;
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice button')).not.toBeNull());
  g.document.querySelector('.ai-notice button').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .ai-card.open')).not.toBeNull());
  expect(g.document.querySelector('h1').textContent).toBe('Configurações');
  expect(g.document.querySelector('.settings-page .ai-card.open').dataset.vendor).toBe('chatgpt');
});

it('com IA verificada o cartão não aparece e o campo funciona', async () => {
  await home(async () => status({ providers: { 'claude-sub': { connected: true, hasKey: true, detail: 'Conectado.' } } }));
  await new Promise((r) => setTimeout(r, 30));
  expect(g.document.querySelector('.ai-notice')).toBeNull();
  expect(g.document.getElementById('home-ask-input').disabled).toBe(false);
});

it('a IA ativa falhou no último teste: o cartão aparece mesmo havendo outra conectada', async () => {
  await home(async () => status({ providers: { 'claude-sub': { connected: false, verified: false, detail: 'x' }, 'chatgpt-sub': { connected: true, detail: 'ok' } } }));
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice')).not.toBeNull());
});

it('modelo gratuito do OpenCode: aviso menor, sem bloquear o campo, com "Trocar modelo"', async () => {
  await home(async () => status({ active: 'opencode-sub', models: { 'opencode-sub': 'opencode/big-pickle' }, providers: { 'opencode-sub': { connected: true, installed: true, loggedIn: false, detail: 'x' } } }));
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice.small')).not.toBeNull());
  const note = g.document.querySelector('.ai-notice.small');
  expect(note.textContent).toContain('modelo gratuito do OpenCode');
  expect(note.querySelector('button').textContent).toBe('Trocar modelo');
  expect(g.document.getElementById('home-ask-input').disabled).toBe(false); // não bloqueante
  expect(g.document.querySelector('.ai-notice:not(.small)')).toBeNull();
});

it('o Início aparece sem esperar o status das IAs (que pode demorar)', async () => {
  let release: (v: unknown) => void = () => {};
  const slow = new Promise((r) => (release = r));
  await home(() => slow as Promise<unknown>);
  expect(g.document.querySelector('.home-ask')).not.toBeNull();
  expect(g.document.querySelector('.ai-notice')).toBeNull();
  release(status());
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice')).not.toBeNull());
});

it('em inglês e com CSS discreto e responsivo', async () => {
  await home(async () => status(), { uiLanguage: 'en', getSettings: async () => ({ root: '/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'en', keepAudio: true }) });
  g.window.RiceI18n.setLanguage('en');
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice')).not.toBeNull());
  expect(css).toMatch(/\.ai-notice \{[^}]*border-radius:12px[^}]*background:var\(--hover\)/);
  expect(css).toMatch(/@container detail \(max-width: 560px\) \{ \.ai-notice:not\(\.small\) \{ flex-direction:column; align-items:flex-start/);
  expect(css).toMatch(/@container detail \(max-width: 420px\) \{\s*\.ai-head \{ display:grid/); // lista de IAs: nome em cima, estado embaixo
  g.window.RiceI18n.setLanguage('pt-BR');
});
