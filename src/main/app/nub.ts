import type { AudioFrame } from '../../shared/frames';

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Medidas (px) do nub. O CSS de `nub.html` espelha estes valores (há um teste que confere). */
export const NUB_PAD = 10;
export const NUB_COL_WIDTH = 22; // logo + barras
export const NUB_BTN_WIDTH = 104;
export const NUB_BTN_HEIGHT = 30;
export const NUB_BTN_GAP = 8;
export const NUB_DIVIDER = 1;
/** Pílula em repouso: a coluna do logo com respiro dos dois lados. */
export const NUB_WIDTH = NUB_COL_WIDTH + 2 * NUB_PAD;
/** Três botões (Perguntar, Pausar, Parar) empilhados com o mesmo respiro em volta. */
export const NUB_BTN_COUNT = 3;
export const NUB_HEIGHT = NUB_BTN_COUNT * NUB_BTN_HEIGHT + (NUB_BTN_COUNT - 1) * NUB_BTN_GAP + 2 * NUB_PAD;
/** Largura da janela em repouso e em hover: ela é sempre larga e transparente; só a pílula cresce (CSS). */
export const NUB_BAR_WIDTH = NUB_PAD + NUB_BTN_WIDTH + NUB_PAD + NUB_DIVIDER + NUB_WIDTH;
export const NUB_PANEL_WIDTH = 340;
export const NUB_PANEL_HEIGHT = 420;
const EDGE_MARGIN = 8;
/** Intervalo do polling do cursor e atraso para recolher a barra depois que o mouse sai. */
export const NUB_POLL_MS = 50;
export const NUB_LEAVE_MS = 400;

export function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

/** O nub aparece quando grava e o usuário não está olhando para a janela principal. */
export function shouldShowNub(input: { recording: boolean; mainFocused: boolean; mainVisible: boolean }): boolean {
  return input.recording && (!input.mainFocused || !input.mainVisible);
}

/** Mantém a janelinha inteira dentro da área útil do display. */
export function clampToWorkArea(bounds: Rect, workArea: Rect): Point {
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
  };
}

export type NubSide = 'right' | 'left';

/** A barra de hover cresce para a esquerda da pílula; se não couber (pílula na borda esquerda), para a direita. */
export function barSide(pill: Rect, workArea: Rect): NubSide {
  return pill.x + pill.width - NUB_BAR_WIDTH >= workArea.x ? 'right' : 'left';
}

/** Retângulo da janela (larga) que contém a pílula, com a pílula colada na borda indicada por `side`. */
export function windowBoundsFor(pill: Rect, side: NubSide, workArea: Rect): Rect {
  const x = side === 'right' ? pill.x + pill.width - NUB_BAR_WIDTH : pill.x;
  return { ...clampToWorkArea({ x, y: pill.y, width: NUB_BAR_WIDTH, height: pill.height }, workArea), width: NUB_BAR_WIDTH, height: pill.height };
}

/** Inverso de `windowBoundsFor`: onde está a pílula dentro da janela. */
export function pillFromWindow(win: Point, side: NubSide): Rect {
  return { x: side === 'right' ? win.x + NUB_BAR_WIDTH - NUB_WIDTH : win.x, y: win.y, width: NUB_WIDTH, height: NUB_HEIGHT };
}

/**
 * Retângulo do painel expandido: cresce para a ESQUERDA a partir da borda direita da pílula (para a direita se não couber à
 * esquerda), com o topo alinhado, sempre dentro do workArea.
 */
export function expandedBounds(pill: Rect, workArea: Rect): Rect {
  const width = Math.min(NUB_PANEL_WIDTH, workArea.width);
  const height = Math.min(NUB_PANEL_HEIGHT, workArea.height);
  let x = pill.x + pill.width - width;
  if (x < workArea.x) x = pill.x;
  return { ...clampToWorkArea({ x, y: pill.y, width, height }, workArea), width, height };
}

/** Nível 0..1 (escala log, -60 dBFS..0) de um frame PCM16 mono. Não guarda nem envia o áudio. */
export function rmsLevel(pcm: Buffer): number {
  const samples = pcm.length >> 1;
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples);
  if (rms <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60));
}

export type Levels = { mic: number; sys: number };

/** Calcula o RMS de cada frame, mas só emite o pico por fonte a cada `intervalMs`. */
export class LevelThrottle {
  private peak: Levels = { mic: 0, sys: 0 };
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly send: (levels: Levels) => void,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 100,
  ) {}

  push(frame: AudioFrame): void {
    this.peak[frame.source] = Math.max(this.peak[frame.source], rmsLevel(frame.pcm));
    const t = this.now();
    if (t - this.last < this.intervalMs) return;
    this.last = t;
    const out = this.peak;
    this.peak = { mic: 0, sys: 0 };
    this.send(out);
  }
}

/** Subconjunto de BrowserWindow que o controlador usa (facilita testar). */
export type NubWindow = {
  showInactive(): void;
  hide(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  getPosition(): number[];
  setPosition(x: number, y: number): void;
  send(channel: string, payload: unknown): void;
  destroy(): void;
  setBounds(bounds: Rect): void;
  setFocusable(focusable: boolean): void;
  focus(): void;
  setIgnoreMouseEvents(ignore: boolean): void;
};

type WorkAreaDisplay = { workArea: Rect };

export type NubDeps = {
  createWindow: () => NubWindow;
  screen: {
    getDisplayMatching(rect: Rect): WorkAreaDisplay;
    getDisplayNearestPoint(point: Point): WorkAreaDisplay;
    getPrimaryDisplay(): WorkAreaDisplay;
    getCursorScreenPoint(): Point;
  };
  mainBounds: () => Rect | null;
  savedPosition: () => Point | undefined;
  savePosition: (position: Point) => void;
  now?: () => number;
};

export class NubController {
  private win: NubWindow | null = null;
  private recording = false;
  private startedAt = 0;
  private paused = false;
  /** Posição e tamanho da pílula enquanto o painel está expandido. */
  private pillBounds: Rect | null = null;
  /** Lado para onde a barra de hover cresce; define onde a pílula fica dentro da janela larga. */
  private side: NubSide = 'right';
  /** O main detecta o cursor sobre a pílula (polling); só então a janela aceita cliques. */
  private hovering = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: NubDeps) {}

  /** Chamar a cada mudança de gravação ou de foco/visibilidade da janela principal. */
  update(input: { recording: boolean; mainFocused: boolean; mainVisible: boolean; paused?: boolean }): void {
    if (input.recording && !this.recording) this.startedAt = (this.deps.now ?? Date.now)();
    this.recording = input.recording;
    const paused = input.recording && input.paused === true;
    if (paused !== this.paused) {
      this.paused = paused;
      if (this.win && !this.win.isDestroyed() && this.recording) this.win.send('nub:state', { recording: true, startedAt: this.startedAt, paused });
    }
    if (shouldShowNub(input)) this.show();
    else {
      this.collapse();
      this.hide();
    }
  }

  get expanded(): boolean {
    return this.pillBounds !== null;
  }

  /** Expande a pílula no painel de chat; só com a janela visível. Devolve false se não houver o que expandir. */
  expand(): boolean {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.recording) return false;
    if (this.pillBounds) return true;
    const pill = this.currentPill(win);
    const area = this.deps.screen.getDisplayNearestPoint({ x: pill.x, y: pill.y }).workArea;
    this.pillBounds = pill;
    this.stopPolling();
    win.setBounds(expandedBounds(pill, area));
    win.setFocusable(true);
    this.applyIgnore();
    win.focus();
    return true;
  }

  /**
   * Hover detectado aqui, não no renderer: numa janela de painel não focável o macOS não entrega de forma confiável os
   * mousemove encaminhados por `setIgnoreMouseEvents(true, {forward:true})`, então o renderer nunca via o mouse entrar.
   * Com o cursor na pílula (ou na barra, já aberta) a janela aceita cliques e o renderer anima; fora, ela ignora tudo.
   */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.tick(), NUB_POLL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.clearLeave();
  }

  private clearLeave(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }

  private setHovering(on: boolean): void {
    if (this.hovering === on) return;
    this.hovering = on;
    this.applyIgnore();
    if (this.win && !this.win.isDestroyed()) this.win.send('nub:hover', on);
  }

  private tick(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible() || this.pillBounds) return;
    const [x, y] = win.getPosition();
    const origin = { x: x ?? 0, y: y ?? 0 };
    // em repouso só a pílula reage; com a barra aberta, a janela inteira é a barra
    const rect: Rect = this.hovering
      ? { ...origin, width: NUB_BAR_WIDTH, height: NUB_HEIGHT }
      : pillFromWindow(origin, this.side);
    if (contains(rect, this.deps.screen.getCursorScreenPoint())) {
      this.clearLeave();
      this.setHovering(true);
    } else if (this.hovering && !this.leaveTimer) {
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = null;
        this.setHovering(false);
      }, NUB_LEAVE_MS);
      this.leaveTimer.unref?.();
    }
  }

  /** Volta à pílula (tamanho, posição e `focusable:false`). */
  collapse(): void {
    const pill = this.pillBounds;
    this.pillBounds = null;
    this.hovering = false;
    this.clearLeave();
    const win = this.win;
    if (!pill || !win || win.isDestroyed()) return;
    const area = this.deps.screen.getDisplayNearestPoint({ x: pill.x, y: pill.y }).workArea;
    win.setFocusable(false);
    win.setBounds(windowBoundsFor(pill, this.side, area));
    this.applyIgnore();
    win.send('nub:collapsed', null);
    if (win.isVisible()) this.startPolling();
  }

  /** Só entrega ao nub quando o painel está aberto (transcrição ao vivo, respostas). */
  sendExpanded(channel: string, payload: unknown): void {
    if (this.pillBounds && this.win && !this.win.isDestroyed()) this.win.send(channel, payload);
  }

  /** Chamar em `did-finish-load`: o estado enviado antes do load da página se perde. */
  resendState(): void {
    if (this.win && !this.win.isDestroyed() && this.recording) {
      this.win.send('nub:state', { recording: true, startedAt: this.startedAt, paused: this.paused });
      this.win.send('nub:side', this.side);
    }
  }

  sendLevel(levels: Levels): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.send('nub:level', levels);
  }

  /** Grava a posição atual (fim do arrasto). */
  persistPosition(): void {
    if (!this.win || this.win.isDestroyed() || this.pillBounds) return; // expandido: a posição é a do painel
    const pill = this.currentPill(this.win);
    this.deps.savePosition({ x: pill.x, y: pill.y });
    // arrastou para perto da borda esquerda (ou saiu dela): a barra passa a crescer para o outro lado
    const area = this.deps.screen.getDisplayNearestPoint({ x: pill.x, y: pill.y }).workArea;
    const side = barSide(pill, area);
    if (side === this.side) return;
    this.side = side;
    const next = windowBoundsFor(pill, side, area);
    this.win.setPosition(next.x, next.y);
    this.win.send('nub:side', side);
  }

  dispose(): void {
    this.stopPolling();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private show(): void {
    if (!this.win || this.win.isDestroyed()) this.win = this.deps.createWindow();
    const win = this.win;
    win.send('nub:state', { recording: true, startedAt: this.startedAt, paused: this.paused });
    if (win.isVisible()) return; // já aparece: não mexe na posição que o usuário arrastou
    const bounds = this.place();
    this.stopPolling();
    this.hovering = false;
    this.applyIgnore(); // antes de aparecer: a área transparente nunca pode bloquear cliques de outros apps
    win.setPosition(bounds.x, bounds.y);
    win.send('nub:side', this.side);
    win.showInactive();
    this.startPolling();
  }

  private hide(): void {
    this.stopPolling();
    this.hovering = false;
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  /** Posição da pílula a partir da janela, conforme o lado da barra. */
  private currentPill(win: NubWindow): Rect {
    const [x, y] = win.getPosition();
    return pillFromWindow({ x: x ?? 0, y: y ?? 0 }, this.side);
  }

  /** Cliques só são aceitos com o mouse na pílula ou com o painel de chat aberto. */
  private applyIgnore(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const interactive = this.hovering || this.pillBounds !== null;
    win.setIgnoreMouseEvents(!interactive);
  }

  /** Retângulo da janela larga e define o lado da barra a partir da pílula salva (ou do canto padrão). */
  private place(): Rect {
    const size = { width: NUB_WIDTH, height: NUB_HEIGHT };
    const saved = this.deps.savedPosition();
    let pill: Rect;
    let area: Rect;
    if (saved) {
      area = this.deps.screen.getDisplayNearestPoint(saved).workArea;
      pill = { ...clampToWorkArea({ ...saved, ...size }, area), ...size };
    } else {
      const main = this.deps.mainBounds();
      area = (main ? this.deps.screen.getDisplayMatching(main) : this.deps.screen.getPrimaryDisplay()).workArea;
      pill = {
        ...clampToWorkArea({ x: area.x + area.width - NUB_WIDTH - EDGE_MARGIN, y: Math.round(area.y + area.height * 0.4), ...size }, area),
        ...size,
      };
    }
    this.side = barSide(pill, area);
    return windowBoundsFor(pill, this.side, area);
  }
}
