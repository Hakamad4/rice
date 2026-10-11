import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/**
 * Endurecimento do Electron (auditoria de segurança): o app só carrega as três páginas locais, nunca navega para fora,
 * não abre janelas novas, nega toda permissão de página e só aceita IPC vindo da página certa.
 */
export const APP_PAGES = ['index.html', 'nub.html', 'alert.html'] as const;
export type AppPage = (typeof APP_PAGES)[number];

/** URL `file://` de uma página do app dentro de `rendererDir` (sem aceitar `..`, outra pasta nem outro esquema). */
export function appPageUrl(rendererDir: string, page: AppPage): string {
  return pathToFileURL(join(rendererDir, page)).href;
}

/** `file://<rendererDir>/<página>` (com `?`/`#` opcionais): só as páginas do app. Devolve qual é, ou `null`. */
export function appPageOf(url: string, rendererDir: string): AppPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') return null;
  for (const page of APP_PAGES) {
    const expected = new URL(appPageUrl(rendererDir, page));
    if (parsed.pathname === expected.pathname && parsed.host === expected.host) return page;
  }
  return null;
}

/** Que página pode falar em cada canal de IPC: `nub:*` só o nub, `alert:*` só o aviso, o resto só a janela principal. */
export function pageForChannel(channel: string): AppPage {
  if (channel.startsWith('nub:')) return 'nub.html';
  if (channel.startsWith('alert:')) return 'alert.html';
  return 'index.html';
}

/** Canais síncronos lidos pelos preloads das três janelas (idioma). */
const ANY_PAGE = new Set(['i18n:language']);

type SenderEvent = { senderFrame?: { url: string; parent: unknown } | null };

/** O IPC veio do quadro principal (não de iframe) da página esperada para o canal? */
export function trustedSender(event: SenderEvent, channel: string, rendererDir: string): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  const page = appPageOf(frame.url, rendererDir);
  if (!page) return false;
  return ANY_PAGE.has(channel) || page === pageForChannel(channel);
}

type IpcMainLike = {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
  on(channel: string, listener: (event: any, ...args: any[]) => void): void;
};

/** `ipcMain.handle`/`on` que recusam remetente que não seja a página esperada (defesa em profundidade: o conteúdo só é local). */
export function guardedIpc(ipc: IpcMainLike, rendererDir: string): { handle: IpcMainLike['handle']; on: IpcMainLike['on'] } {
  return {
    handle: (channel, listener) =>
      ipc.handle(channel, (event, ...args) => {
        if (!trustedSender(event, channel, rendererDir)) throw new Error('unauthorized IPC sender');
        return listener(event, ...args);
      }),
    on: (channel, listener) =>
      ipc.on(channel, (event, ...args) => {
        if (!trustedSender(event, channel, rendererDir)) {
          event.returnValue = null; // `sendSync` não pode ficar esperando
          return;
        }
        listener(event, ...args);
      }),
  };
}

type WebContentsLike = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
};

/**
 * Trava um `webContents`: sem navegação para fora das páginas do app (soltar um arquivo na janela, link ou redirecionamento
 * não carregam nada, e portanto nada de página remota com acesso à API `window.rice`), sem janelas novas e sem `<webview>`.
 */
export function lockdownWebContents(wc: WebContentsLike, rendererDir: string): void {
  const block = (event: { preventDefault(): void }, url: string) => {
    if (!appPageOf(url, rendererDir)) event.preventDefault();
  };
  wc.on('will-navigate', block);
  wc.on('will-redirect', block);
  wc.on('will-attach-webview', (event: { preventDefault(): void }) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}
