/** Regras do aviso visível de versão nova (Mac): quando notificar e quando a faixa fica escondida. A UI e a Notification ficam em quem chama. */
import type { UpdateState } from './check';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Depois" esconde a faixa por 24 h ou até aparecer um sha mais novo. */
export function isDismissed(state: Pick<UpdateState, 'sha' | 'dismissedSha' | 'dismissedAt'>, now: number): boolean {
  if (!state.sha || state.dismissedSha !== state.sha || !state.dismissedAt) return false;
  const at = Date.parse(state.dismissedAt);
  return !Number.isNaN(at) && at <= now && now - at < DAY_MS; // relógio que voltou atrás não esconde para sempre
}

/** Notifica uma vez por sha, nunca durante a gravação (o pedido fica para quando ela acabar, quem chama tenta de novo). */
export function shouldNotify(o: { available: boolean; state: Pick<UpdateState, 'sha' | 'notifiedSha'>; recording: boolean }): boolean {
  return o.available && Boolean(o.state.sha) && o.state.notifiedSha !== o.state.sha && !o.recording;
}

/** A faixa na janela: há versão nova, o "Depois" não vale mais e não há gravação. */
export function bannerVisible(o: { available: boolean; dismissed: boolean; recording: boolean }): boolean {
  return o.available && !o.dismissed && !o.recording;
}
