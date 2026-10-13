import { toLocalIso } from '../../shared/naming';
import type { Shot } from '../../shared/screenshots';
import { isNearDuplicate } from './phash';
import { addShot, listShots, removeShot } from './store';
import { looksLikeShowing } from './trigger';

/** No máximo 1 pergunta à IA a cada tanto tempo, e 1 captura a cada tanto. */
export const ASK_COOLDOWN_MS = 15_000;
export const CAPTURE_COOLDOWN_MS = 10_000;
/** Gatilhos que chegam colados viram uma pergunta só: espera um pouco antes de perguntar. */
export const COLLECT_MS = 1_500;
/** A tela precisa de tempo para trocar depois do "vou compartilhar"; se ainda estiver igual, uma segunda tentativa. */
export const CAPTURE_DELAY_MS = 2_000;
export const RETRY_DELAY_MS = 5_000;
/** Quanta conversa a IA vê além do trecho candidato. */
export const CONTEXT_MS = 60_000;

/** Um quadro já reduzido (~1280 px, JPEG) e o hash perceptual dele. */
export type Frame = { jpeg: Buffer; hash: string };

/** Uma fala finalizada. `at` = início real da fala (início da reunião + startMs). */
export type SpokenSegment = { at: Date; who: string; text: string };
export type Decision = { capture: boolean; reason: string };

export type CaptureDeps = {
  /** Tira o quadro da tela. null = sem permissão, sem tela ou erro. */
  grab: (hint: { preferWindow: boolean }) => Promise<Frame | null>;
  /** Decide, SÓ POR TEXTO, se a fala pede um print. Funciona com qualquer provedor (inclusive os CLIs). Lançar = não captura. */
  decide: (context: SpokenSegment[], candidates: SpokenSegment[], dir: string) => Promise<Decision>;
  /** Relógio EXATO da linha que a transcrição gravou para essa fala (o calculado pode diferir 1 s); null = não achou. */
  locate?: (dir: string, text: string) => Promise<string | null>;
  /** Opcional: com provedor que aceita imagem, refina a legenda pela imagem. null = fica o motivo da fala. */
  refine?: (jpeg: Buffer, reason: string, dir: string) => Promise<string | null>;
  /** Relógio (HH:MM:SS) da fala mais próxima de `at` (para o vínculo quando não há gatilho). */
  nearestSegment: (dir: string, at: Date) => Promise<string | null>;
  onChange?: (dir: string, shots: Shot[]) => void;
  onError?: (err: unknown) => void;
  /** Prefiltro (padrão: o local em pt/en); injetável nos testes. */
  prefilter?: (text: string) => boolean;
};

const clock = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
const hhmmss = (d: Date) => clock(d).replace(/:/g, '');

/**
 * Captura disparada pela conversa: cada fala finalizada passa por um pré-filtro local; os candidatos viram UMA pergunta curta à IA
 * (últimos ~60 s + candidatos); se ela diz que faz sentido, o quadro sai ~2 s depois, ligado ao trecho que o motivou.
 * Nada roda fora de `start`…`stop`. Não há timer periódico.
 */
export class ScreenshotCapture {
  private session = 0;
  private dir: string | null = null;
  private startedAt: Date | null = null;
  private lastHash: string | null = null;
  private history: SpokenSegment[] = [];
  private candidates: SpokenSegment[] = [];
  private askTimer: ReturnType<typeof setTimeout> | null = null;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private asking = false;
  private lastAskAt = 0;
  private lastCaptureAt = 0;

  constructor(private readonly deps: CaptureDeps) {}

  get active(): boolean {
    return this.dir !== null;
  }

  start(dir: string, startedAt: Date): void {
    if (this.dir === dir) return;
    this.stop();
    this.session++;
    this.dir = dir;
    this.startedAt = startedAt;
    this.lastHash = null;
    this.history = [];
    this.candidates = [];
    this.lastAskAt = 0;
    this.lastCaptureAt = 0;
  }

  stop(): void {
    this.session++;
    for (const t of [this.askTimer, this.captureTimer]) if (t) clearTimeout(t);
    this.askTimer = this.captureTimer = null;
    this.dir = null;
    this.history = [];
    this.candidates = [];
    this.asking = false;
  }

  /** Cada fala finalizada. `startMs` é relativo ao início da reunião. */
  onSegment(segment: { dir: string; who: string; text: string; startMs: number }): void {
    if (!this.dir || segment.dir !== this.dir || !this.startedAt) return;
    const spoken: SpokenSegment = { at: new Date(this.startedAt.getTime() + segment.startMs), who: segment.who, text: segment.text.trim() };
    if (!spoken.text) return;
    this.history.push(spoken);
    const cutoff = spoken.at.getTime() - CONTEXT_MS;
    this.history = this.history.filter((s) => s.at.getTime() >= cutoff);
    if (!(this.deps.prefilter ?? looksLikeShowing)(spoken.text)) return;
    this.candidates.push(spoken);
    this.scheduleAsk();
  }

  private scheduleAsk(): void {
    if (this.askTimer || this.asking) return;
    const wait = Math.max(COLLECT_MS, this.lastAskAt + ASK_COOLDOWN_MS - Date.now());
    this.askTimer = setTimeout(() => void this.ask(), wait);
    this.askTimer.unref?.();
  }

  /** Uma pergunta à IA com tudo o que juntou. Exposta para os testes. */
  async ask(): Promise<void> {
    this.askTimer = null;
    const dir = this.dir;
    const session = this.session;
    if (!dir || this.asking || this.candidates.length === 0) return;
    const candidates = this.candidates;
    this.candidates = [];
    this.asking = true;
    this.lastAskAt = Date.now();
    try {
      const context = this.history.filter((s) => !candidates.includes(s));
      const decision = await this.deps.decide(context, candidates, dir);
      if (session !== this.session || !decision.capture) return;
      this.scheduleCapture(candidates[candidates.length - 1]!, decision.reason, session, false);
    } catch (err) {
      this.deps.onError?.(err); // resposta inválida, recusada ou erro de rede: sem captura
    } finally {
      this.asking = false;
      if (session === this.session && this.candidates.length > 0) this.scheduleAsk();
    }
  }

  private scheduleCapture(trigger: SpokenSegment, reason: string, session: number, retry: boolean): void {
    if (this.captureTimer) return; // já há uma captura a caminho: ela cobre este momento
    const wait = Math.max(retry ? RETRY_DELAY_MS : CAPTURE_DELAY_MS, this.lastCaptureAt + CAPTURE_COOLDOWN_MS - Date.now());
    this.captureTimer = setTimeout(() => {
      this.captureTimer = null;
      void this.capture(trigger, reason, session, retry);
    }, wait);
    this.captureTimer.unref?.();
  }

  /** Tira o quadro; tela igual à última guardada = tenta de novo uma vez; igual de novo = descarta. */
  async capture(trigger: SpokenSegment, reason: string, session: number, retry: boolean): Promise<Shot | null> {
    const dir = this.dir;
    const startedAt = this.startedAt;
    if (!dir || !startedAt || session !== this.session) return null;
    try {
      // fala de outra pessoa (áudio do sistema): o que ela mostra está dentro da janela da chamada
      const frame = await this.deps.grab({ preferWindow: trigger.who !== 'Eu' });
      if (!frame || session !== this.session) return null;
      if (isNearDuplicate(this.lastHash, frame.hash)) {
        if (!retry) this.scheduleCapture(trigger, reason, session, true);
        return null;
      }
      return await this.save(dir, startedAt, frame, reason, { trigger });
    } catch (err) {
      this.deps.onError?.(err);
      return null;
    }
  }

  /** Botão "Capturar tela" e atalho: tira agora, sem IA e sem descartar por parecer igual (foi o usuário que pediu). */
  async captureNow(): Promise<Shot | null> {
    const dir = this.dir;
    const startedAt = this.startedAt;
    if (!dir || !startedAt) return null;
    const session = this.session;
    try {
      const frame = await this.deps.grab({ preferWindow: false }); // manual: a tela inteira onde está a chamada
      if (!frame || session !== this.session) return null;
      return await this.save(dir, startedAt, frame, '', { manual: true });
    } catch (err) {
      this.deps.onError?.(err);
      return null;
    }
  }

  private async save(dir: string, startedAt: Date, frame: Frame, reason: string, kind: { trigger: SpokenSegment } | { manual: true }): Promise<Shot | null> {
    const at = new Date();
    let caption = reason;
    if ('trigger' in kind && this.deps.refine) {
      const refined = await this.deps.refine(frame.jpeg, reason, dir).catch(() => null);
      if (refined) caption = refined;
    }
    this.lastHash = frame.hash;
    this.lastCaptureAt = at.getTime();
    const trigger = 'trigger' in kind ? { segmentAt: (await this.deps.locate?.(dir, kind.trigger.text).catch(() => null)) ?? clock(kind.trigger.at), text: kind.trigger.text.slice(0, 300) } : undefined;
    const shot = await addShot(dir, {
      clock6: hhmmss(at),
      jpeg: frame.jpeg,
      at: toLocalIso(at),
      offsetMs: Math.max(0, at.getTime() - startedAt.getTime()),
      caption,
      segment: trigger ? trigger.segmentAt : await this.deps.nearestSegment(dir, at).catch(() => null),
      ...(trigger ? { trigger } : { manual: true }),
    });
    if (shot) this.deps.onChange?.(dir, await listShots(dir));
    return shot;
  }
}

/** Remove uma captura e avisa. */
export async function discardShot(dir: string, file: string, onChange?: (dir: string, shots: Shot[]) => void): Promise<boolean> {
  const ok = await removeShot(dir, file);
  if (ok) onChange?.(dir, await listShots(dir));
  return ok;
}

/** Relógio da última linha de fala com horário ≤ `at`; sem nenhuma antes, a primeira depois. null se não há falas. */
export function nearestSegmentClock(transcriptMd: string, at: Date): string | null {
  const target = clock(at);
  let before: string | null = null;
  let after: string | null = null;
  for (const line of transcriptMd.split('\n')) {
    const m = /^\*\*\[(\d{2}:\d{2}:\d{2})\]/.exec(line.trim());
    if (!m) continue;
    if (m[1]! <= target) before = m[1]!;
    else if (!after) after = m[1]!;
  }
  return before ?? after;
}

/** Relógio da última linha de fala cujo texto é exatamente `text`. */
export function clockOfSegmentText(transcriptMd: string, text: string): string | null {
  let found: string | null = null;
  for (const line of transcriptMd.split('\n')) {
    const m = /^\*\*\[(\d{2}:\d{2}:\d{2})\]\s+.+?:\*\*\s*(.*)$/.exec(line.trim());
    if (m && m[2]!.trim() === text.trim()) found = m[1]!;
  }
  return found;
}
