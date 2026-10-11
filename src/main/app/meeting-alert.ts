import { alertKey, scheduleFor, type AlertPlan, type CalEvent } from '../calendar/google-events';
import type { Rect } from './nub';

export const ALERT_WIDTH = 400;
export const ALERT_HEIGHT = 96;
const ALERT_RIGHT_INSET = 8; // 408 = largura + folga
const ALERT_GAP = 8;
const ALERT_TOP = 8;

/** Posição do aviso `index` (0 = topo): canto superior direito da área útil, empilhando para baixo. */
export function alertPosition(workArea: Rect, index: number): { x: number; y: number } {
  return { x: workArea.x + workArea.width - (ALERT_WIDTH + ALERT_RIGHT_INSET), y: workArea.y + ALERT_TOP + index * (ALERT_HEIGHT + ALERT_GAP) };
}

/** Só links https abrem no navegador (nunca file:, javascript:, etc.). */
export function isHttpsUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export type AlertHandle = { close(): void };
export type AlertSchedulerDeps = {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  isRecording(): boolean;
  show(plan: AlertPlan): AlertHandle;
};

type Shown = { event: CalEvent; handle: AlertHandle; hideTimer: unknown };

/** Agenda os avisos "vai começar": um por evento, reagenda se o horário muda, cancela se o evento some. */
export class AlertScheduler {
  private readonly done = new Set<string>(); // chaves já exibidas (ou puladas): dedupe
  private readonly pending = new Map<string, { plan: AlertPlan; timer: unknown }>();
  private readonly open = new Map<string, Shown>();

  constructor(private readonly deps: AlertSchedulerDeps) {}

  /** Chamar sempre que a lista de eventos mudar. */
  update(events: CalEvent[]): void {
    const plans = scheduleFor(events, this.deps.now(), this.done);
    const wanted = new Set(plans.map((p) => p.key));
    for (const [key, p] of this.pending) {
      if (!wanted.has(key)) {
        this.deps.clearTimer(p.timer);
        this.pending.delete(key);
      }
    }
    // aviso na tela cujo evento foi apagado ou mudou de horário
    const live = new Map(events.map((e) => [alertKey(e), e]));
    for (const key of [...this.open.keys()]) if (!live.has(key)) this.dismiss(key);
    for (const plan of plans) {
      if (this.pending.has(plan.key)) continue;
      const delay = plan.showAt - this.deps.now();
      if (delay <= 0) this.fire(plan);
      else this.pending.set(plan.key, { plan, timer: this.deps.setTimer(() => this.fire(plan), delay) });
    }
  }

  /** Fecha o aviso (× ou ação). O evento continua marcado como já avisado. */
  dismiss(key: string): void {
    const shown = this.open.get(key);
    if (!shown) return;
    this.open.delete(key);
    this.deps.clearTimer(shown.hideTimer);
    shown.handle.close();
  }

  /** Aviso aberto cujo identificador `key` (para ações vindas da janela). */
  eventFor(key: string): CalEvent | undefined {
    return this.open.get(key)?.event;
  }

  dispose(): void {
    for (const p of this.pending.values()) this.deps.clearTimer(p.timer);
    this.pending.clear();
    for (const key of [...this.open.keys()]) this.dismiss(key);
  }

  private fire(plan: AlertPlan): void {
    this.pending.delete(plan.key);
    if (this.done.has(plan.key)) return;
    this.done.add(plan.key);
    if (this.deps.isRecording()) return; // já está gravando: não incomoda
    const handle = this.deps.show(plan);
    const hideTimer = this.deps.setTimer(() => this.dismiss(plan.key), Math.max(0, plan.hideAt - this.deps.now()));
    this.open.set(plan.key, { event: plan.event, handle, hideTimer });
  }
}
