import { describe, expect, test, vi } from 'vitest';
import { appPageOf, guardedIpc, lockdownWebContents, pageForChannel, trustedSender } from '../../src/main/app/hardening';

const DIR = '/Users/ana/dev/rice/src/renderer';
const page = (name: string, extra = '') => `file://${DIR}/${name}${extra}`;
const frame = (url: string, parent: unknown = null) => ({ senderFrame: { url, parent } });

describe('páginas do app', () => {
  test('só as três páginas locais; nada de outra pasta, outro esquema, ../ ou host', () => {
    expect(appPageOf(page('index.html'), DIR)).toBe('index.html');
    expect(appPageOf(page('nub.html', '#x'), DIR)).toBe('nub.html');
    expect(appPageOf(page('alert.html', '?a=1'), DIR)).toBe('alert.html');
    for (const bad of [
      'https://evil.example/index.html',
      'http://localhost/index.html',
      `file://${DIR}/../outra/index.html`,
      'file:///tmp/evil.html',
      `file://${DIR}/../../../tmp/index.html`,
      'file://evil-host/Users/ana/dev/rice/src/renderer/index.html',
      'data:text/html,<script>1</script>',
      'javascript:alert(1)',
      'about:blank',
      'não é url',
      `file://${DIR}/index.html.evil`,
    ]) expect(appPageOf(bad, DIR), bad).toBeNull();
  });
});

describe('IPC: quem pode falar em cada canal', () => {
  test('cada canal só aceita a página dele; i18n:language vale para as três', () => {
    expect(pageForChannel('nub:ask')).toBe('nub.html');
    expect(pageForChannel('alert:action')).toBe('alert.html');
    expect(pageForChannel('meetings:read')).toBe('index.html');
    expect(trustedSender(frame(page('index.html')), 'meetings:read', DIR)).toBe(true);
    expect(trustedSender(frame(page('nub.html')), 'meetings:read', DIR)).toBe(false); // o nub não lê reuniões
    expect(trustedSender(frame(page('index.html')), 'nub:ask', DIR)).toBe(false);
    expect(trustedSender(frame(page('nub.html')), 'nub:ask', DIR)).toBe(true);
    expect(trustedSender(frame(page('alert.html')), 'alert:action', DIR)).toBe(true);
    expect(trustedSender(frame(page('alert.html')), 'ai:save-key', DIR)).toBe(false);
    for (const p of ['index.html', 'nub.html', 'alert.html']) expect(trustedSender(frame(page(p)), 'i18n:language', DIR)).toBe(true);
  });

  test('recusa iframe, quadro destruído e página de fora', () => {
    expect(trustedSender(frame(page('index.html'), { any: 'parent' }), 'meetings:read', DIR)).toBe(false);
    expect(trustedSender({ senderFrame: null }, 'meetings:read', DIR)).toBe(false);
    expect(trustedSender({}, 'meetings:read', DIR)).toBe(false);
    expect(trustedSender(frame('https://evil.example/'), 'ai:save-key', DIR)).toBe(false);
  });

  test('guardedIpc: handler legítimo roda; remetente errado recebe erro e o handler NÃO roda; on síncrono devolve null', async () => {
    const handlers = new Map<string, (e: any, ...a: any[]) => unknown>();
    const listeners = new Map<string, (e: any, ...a: any[]) => void>();
    const ipc = { handle: (c: string, l: any) => handlers.set(c, l), on: (c: string, l: any) => listeners.set(c, l) };
    const { handle, on } = guardedIpc(ipc, DIR);
    const run = vi.fn((_e: unknown, x: number) => x * 2);
    handle('meetings:read', run);
    expect(await handlers.get('meetings:read')!(frame(page('index.html')), 21)).toBe(42);
    expect(() => handlers.get('meetings:read')!(frame('https://evil.example/'), 1)).toThrow('unauthorized IPC sender');
    expect(run).toHaveBeenCalledTimes(1);
    const sync = vi.fn();
    on('i18n:language', sync);
    const ok: any = frame(page('nub.html'));
    listeners.get('i18n:language')!(ok);
    expect(sync).toHaveBeenCalledTimes(1);
    const bad: any = frame('file:///tmp/evil.html');
    listeners.get('i18n:language')!(bad);
    expect(bad.returnValue).toBeNull();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe('lockdownWebContents', () => {
  test('bloqueia navegação e redirecionamento para fora do app, permite recarregar a própria página, nega janelas e webview', () => {
    const on = new Map<string, (...a: any[]) => void>();
    let open: (() => unknown) | undefined;
    lockdownWebContents({ on: (e, l) => on.set(e, l), setWindowOpenHandler: (h) => (open = h) }, DIR);
    const nav = (event: string, url: string) => {
      const e = { preventDefault: vi.fn() };
      on.get(event)!(e, url);
      return e.preventDefault.mock.calls.length > 0;
    };
    expect(nav('will-navigate', 'https://evil.example/')).toBe(true);
    expect(nav('will-navigate', 'file:///Users/ana/Downloads/malicioso.html')).toBe(true); // arquivo solto na janela
    expect(nav('will-redirect', 'https://evil.example/')).toBe(true);
    expect(nav('will-navigate', page('index.html'))).toBe(false);
    const attach = { preventDefault: vi.fn() };
    on.get('will-attach-webview')!(attach);
    expect(attach.preventDefault).toHaveBeenCalled();
    expect(open!()).toEqual({ action: 'deny' });
  });
});
