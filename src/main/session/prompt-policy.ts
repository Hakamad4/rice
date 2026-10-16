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

/** Um convite sem resposta some sozinho da lista de pendentes depois disto (o macOS nem sempre emite 'close' quando o banner expira). */
export const PENDING_PROMPT_TTL_MS = 2 * 60_000;

/**
 * Convites em aberto (um por app) + o intervalo mínimo depois de uma recusa. Pendente expira sozinho (TTL) e é limpo ao fim da
 * gravação, então o convite da reunião seguinte volta sem reiniciar o Rice. O intervalo só vale para recusa explícita (fechar o aviso).
 */
export class PromptTracker {
  private readonly pendingAt = new Map<string, number>();
  private readonly declinedAt = new Map<string, number>();

  constructor(private readonly clock: () => number = Date.now, private readonly ttlMs: number = PENDING_PROMPT_TTL_MS) {}

  has(key: string): boolean {
    const at = this.pendingAt.get(key);
    if (at === undefined) return false;
    if (this.clock() - at < this.ttlMs) return true;
    this.pendingAt.delete(key);
    return false;
  }

  add(key: string): void {
    this.pendingAt.set(key, this.clock());
  }

  delete(key: string): void {
    this.pendingAt.delete(key);
  }

  /** O usuário fechou o aviso sem aceitar: o mesmo app respeita o intervalo mínimo. */
  declined(app: string): void {
    this.declinedAt.set(app, this.clock());
  }

  /** Aceitou o convite: nada a esperar para a próxima reunião do app. */
  accepted(app: string): void {
    this.declinedAt.delete(app);
  }

  lastDeclinedAt(app: string): number | undefined {
    return this.declinedAt.get(app);
  }

  /** Fim de uma gravação: os convites de início pendentes (chave = nome do app) caem; os de fim (`end:`) não. */
  recordingEnded(): void {
    for (const key of [...this.pendingAt.keys()]) if (!key.startsWith('end:')) this.pendingAt.delete(key);
  }
}

export function shouldPromptStart(input: { state: SessionState; pending: { has(key: string): boolean }; key: string }): boolean {
  return input.state === 'idle' && !input.pending.has(input.key);
}

export function shouldPromptEnd(input: { state: SessionState; metaApp: string | undefined; app: string; pending: { has(key: string): boolean } }): boolean {
  return input.state === 'recording' && input.metaApp === input.app && !input.pending.has(endKey(input.app));
}

export function titleFor(input: { calendarTitle?: string | null; app: string }): string {
  const title = input.calendarTitle?.trim();
  return title ? title : t('meeting.app-title', { app: input.app });
}
