import { t } from '../i18n';
import type { SessionState } from './meeting-session';

/** Chave usada em `pending` para o prompt de fim de reunião de um app. */
export const endKey = (app: string): string => `end:${app}`;

/** Navegadores usam o microfone para ditado, gravador de voz etc.: sem evidência de reunião, não perguntam (R-58). */
export const BROWSER_APPS: ReadonlySet<string> = new Set(['Google Chrome', 'Arc', 'Safari', 'Firefox', 'Microsoft Edge', 'Brave']);
export const isBrowserApp = (app: string): boolean => BROWSER_APPS.has(app);

/** Depois de dispensado, o mesmo app só volta a perguntar depois disto. */
export const PROMPT_COOLDOWN_MS = 20 * 60_000;

/**
 * Decisão final do convite de gravar, com o que se sabe do contexto: app silenciado pelo usuário, navegador sem
 * evidência (nenhum evento de agenda agora) e o intervalo mínimo entre convites do mesmo app.
 */
export function shouldOfferRecording(input: {
  app: string;
  muted: readonly string[];
  /** Há um evento da agenda acontecendo agora. */
  calendarEvidence: boolean;
  lastPromptAt: number | undefined;
  now: number;
}): boolean {
  if (input.muted.includes(input.app)) return false;
  if (isBrowserApp(input.app) && !input.calendarEvidence) return false;
  if (input.lastPromptAt !== undefined && input.now - input.lastPromptAt < PROMPT_COOLDOWN_MS) return false;
  return true;
}

export function shouldPromptStart(input: { state: SessionState; pending: Set<string>; key: string }): boolean {
  return input.state === 'idle' && !input.pending.has(input.key);
}

export function shouldPromptEnd(input: { state: SessionState; metaApp: string | undefined; app: string; pending: Set<string> }): boolean {
  return input.state === 'recording' && input.metaApp === input.app && !input.pending.has(endKey(input.app));
}

export function titleFor(input: { calendarTitle?: string | null; app: string }): string {
  const title = input.calendarTitle?.trim();
  return title ? title : t('meeting.app-title', { app: input.app });
}
