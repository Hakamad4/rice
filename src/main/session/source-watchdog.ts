import type { AudioSource } from '../../shared/frames';

/**
 * Vigia das fontes de áudio (R-07/R-10): uma fonte "viva" entrega blocos continuamente e, no caso do microfone, nunca
 * produz zeros exatos por muito tempo. Máquina de estados pura (o relógio entra por parâmetro) para ser testada com tempo
 * simulado. Quem usa decide o que fazer com os eventos (aviso, lacuna, reinício da captura).
 */
export type WatchdogConfig = {
  /** Sem nenhum bloco da fonte por este tempo = travada/permissão revogada (padrão 7 s). */
  stallMs: number;
  /**
   * Zeros exatos por este tempo = sem sinal. Só vale para o microfone (30 s): zeros exatos no áudio do SISTEMA são o caso
   * normal (reunião presencial, os outros no mudo, intervalo), então para ele só conta "nenhum bloco chegando" (`Infinity`).
   */
  silenceMs: Record<AudioSource, number>;
  /** Reinícios por episódio de queda de blocos antes de desistir (padrão 5), com espera crescente. */
  maxStallRestarts: number;
  /** Reinícios por episódio de silêncio exato do microfone (padrão 1: volume 0 ou mudo de hardware também é escolha do usuário). */
  maxSilenceRestarts: number;
  /** Esperas entre reinícios consecutivos (ms); a última se repete. */
  backoffMs: number[];
  /** Tempo para a captura recém-reiniciada começar a entregar blocos (padrão 5 s). */
  graceMs: number;
};

export const DEFAULT_WATCHDOG: WatchdogConfig = {
  stallMs: 7000,
  silenceMs: { mic: 30_000, sys: Infinity },
  maxStallRestarts: 5,
  maxSilenceRestarts: 1,
  backoffMs: [0, 2000, 4000, 8000, 16_000],
  graceMs: 5000,
};

export type WatchdogEvent =
  /** A fonte parou de entregar blocos (`since` = último bloco, ou o início da captura). */
  | { type: 'stalled'; source: AudioSource; since: number }
  /** Zeros exatos por tempo demais (`since` = início do silêncio). */
  | { type: 'silent'; source: AudioSource; since: number }
  /** Voltou a entregar sinal. `gapFrom` = quando caiu (para registrar a lacuna). */
  | { type: 'recovered'; source: AudioSource; gapFrom: number | null }
  /** Pede o reinício da captura. */
  | { type: 'restart'; reason: 'stalled' | 'silent'; source: AudioSource; attempt: number }
  /** Esgotou os reinícios: aviso persistente (com atalho para a permissão). */
  | { type: 'failed'; source: AudioSource; reason: 'stalled' | 'silent' };

type SourceState = {
  expected: boolean;
  lastFrameAt: number;
  zeroSince: number | null;
  state: 'ok' | 'stalled' | 'silent';
  /** Início do episódio atual (para a lacuna). */
  episodeFrom: number | null;
  restarts: number;
  nextRestartAt: number;
  failed: boolean;
};

export class SourceWatchdog {
  private readonly cfg: WatchdogConfig;
  private readonly src: Record<AudioSource, SourceState>;

  constructor(config: Partial<WatchdogConfig> = {}) {
    this.cfg = { ...DEFAULT_WATCHDOG, ...config, silenceMs: { ...DEFAULT_WATCHDOG.silenceMs, ...config.silenceMs } };
    this.src = { mic: this.fresh(0), sys: this.fresh(0) };
  }

  private fresh(now: number): SourceState {
    return { expected: true, lastFrameAt: now, zeroSince: null, state: 'ok', episodeFrom: null, restarts: 0, nextRestartAt: 0, failed: false };
  }

  /** Uma captura (re)começou: o tempo de espera por blocos recomeça, mas o episódio de queda continua contado. */
  captureStarted(now: number): void {
    for (const s of Object.values(this.src)) {
      s.lastFrameAt = now + this.cfg.graceMs - this.cfg.stallMs; // dá `graceMs` até o próximo "travou"
      s.zeroSince = null;
    }
  }

  /** `source: undefined` = todas as fontes. A fonte deixa de ser vigiada (ex.: o usuário só quer o microfone). */
  setExpected(source: AudioSource, expected: boolean): void {
    this.src[source].expected = expected;
  }

  isFailed(source: AudioSource): boolean {
    return this.src[source].failed;
  }

  state(source: AudioSource): SourceState['state'] {
    return this.src[source].state;
  }

  onFrame(source: AudioSource, pcm: Buffer, now: number): WatchdogEvent[] {
    const s = this.src[source];
    const events: WatchdogEvent[] = [];
    s.lastFrameAt = now;
    const silent = isAllZero(pcm);
    if (silent) {
      s.zeroSince ??= now;
      return events;
    }
    s.zeroSince = null;
    if (s.state !== 'ok') {
      events.push({ type: 'recovered', source, gapFrom: s.episodeFrom });
      s.state = 'ok';
      s.episodeFrom = null;
      s.restarts = 0;
      s.failed = false;
    }
    return events;
  }

  /** Chamado a cada segundo. */
  tick(now: number): WatchdogEvent[] {
    const events: WatchdogEvent[] = [];
    for (const source of ['mic', 'sys'] as const) {
      const s = this.src[source];
      if (!s.expected) continue;
      const idle = now - s.lastFrameAt;
      if (idle > this.cfg.stallMs) {
        if (s.state !== 'stalled') {
          s.state = 'stalled';
          s.episodeFrom = s.lastFrameAt;
          s.restarts = 0;
          s.nextRestartAt = now;
          events.push({ type: 'stalled', source, since: s.lastFrameAt });
        }
        this.maybeRestart(source, s, now, 'stalled', this.cfg.maxStallRestarts, events);
        continue;
      }
      if (s.zeroSince !== null && now - s.zeroSince > this.cfg.silenceMs[source]) {
        if (s.state !== 'silent') {
          s.state = 'silent';
          s.episodeFrom = s.zeroSince;
          s.restarts = 0;
          s.nextRestartAt = now;
          events.push({ type: 'silent', source, since: s.zeroSince });
        }
        // o silêncio continua contando: um novo reinício a cada `silenceMs`, até o teto
        this.maybeRestart(source, s, now, 'silent', this.cfg.maxSilenceRestarts, events);
      }
    }
    return events;
  }

  private maybeRestart(source: AudioSource, s: SourceState, now: number, reason: 'stalled' | 'silent', max: number, events: WatchdogEvent[]): void {
    if (s.failed || now < s.nextRestartAt) return;
    if (s.restarts >= max) {
      s.failed = true;
      events.push({ type: 'failed', source, reason });
      return;
    }
    s.restarts++;
    const wait = reason === 'silent' ? this.cfg.silenceMs[source] : (this.cfg.backoffMs[Math.min(s.restarts, this.cfg.backoffMs.length - 1)] ?? 0);
    s.nextRestartAt = now + wait + (reason === 'stalled' ? this.cfg.graceMs : 0);
    events.push({ type: 'restart', reason, source, attempt: s.restarts });
    // a captura nova ganha o período de graça antes de ser considerada travada de novo
    this.captureStarted(now);
  }
}

function isAllZero(pcm: Buffer): boolean {
  for (let i = 0; i < pcm.length; i++) if (pcm[i] !== 0) return false;
  return true;
}
