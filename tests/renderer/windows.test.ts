// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const read = (f: string) => readFileSync(`src/renderer/${f}`, 'utf8');
const load = (files: string[]) => {
  for (const f of files) new Function(read(`${f}.js`))();
};
const providers = (extra: Record<string, unknown> = {}) => ({
  'claude-sub': { connected: true, hasKey: true, detail: 'ok' },
  'claude-api': { connected: false, hasKey: false, detail: '' },
  'chatgpt-sub': { connected: false, hasKey: false, installed: false, detail: '' },
  'openai-api': { connected: false, hasKey: false, detail: '' },
  'gemini-api': { connected: false, hasKey: false, detail: '' },
  'opencode-sub': { connected: false, hasKey: false, installed: false, detail: '' },
  'agy-sub': { connected: false, hasKey: false, installed: false, detail: 'x' },
  ...extra,
});

describe('renderer no Windows (rice.platform = win32)', () => {
  it('o body ganha platform-win, sem o espaço dos semáforos; no Mac não ganha', () => {
    boot('win32');
    expect(g.document.body.classList.contains('platform-win')).toBe(true);
    expect(g.document.documentElement.style.getPropertyValue('--traffic')).toBe('12px');
    expect(g.document.documentElement.style.getPropertyValue('--overlay-r')).toBe('144px');
    boot('darwin');
    expect(g.document.body.classList.contains('platform-win')).toBe(false);
    expect(g.document.documentElement.style.getPropertyValue('--traffic')).toBe('92px');
  });

  it('textos que citam o macOS trocam por variante do Windows; no Mac ficam como estão', () => {
    boot('win32');
    const i18n = g.window.RiceI18n;
    expect(i18n.t('guide.folder.reveal')).toBe('Abrir no Explorador de Arquivos');
    expect(i18n.t('delete.text', { title: 'X' })).toContain('Lixeira do Windows');
    expect(i18n.t('guide.folder.reveal', undefined, 'en')).toBe('Open in File Explorer');
    expect(i18n.t('ai.cli.codex-missing')).not.toContain('brew');
    boot('darwin');
    expect(g.window.RiceI18n.t('guide.folder.reveal')).toBe('Abrir no Finder');
    expect(g.window.RiceI18n.t('ai.cli.codex-missing')).toContain('brew');
  });

  it('Antigravity aparece indisponível, com o motivo, sem passos nem botões', () => {
    boot('win32');
    load(['ai-providers']);
    const status = { active: 'claude-sub', models: {}, providers: providers({ 'agy-sub': { connected: false, hasKey: false, installed: false, unavailable: true, detail: 'O Antigravity só funciona no macOS.' } }) };
    const root = g.window.RiceAiProviders.render({ status, onChange: () => {} });
    const card = root.querySelector('[data-vendor="agy"]');
    expect(card.querySelector('.ai-card-state').textContent).toContain('Indisponível');
    expect(card.querySelector('.ai-detail').textContent).toContain('só funciona no macOS');
    expect(card.querySelector('.ai-steps')).toBeNull();
    expect(card.querySelector('button.primary, .ai-actions')).toBeNull();
    // os comandos do ChatGPT e do OpenCode não citam Homebrew nem curl | bash
    expect(root.textContent).not.toMatch(/brew install|curl -fsSL/);
  });

  it('Calendário: sem o do sistema, só o Google aparece (aberto)', () => {
    boot('win32');
    load(['calendar-connect']);
    const nodes = g.window.RiceCalendarConnect.render({ google: {}, eventKit: { access: 'unsupported' }, onChange: () => {} });
    const host = g.document.createElement('div');
    host.append(...nodes);
    expect(host.querySelector('[data-option="macos"]')).toBeNull();
    expect(host.querySelector('[data-option="google"]')?.classList.contains('open')).toBe(true);
  });

  it('Lembretes: acesso "unsupported" não desenha nada no Início', () => {
    boot('win32');
    load(['home']);
    const box = g.document.createElement('div');
    box.innerHTML = '<div class="reminders-slot"></div>';
    g.window.RiceHome.applyReminders(box, { access: 'unsupported', enabled: true, items: [{ id: '1', title: 'x' }] }, {});
    expect(box.querySelector('.reminders-slot')?.children.length).toBe(0);
  });

  it('CSS: botões nativos do Windows têm reserva à direita e o cabeçalho do chat não passa por baixo', () => {
    const html = read('index.html');
    expect(html).toMatch(/body\.platform-win:not\(\.chat-open\) #rec-bar \{ padding-right:calc\(20px \+ var\(--overlay-r\)\)/);
    expect(html).toMatch(/body\.platform-win\.chat-open \.chat-head \{ padding-right:calc\(16px \+ var\(--overlay-r\)\)/);
  });
});

describe('locales: variantes @win', () => {
  it('todas existem nos dois idiomas, têm a chave base e as mesmas variáveis', () => {
    const w: any = {};
    new Function('globalThis', 'window', read('i18n.js') + read('locales/pt-BR.js') + read('locales/en.js') + 'globalThis.__d = RiceI18n.dictionaries;').call(w, w, w);
    const d = w.__d ?? w.RiceI18n?.dictionaries;
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const win = Object.keys(d['pt-BR']).filter((k) => k.endsWith('@win'));
    expect(win.length).toBeGreaterThan(20);
    expect(Object.keys(d.en).filter((k) => k.endsWith('@win')).sort()).toEqual(win.sort());
    for (const k of win) for (const l of ['pt-BR', 'en']) {
      const base = k.slice(0, -4);
      expect(d[l][base], `${l} ${base}`).toBeTypeOf('string');
      expect(vars(d[l][k]), `${l} ${k}`).toBe(vars(d[l][base]));
    }
  });
});

function boot(platform: string) {
  vi.restoreAllMocks();
  return bootRenderer({ platform, remindersStatus: async () => ({ access: 'unsupported', enabled: false }) });
}

describe('atalhos no Windows: Ctrl no lugar de ⌘', () => {
  it('Ctrl+K foca a busca; ⌘K (meta) não; a dica mostra "Ctrl K"', async () => {
    boot('win32');
    await vi.waitFor(() => expect(g.document.getElementById('search-hint').textContent).toBe('Ctrl K'));
    const press = (init: any) => g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...init }));
    g.document.getElementById('search').blur();
    press({ metaKey: true });
    expect(g.document.activeElement).not.toBe(g.document.getElementById('search'));
    press({ ctrlKey: true });
    expect(g.document.activeElement).toBe(g.document.getElementById('search'));
  });
  it('no Mac continua ⌘K', () => {
    boot('darwin');
    expect(g.document.getElementById('search-hint').textContent).toBe('⌘K');
    g.document.getElementById('search').blur();
    g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(g.document.activeElement).not.toBe(g.document.getElementById('search'));
    g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    expect(g.document.activeElement).toBe(g.document.getElementById('search'));
  });
});
