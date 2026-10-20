// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const g = globalThis as any;
const pack = (lang: string, mb: number, installed = false) => ({ lang, downloadBytes: mb * 1e6, diskBytes: mb * 1.5e6, installed });
const off = { state: 'not-installed', packs: [pack('pt', 100), pack('en', 0, true), pack('es', 90)], ramBytes: 600_000_000, enabled: true, localMode: false };
const view = (over: Record<string, unknown> = {}) => ({ dir: '/R/a', on: false, lang: 'en', from: 'pt', langs: ['pt', 'en', 'es'], offline: off, records: [], ...over });

function boot(rice: Record<string, unknown>) {
  const handlers: Record<string, (p: any) => any> = {};
  g.document.body.innerHTML = '';
  g.window.rice = { on: (c: string, fn: (p: any) => any) => (handlers[c] = fn), translateOfflineStatus: async () => off, ...rice };
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'action-menu', 'translate']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  g.window.RiceI18n.setLanguage?.('pt-BR');
  return handlers;
}
const row = (text: string) => {
  const p = g.document.createElement('p');
  p.className = 't-row other';
  p.innerHTML = `<span class="t-text">${text}</span>`;
  g.document.body.append(p);
  return p;
};

describe('tradução ao vivo na tela', () => {
  beforeEach(() => vi.useRealTimers());

  it('mostra a tradução em azul embaixo e a original em itálico, ao chegar e ao reabrir', async () => {
    const line = '**[10:00:01] Outros:** olá';
    const handlers = boot({ translateGet: async () => view({ on: true, records: [{ key: line, lang: 'en', text: 'hello', via: 'ai' }] }) });
    const t = g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => true, redraw: () => {} });
    await g.window.RiceTranslate.setDir('/R/a');
    const saved = row('olá');
    g.window.RiceTranslate.attach(line, saved);
    expect(saved.classList.contains('tr-orig')).toBe(true);
    expect(saved.querySelector('.t-tr').textContent).toBe('hello');
    const later = row('tudo bem');
    const key2 = '**[10:00:05] Outros:** tudo bem';
    g.window.RiceTranslate.attach(key2, later);
    expect(later.querySelector('.t-tr')).toBeNull();
    handlers['translate:result']!({ dir: '/R/a', key: key2, lang: 'en', text: 'all good', via: 'ai', ms: 900 });
    expect(later.querySelector('.t-tr').textContent).toBe('all good');
    handlers['translate:result']!({ dir: '/R/a', key: key2, lang: 'es', text: 'todo bien', via: 'ai', ms: 900 }); // outro idioma: ignorado
    expect(later.querySelector('.t-tr').textContent).toBe('all good');
    expect(t.node.hidden).toBe(false);
  });

  it('botão só aparece gravando; liga com um clique e mostra o idioma', async () => {
    const translateSet = vi.fn(async (_d: string, p: any) => view({ on: p.on }));
    boot({ translateGet: async () => view(), translateSet });
    let recording = false;
    const t = g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => recording, redraw: () => {} });
    g.document.body.append(t.node);
    await g.window.RiceTranslate.setDir('/R/a');
    expect(t.node.hidden).toBe(true);
    recording = true;
    g.window.RiceTranslate.paint();
    expect(t.node.hidden).toBe(false);
    expect(t.node.querySelector('.tr-btn').textContent).toContain('Tradução ao vivo');
    t.node.querySelector('.tr-btn').click();
    expect(translateSet).toHaveBeenCalledWith('/R/a', { on: true });
    await vi.waitFor(() => expect(t.node.querySelector('.tr-btn .tr-code').textContent).toBe('EN'));
    expect(t.node.querySelector('.tr-btn').getAttribute('aria-pressed')).toBe('true');
  });

  it('o menu "Traduzir para" não oferece o idioma da própria reunião', async () => {
    boot({ translateGet: async () => view({ langs: ['pt', 'en', 'es'] }) });
    const open = vi.fn();
    g.window.RiceActionMenu = { open };
    const t = g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => true, redraw: () => {} });
    await g.window.RiceTranslate.setDir('/R/a');
    t.node.querySelector('.tr-menu-btn').click();
    const labels = (open.mock.calls[0]![0] as any).items.filter((i: any) => i.checked !== undefined && !i.submenu).map((i: any) => i.label);
    expect(labels).toEqual(['English', 'Español']); // a reunião é em pt
  });

  it('aviso discreto oferece o download com o tamanho; dispensar some', async () => {
    const download = vi.fn(async () => ({ ok: true }));
    const handlers = boot({ translateGet: async () => view({ on: true }), translateOfflineDownload: download });
    const t = g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => true, redraw: () => {} });
    await g.window.RiceTranslate.setDir('/R/a');
    handlers['translate:notice']!({ dir: '/R/a', notice: 'offline-needed' });
    expect(t.note.querySelector('.tr-note').hidden).toBe(false);
    const btn = [...t.note.querySelectorAll('button')].find((b: any) => b.textContent.includes('Baixar o que falta'));
    expect(btn.textContent).toContain('100 MB'); // pt para en: só o pacote pt (o inglês é pivô, sem pacote)
    btn.click();
    expect(download).toHaveBeenCalledWith(['pt']);
    [...t.note.querySelectorAll('button')].find((b: any) => b.textContent === 'Dispensar')?.click();
    expect(t.note.querySelector('.tr-note').hidden).toBe(true);
  });

  it('Configurações: sem motor mostra "indisponível"; Modo local bloqueia o botão', async () => {
    boot({ translateGet: async () => view() });
    g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => false, redraw: () => {} });
    const stubbed = { ...off, packs: off.packs.map((p) => ({ ...p, downloadBytes: 0 })) };
    g.window.rice.translateOfflineStatus = async () => stubbed;
    const box = g.window.RiceTranslate.offlineControl();
    g.document.body.append(box);
    await vi.waitFor(() => expect(box.textContent).toContain('ainda não está disponível'));
    g.window.rice.translateOfflineStatus = async () => ({ ...off, localMode: true });
    const box2 = g.window.RiceTranslate.offlineControl();
    g.document.body.append(box2);
    await vi.waitFor(() => expect(box2.querySelector('.tr-off-actions button').disabled).toBe(true));
  });

  it('Configurações: escolher idiomas soma os tamanhos; instalados não contam; créditos em pt', async () => {
    const download = vi.fn(async () => ({ ok: true }));
    boot({ translateGet: async () => view(), translateOfflineDownload: download });
    g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => false, redraw: () => {} });
    g.window.rice.translateOfflineStatus = async () => ({ ...off, state: 'installed', packs: [pack('pt', 100, true), pack('en', 0, true), pack('es', 90)] });
    const box = g.window.RiceTranslate.offlineControl();
    g.document.body.append(box);
    await vi.waitFor(() => expect(box.querySelector('.tr-pack-size').textContent).toBe('Instalado'));
    const es = box.querySelector('#tr-pack-es');
    es.checked = true;
    es.dispatchEvent(new g.window.Event('change', { bubbles: true }));
    const go = box.querySelector('.tr-off-actions button');
    expect(go.textContent).toContain('90 MB');
    go.click();
    expect(download).toHaveBeenCalledWith(['es']);
    expect(box.querySelector('#tr-pack-en')).toBeNull(); // o inglês não tem pacote
    expect(box.textContent).toContain('De ou para o inglês, só o pacote do outro idioma');
    expect(g.window.RiceTranslate.credits().textContent).toContain('CC-BY-4.0');
  });

  it('chave OFFLINE_TRANSLATION desligada: menu sem modelo offline nem créditos, aviso sem download', async () => {
    const disabled = { ...off, enabled: false };
    const handlers = boot({ translateGet: async () => view({ on: true, offline: disabled }), translateOfflineStatus: async () => disabled });
    const t = g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => true, redraw: () => {} });
    await g.window.RiceTranslate.setDir('/R/a');
    expect(g.window.RiceTranslate.offlineEnabled()).toBe(false);
    const open = vi.spyOn(g.window.RiceActionMenu, 'open');
    t.node.querySelectorAll('button')[1].click();
    const text = JSON.stringify((open.mock.calls[0]![0] as any).items);
    expect(text).not.toMatch(/offline|crédito|Crédito|download/i);
    expect(text).toContain('English');
    handlers['translate:notice']!({ dir: '/R/a', notice: 'ai-unavailable' });
    expect(t.note.querySelector('.tr-note').textContent).toContain('a tradução volta quando a IA responder');
    expect([...t.note.querySelectorAll('.tr-note button')].map((b: any) => b.textContent)).toEqual(['Dispensar']);
    handlers['translate:notice']!({ dir: '/R/a', notice: 'local-mode-ai-only' });
    expect(t.note.querySelector('.tr-note').textContent).toContain('só funciona com uma IA local');
  });

  describe('menu com a chave ligada', () => {
    const menu = async (over: Record<string, unknown> = {}, rice: Record<string, unknown> = {}, offlineView: Record<string, unknown> = {}) => {
      const o = { ...off, ...offlineView };
      const handlers = boot({ translateGet: async () => view({ on: true, offline: o, ...over }), translateOfflineStatus: async () => o, ...rice });
      const t = g.window.RiceTranslate.init({ rice: g.window.rice, follow: (fn: () => void) => fn(), isRecording: () => true, redraw: () => {} });
      await g.window.RiceTranslate.setDir('/R/a');
      t.node.querySelectorAll('button')[1].click();
      return { handlers, reopen: () => t.node.querySelectorAll('button')[1].click(), popover: () => g.document.querySelector('.action-menu') as any, close: () => g.window.RiceActionMenu.close() };
    };
    const rowOf = (m: any, name: string) => [...m.popover().querySelectorAll('.action-item')].find((r: any) => r.querySelector('.action-label').textContent === name) as any;

    it('cada idioma é uma linha simples; à direita só o ícone de baixar e o tamanho; o detalhe vai no tooltip', async () => {
      const m = await menu();
      expect(m.popover().textContent).not.toContain('Português'); // o idioma da reunião não aparece
      expect(m.popover().textContent).not.toContain('Baixar para usar offline'); // sem o texto repetido na linha
      expect(m.popover().textContent).toContain('Traduzindo com a IA configurada');
      const es = rowOf(m, 'Español').querySelector('.action-trail');
      expect(es.textContent).toBe('190 MB');
      expect(es.title).toContain('pt + es · 190 MB');
      expect(es.getAttribute('aria-label')).toBe(es.title);
      expect(rowOf(m, 'English').querySelector('.action-trail').textContent).toBe('100 MB'); // de/para o inglês: só o outro pacote
      expect(rowOf(m, 'English').querySelector('.action-trail').title).toContain('pt · 100 MB');
      expect(m.popover().querySelectorAll('.action-item').length).toBe(3); // 2 idiomas da fixture + créditos
      m.close();
    });

    it('clicar no ícone baixa só aquele par e não troca o idioma; com o outro pacote já instalado o tamanho cai', async () => {
      const download = vi.fn(async () => ({ ok: true }));
      const set = vi.fn(async () => view());
      const m = await menu({}, { translateOfflineDownload: download, translateSet: set }, { packs: [pack('pt', 100, true), pack('en', 0, true), pack('es', 90)] });
      const btn = rowOf(m, 'Español').querySelector('.action-trail');
      expect(btn.textContent).toBe('90 MB');
      btn.click();
      expect(download).toHaveBeenCalledWith(['es']);
      expect(set).not.toHaveBeenCalled();
      expect(g.document.querySelector('.action-menu')).toBeNull();
    });

    it('par pronto mostra "Offline" no lugar do ícone; apagar fica num item no fim; o motor muda', async () => {
      const del = vi.fn(async () => ({ ok: true }));
      const m = await menu({}, { translateOfflineDelete: del }, { state: 'installed', packs: [pack('pt', 100, true), pack('en', 0, true), pack('es', 90)] });
      expect(rowOf(m, 'English').querySelector('.action-hint').textContent).toBe('Offline');
      expect(rowOf(m, 'English').querySelector('.action-trail')).toBeNull();
      expect(m.popover().textContent).toContain('Traduzindo offline');
      const del1 = rowOf(m, 'Apagar idioma baixado');
      expect(del1).toBeTruthy();
      del1.click(); // abre o submenu com os idiomas baixados
      const sub = g.document.querySelector('.action-menu.submenu');
      expect(sub.textContent).toContain('Português');
      [...sub.querySelectorAll('.action-item')][0].click();
      expect(del).toHaveBeenCalledWith(['pt']);
    });

    it('o motor mostrado acompanha o último trecho traduzido (IA configurada ou offline)', async () => {
      const m = await menu();
      expect(m.popover().textContent).toContain('Traduzindo com a IA configurada');
      m.close();
      m.handlers['translate:result']!({ dir: '/R/a', key: 'k', lang: 'en', text: 'x', via: 'offline', ms: 1 });
      m.reopen();
      expect(g.document.querySelector('.action-menu').textContent).toContain('Traduzindo offline');
    });

    it('baixando: o ícone vira a % e clicar cancela; Modo local bloqueia o botão', async () => {
      const cancel = vi.fn(async () => ({ ok: true }));
      const a = await menu({}, { translateOfflineCancel: cancel }, { state: 'downloading', progress: { receivedBytes: 40, totalBytes: 100 } });
      const trail = rowOf(a, 'English').querySelector('.action-trail');
      expect(trail.textContent).toBe('40%');
      expect(trail.title).toBe('Cancelar download');
      trail.click();
      expect(cancel).toHaveBeenCalled();
      const b = await menu({}, {}, { localMode: true });
      expect(rowOf(b, 'English').querySelector('.action-trail').disabled).toBe(true);
    });

    it('em inglês o tooltip e o motor saem em inglês', async () => {
      const m = await menu();
      m.close();
      g.window.RiceI18n.setLanguage('en');
      m.reopen();
      expect(g.document.querySelector('.action-menu').textContent).toContain('Translating with the configured AI');
      expect(rowOf(m, 'Español').querySelector('.action-trail').title).toContain('Download to use offline: pt + es · 190 MB');
    });
  });

  it('coluna estreita: o botão largo é escondido com especificidade maior que `.tr-split` (senão aparece junto do estreito)', () => {
    const css = readFileSync('src/renderer/index.html', 'utf8');
    expect(css).toMatch(/@container detail \(max-width: 460px\) \{ \.tr-split\.tr-split-wide \{ display:none; \}/);
    expect(css).toMatch(/\.tr-below \.tr-split-narrow \{ display:none; \}/); // acima de 460 px só o largo
  });

  it('botão na linha das abas: mesma altura dos botões-pílula (--h-lg) e linha com respiro, texto das abas centrado nele', () => {
    const css = readFileSync('src/renderer/index.html', 'utf8');
    expect(css).toMatch(/\.tr-split \{[^}]*height:var\(--h-lg\)/);
    expect(css).toMatch(/\.mt-tabs:has\(> \.tr-split-wide:not\(\[hidden\]\)\) \{ min-height:calc\(var\(--h-lg\) \+ var\(--space-2\) \* 2\); \}/);
    expect(css).toMatch(/\.mt-tab \{ display:inline-flex; align-items:center; padding-bottom:0; \}/);
  });
});
