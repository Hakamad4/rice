/**
 * Opções da notificação nativa. No macOS os botões de ação funcionam ("Gravar", "Não perguntar para Zoom"). No Windows o Electron NÃO oferece
 * botões de ação nos avisos (toast): o aviso mostra título e uma linha dizendo o que o clique faz, e o clique faz a ação principal
 * (o `click` do main abre o Rice já com essa ação). A ação secundária (silenciar um app) só existe no Mac.
 */
export type NotificationInput = { title: string; actionText: string; secondaryText?: string; windows: boolean; clickHint: string };
export type NotificationOptions = { title: string; body?: string; actions?: Array<{ type: 'button'; text: string }> };

export function notificationOptions(o: NotificationInput): NotificationOptions {
  if (o.windows) return { title: o.title, body: o.clickHint };
  return { title: o.title, actions: [{ type: 'button', text: o.actionText }, ...(o.secondaryText ? [{ type: 'button' as const, text: o.secondaryText }] : [])] };
}
