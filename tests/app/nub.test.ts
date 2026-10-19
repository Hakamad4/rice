import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barSide, NUB_BAR_WIDTH, NUB_BTN_GAP, NUB_BTN_HEIGHT, NUB_BTN_WIDTH, NUB_COL_WIDTH, NUB_DIVIDER, NUB_PAD, NUB_HEIGHT, NUB_WIDTH, clampToWorkArea, expandedBounds, LevelThrottle, NubController, NUB_LEAVE_MS, NUB_POLL_MS, pillFromWindow, rmsLevel, shouldShowNub, windowBoundsFor, type NubWindow } from '../../src/main/app/nub';
import { rendered } from '../helpers/tokens';

const WA = { x: 0, y: 25, width: 1440, height: 875 };

describe('shouldShowNub', () => {
  it('só aparece gravando e com a janela principal sem foco ou oculta', () => {
    expect(shouldShowNub({ recording: true, mainFocused: false, mainVisible: true })).toBe(true);
    expect(shouldShowNub({ recording: true, mainFocused: false, mainVisible: false })).toBe(true);
    expect(shouldShowNub({ recording: true, mainFocused: true, mainVisible: true })).toBe(false);
    expect(shouldShowNub({ recording: false, mainFocused: false, mainVisible: false })).toBe(false);
  });
});

describe('clampToWorkArea', () => {
  const size = { width: NUB_WIDTH, height: NUB_HEIGHT };
  it('mantém posição válida', () => {
    expect(clampToWorkArea({ x: 100, y: 200, ...size }, WA)).toEqual({ x: 100, y: 200 });
  });
  it('puxa para dentro nos quatro cantos', () => {
    expect(clampToWorkArea({ x: -50, y: -50, ...size }, WA)).toEqual({ x: 0, y: 25 });
    expect(clampToWorkArea({ x: 5000, y: 5000, ...size }, WA)).toEqual({ x: 1440 - NUB_WIDTH, y: 25 + 875 - NUB_HEIGHT });
  });
});

describe('rmsLevel', () => {
  const pcm = (value: number) => {
    const b = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) b.writeInt16LE(i % 2 ? value : -value, i * 2);
    return b;
  };
  it('silêncio é 0, fundo de escala é 1, escala logarítmica no meio', () => {
    expect(rmsLevel(pcm(0))).toBe(0);
    expect(rmsLevel(pcm(32767))).toBeCloseTo(1, 1);
    const mid = rmsLevel(pcm(1000)); // ≈ -30 dBFS
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(rmsLevel(Buffer.alloc(0))).toBe(0);
  });
});

describe('LevelThrottle', () => {
  it('envia no máximo 10×/s com o pico por fonte', () => {
    const send = vi.fn();
    let t = 1000;
    const th = new LevelThrottle(send, () => t, 100);
    const loud = Buffer.alloc(320, 0x40);
    const quiet = Buffer.alloc(320);
    th.push({ source: 'mic', timestampMs: 0, pcm: loud });
    expect(send).toHaveBeenCalledTimes(1);
    t = 1050;
    th.push({ source: 'sys', timestampMs: 0, pcm: loud });
    expect(send).toHaveBeenCalledTimes(1);
    t = 1100;
    th.push({ source: 'mic', timestampMs: 0, pcm: quiet });
    expect(send).toHaveBeenCalledTimes(2);
    const second = send.mock.calls[1]![0];
    expect(second.sys).toBeGreaterThan(0);
    expect(second.mic).toBe(0);
  });
});

let cursor = { x: -1000, y: -1000 };

function fakeEnv(over: { saved?: { x: number; y: number }; main?: { x: number; y: number; width: number; height: number } | null } = {}) {
  const win = {
    visible: false,
    pos: [0, 0] as [number, number],
    showInactive: vi.fn(() => (win.visible = true)),
    hide: vi.fn(() => (win.visible = false)),
    isVisible: () => win.visible,
    isDestroyed: () => false,
    getPosition: () => win.pos,
    setPosition: vi.fn((x: number, y: number) => (win.pos = [x, y])),
    send: vi.fn(),
    destroy: vi.fn(),
    setBounds: vi.fn(),
    setFocusable: vi.fn(),
    focus: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
  };
  const created = vi.fn(() => win as unknown as NubWindow);
  const savePosition = vi.fn();
  const screen = {
    getDisplayMatching: vi.fn(() => ({ workArea: WA })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: WA })),
    getPrimaryDisplay: () => ({ workArea: WA }),
    getCursorScreenPoint: vi.fn(() => cursor),
  };
  const ctl = new NubController({
    createWindow: created,
    screen,
    mainBounds: () => (over.main === undefined ? { x: 100, y: 100, width: 1200, height: 780 } : over.main),
    savedPosition: () => over.saved,
    savePosition,
    now: () => 5000,
  });
  return { win, created, savePosition, screen, ctl };
}

describe('NubController', () => {
  it('mostra sem roubar foco quando grava com a principal sem foco, e esconde ao focar', () => {
    const { win, ctl, created } = fakeEnv();
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    expect(created).toHaveBeenCalledTimes(1);
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    expect(win.send).toHaveBeenCalledWith('nub:state', { recording: true, startedAt: 5000, paused: false });
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    ctl.update({ recording: true, mainFocused: true, mainVisible: true });
    expect(win.hide).toHaveBeenCalledTimes(1);
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    expect(created).toHaveBeenCalledTimes(1);
    expect(win.showInactive).toHaveBeenCalledTimes(2);
  });

  it('pausar e continuar avisam a janelinha (o botão vira "Continuar")', () => {
    const { win, ctl } = fakeEnv();
    ctl.update({ recording: true, paused: false, mainFocused: false, mainVisible: true });
    win.send.mockClear();
    ctl.update({ recording: true, paused: true, mainFocused: false, mainVisible: true });
    expect(win.send).toHaveBeenCalledWith('nub:state', { recording: true, startedAt: 5000, paused: true });
    ctl.update({ recording: true, paused: false, mainFocused: false, mainVisible: true });
    expect(win.send).toHaveBeenCalledWith('nub:state', { recording: true, startedAt: 5000, paused: false });
  });

  it('resendState reenvia o estado depois do load da página (envio inicial pode se perder)', () => {
    const { win, ctl } = fakeEnv();
    ctl.resendState(); // sem janela: nada
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    win.send.mockClear();
    ctl.resendState();
    expect(win.send).toHaveBeenCalledWith('nub:state', { recording: true, startedAt: 5000, paused: false });
    ctl.update({ recording: false, mainFocused: false, mainVisible: true });
    win.send.mockClear();
    ctl.resendState(); // gravação parou: não reenvia
    expect(win.send).not.toHaveBeenCalled();
  });

  it('não cria janela se nunca precisou mostrar', () => {
    const { created, ctl } = fakeEnv();
    ctl.update({ recording: false, mainFocused: false, mainVisible: false });
    expect(created).not.toHaveBeenCalled();
  });

  it('posição inicial: borda direita, 40% da altura, dentro do workArea', () => {
    const { win, ctl } = fakeEnv();
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    expect(win.setPosition).toHaveBeenLastCalledWith(1440 - 8 - NUB_BAR_WIDTH, Math.round(25 + 875 * 0.4));
  });

  it('reaplica a posição salva com clamp', () => {
    const { win, ctl } = fakeEnv({ saved: { x: 99999, y: -300 } });
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    expect(win.setPosition).toHaveBeenLastCalledWith(1440 - NUB_BAR_WIDTH, 25);
  });

  it('persistPosition salva a posição atual da janela', () => {
    const { win, ctl, savePosition } = fakeEnv();
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    win.pos = [300, 400]; // janela larga: a pílula fica na borda direita dela
    ctl.persistPosition();
    expect(savePosition).toHaveBeenCalledWith({ x: 300 + NUB_BAR_WIDTH - NUB_WIDTH, y: 400 });
  });

  it('level só vai para a janela visível; parar a gravação esconde', () => {
    const { win, ctl } = fakeEnv();
    ctl.sendLevel({ mic: 0.5, sys: 0.2 });
    expect(win.send).not.toHaveBeenCalled();
    ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    ctl.sendLevel({ mic: 0.5, sys: 0.2 });
    expect(win.send).toHaveBeenCalledWith('nub:level', { mic: 0.5, sys: 0.2 });
    ctl.update({ recording: false, mainFocused: false, mainVisible: true });
    expect(win.hide).toHaveBeenCalled();
  });
});

describe('expandedBounds', () => {
  const pill = (x: number, y: number) => ({ x, y, width: NUB_WIDTH, height: NUB_HEIGHT });
  it('cresce para a esquerda a partir da borda direita da pílula, topo alinhado', () => {
    expect(expandedBounds(pill(1390, 300), WA)).toEqual({ x: 1390 + 42 - 340, y: 300, width: 340, height: 420 });
  });
  it('sem espaço à esquerda, cresce para a direita', () => {
    expect(expandedBounds(pill(10, 300), WA)).toEqual({ x: 10, y: 300, width: 340, height: 420 });
  });
  it('clamp no workArea: sobe para caber embaixo e não passa do topo', () => {
    expect(expandedBounds(pill(1390, 800), WA)).toEqual({ x: 1092, y: 25 + 875 - 420, width: 340, height: 420 });
    const small = { x: 0, y: 0, width: 300, height: 200 };
    expect(expandedBounds(pill(250, 150), small)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('NubController expandido', () => {
  const show = (env: ReturnType<typeof fakeEnv>) => {
    env.ctl.update({ recording: true, mainFocused: false, mainVisible: true });
    env.win.pos = [1390 + NUB_WIDTH - NUB_BAR_WIDTH, 300]; // pílula em x=1390
  };

  it('expand: aumenta a janela, ganha foco; collapse volta ao tamanho e posição da pílula', () => {
    const env = fakeEnv();
    show(env);
    expect(env.ctl.expand()).toBe(true);
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 1092, y: 300, width: 340, height: 420 });
    expect(env.win.setFocusable).toHaveBeenLastCalledWith(true);
    expect(env.win.focus).toHaveBeenCalled();
    expect(env.ctl.expanded).toBe(true);
    env.ctl.collapse();
    expect(env.win.setFocusable).toHaveBeenLastCalledWith(false);
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 1390 + NUB_WIDTH - NUB_BAR_WIDTH, y: 300, width: NUB_BAR_WIDTH, height: NUB_HEIGHT });
    expect(env.ctl.expanded).toBe(false);
  });

  it('não expande sem janela visível ou sem gravação', () => {
    const env = fakeEnv();
    expect(env.ctl.expand()).toBe(false);
    show(env);
    env.ctl.update({ recording: false, mainFocused: false, mainVisible: true });
    expect(env.ctl.expand()).toBe(false);
  });

  it('parar a gravação ou focar a principal recolhe e esconde', () => {
    const env = fakeEnv();
    show(env);
    env.ctl.expand();
    env.ctl.update({ recording: false, mainFocused: false, mainVisible: true });
    expect(env.ctl.expanded).toBe(false);
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 1390 + NUB_WIDTH - NUB_BAR_WIDTH, y: 300, width: NUB_BAR_WIDTH, height: NUB_HEIGHT });
    expect(env.win.hide).toHaveBeenCalled();
  });

  it('expandido, a posição do painel não é salva como a da pílula; sendExpanded só com painel aberto', () => {
    const env = fakeEnv();
    show(env);
    env.win.send.mockClear();
    env.ctl.sendExpanded('nub:segment', 1);
    expect(env.win.send).not.toHaveBeenCalled();
    env.ctl.expand();
    env.ctl.persistPosition();
    expect(env.savePosition).not.toHaveBeenCalled();
    env.ctl.sendExpanded('nub:segment', 1);
    expect(env.win.send).toHaveBeenCalledWith('nub:segment', 1);
    env.ctl.collapse();
    env.ctl.persistPosition();
    expect(env.savePosition).toHaveBeenCalled();
  });
});

describe('geometria da barra de hover', () => {
  const pill = (x: number, y = 300) => ({ x, y, width: NUB_WIDTH, height: NUB_HEIGHT });

  it('cresce para a esquerda com a borda direita da pílula fixa', () => {
    expect(barSide(pill(1390), WA)).toBe('right');
    expect(windowBoundsFor(pill(1390), 'right', WA)).toEqual({ x: 1390 + NUB_WIDTH - NUB_BAR_WIDTH, y: 300, width: NUB_BAR_WIDTH, height: NUB_HEIGHT });
    expect(pillFromWindow({ x: 1390 + NUB_WIDTH - NUB_BAR_WIDTH, y: 300 }, 'right')).toEqual(pill(1390));
  });

  it('encostada à esquerda da tela, cresce para a direita com a borda esquerda fixa', () => {
    expect(barSide(pill(0), WA)).toBe('left');
    const edge = NUB_BAR_WIDTH - NUB_WIDTH;
    expect(barSide(pill(edge - 1), WA)).toBe('left');
    expect(barSide(pill(edge), WA)).toBe('right');
    expect(windowBoundsFor(pill(10), 'left', WA)).toEqual({ x: 10, y: 300, width: NUB_BAR_WIDTH, height: NUB_HEIGHT });
    expect(pillFromWindow({ x: 10, y: 300 }, 'left')).toEqual(pill(10));
  });

  it('clamp no workArea: não passa do topo nem da base', () => {
    expect(windowBoundsFor(pill(1390, 0), 'right', WA).y).toBe(25);
    expect(windowBoundsFor(pill(1390, 5000), 'right', WA).y).toBe(25 + 875 - NUB_HEIGHT);
  });
});

describe('NubController hover e cliques', () => {
  const start = (env: ReturnType<typeof fakeEnv>) => env.ctl.update({ recording: true, mainFocused: false, mainVisible: true });

  afterEach(() => {
    vi.useRealTimers();
    cursor = { x: -1000, y: -1000 };
  });
  /** Centro da pílula (em repouso ela fica na borda do lado `side` da janela larga). */
  const pillCenter = (env: ReturnType<typeof fakeEnv>) => {
    const [x, y] = env.win.pos;
    return { x: x + NUB_BAR_WIDTH - NUB_WIDTH / 2, y: y + NUB_HEIGHT / 2 };
  };

  it('começa ignorando cliques antes de aparecer', () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    start(env);
    expect(env.win.setIgnoreMouseEvents.mock.calls[0]).toEqual([true]);
    expect(env.win.setIgnoreMouseEvents.mock.invocationCallOrder[0]).toBeLessThan(env.win.showInactive.mock.invocationCallOrder[0]!);
  });

  it('polling: cursor entra na pílula → hover on e janela aceita cliques', () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    start(env);
    vi.advanceTimersByTime(NUB_POLL_MS * 3);
    expect(env.win.send).not.toHaveBeenCalledWith('nub:hover', true);
    cursor = pillCenter(env);
    vi.advanceTimersByTime(NUB_POLL_MS);
    expect(env.win.send).toHaveBeenCalledWith('nub:hover', true);
    expect(env.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it('em repouso só a pílula conta; com a barra aberta, a janela toda é hover', () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    start(env);
    const [x, y] = env.win.pos;
    cursor = { x: x + 5, y: y + 40 }; // sobre a área dos botões, ainda transparente em repouso
    vi.advanceTimersByTime(NUB_POLL_MS * 2);
    expect(env.win.send).not.toHaveBeenCalledWith('nub:hover', true);
    cursor = pillCenter(env);
    vi.advanceTimersByTime(NUB_POLL_MS);
    cursor = { x: x + 5, y: y + 40 }; // barra aberta: os botões estão aqui
    vi.advanceTimersByTime(NUB_LEAVE_MS * 2);
    expect(env.win.send).not.toHaveBeenCalledWith('nub:hover', false);
  });

  it('cursor sai → hover off só depois de 400ms; voltar a tempo cancela', () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    start(env);
    cursor = pillCenter(env);
    vi.advanceTimersByTime(NUB_POLL_MS);
    cursor = { x: -1000, y: -1000 };
    vi.advanceTimersByTime(NUB_LEAVE_MS - 60);
    expect(env.win.send).not.toHaveBeenCalledWith('nub:hover', false);
    cursor = pillCenter(env); // voltou a tempo
    vi.advanceTimersByTime(NUB_POLL_MS * 2);
    cursor = { x: -1000, y: -1000 };
    vi.advanceTimersByTime(NUB_LEAVE_MS + NUB_POLL_MS * 2);
    expect(env.win.send).toHaveBeenLastCalledWith('nub:hover', false);
    expect(env.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  });

  it('esconder a janela para o polling e zera o hover (nunca fica bloqueando cliques)', () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    start(env);
    cursor = pillCenter(env);
    vi.advanceTimersByTime(NUB_POLL_MS);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    env.ctl.update({ recording: true, mainFocused: true, mainVisible: true }); // esconde
    expect(vi.getTimerCount()).toBe(0);
    env.win.getPosition = vi.fn(() => env.win.pos);
    vi.advanceTimersByTime(NUB_POLL_MS * 5);
    expect(env.win.getPosition).not.toHaveBeenCalled();
    start(env); // reaparece
    expect(env.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  });

  it('Perguntar (expand): troca bounds e focusable e aceita cliques; recolher volta a ignorar e ao polling', () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    start(env);
    env.win.pos = [1390 + NUB_WIDTH - NUB_BAR_WIDTH, 300];
    expect(env.ctl.expand()).toBe(true);
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 1092, y: 300, width: 340, height: 420 });
    expect(env.win.setFocusable).toHaveBeenLastCalledWith(true);
    expect(env.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0); // painel aberto: sem polling
    env.ctl.collapse();
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 1390 + NUB_WIDTH - NUB_BAR_WIDTH, y: 300, width: NUB_BAR_WIDTH, height: NUB_HEIGHT });
    expect(env.win.setFocusable).toHaveBeenLastCalledWith(false);
    expect(env.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('na borda esquerda: pílula fica à esquerda da janela, expande para a direita e avisa o lado', () => {
    const env = fakeEnv({ saved: { x: 5, y: 300 } });
    start(env);
    expect(env.win.setPosition).toHaveBeenLastCalledWith(5, 300);
    expect(env.win.send).toHaveBeenCalledWith('nub:side', 'left');
    env.win.pos = [5, 300];
    env.ctl.expand();
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 5, y: 300, width: 340, height: 420 });
    env.ctl.collapse();
    expect(env.win.setBounds).toHaveBeenLastCalledWith({ x: 5, y: 300, width: NUB_BAR_WIDTH, height: NUB_HEIGHT });
  });

  it('arrastar a pílula para a borda esquerda troca o lado sem mover a pílula', () => {
    const env = fakeEnv();
    start(env);
    env.win.pos = [18 - (NUB_BAR_WIDTH - NUB_WIDTH), 300]; // pílula em x=18 (janela larga com a pílula à direita)
    env.ctl.persistPosition();
    expect(env.savePosition).toHaveBeenCalledWith({ x: 18, y: 300 });
    expect(env.win.setPosition).toHaveBeenLastCalledWith(18, 300);
    expect(env.win.send).toHaveBeenCalledWith('nub:side', 'left');
  });
});

describe('medidas do nub: CSS e constantes concordam', () => {
  const css = rendered('src/renderer/nub.html');
  const px = (name: string) => Number(new RegExp(`--${name}:(\\d+)px`).exec(css)?.[1]);

  it('variáveis do :root espelham as constantes de nub.ts', () => {
    expect(px('pad')).toBe(NUB_PAD);
    expect(px('col')).toBe(NUB_COL_WIDTH);
    expect(px('btn-w')).toBe(NUB_BTN_WIDTH);
    expect(px('btn-h')).toBe(NUB_BTN_HEIGHT);
    expect(px('btn-gap')).toBe(NUB_BTN_GAP);
    expect(px('divider')).toBe(NUB_DIVIDER);
  });

  it('larguras derivadas: pílula = coluna + respiro; barra = conteúdo real; altura >= 76', () => {
    expect(NUB_WIDTH).toBe(NUB_COL_WIDTH + 2 * NUB_PAD);
    expect(NUB_BAR_WIDTH).toBe(NUB_PAD + NUB_BTN_WIDTH + NUB_PAD + NUB_DIVIDER + NUB_WIDTH);
    expect(NUB_HEIGHT).toBe(3 * NUB_BTN_HEIGHT + 2 * NUB_BTN_GAP + 2 * NUB_PAD); // Perguntar, Pausar e Parar
    expect(NUB_HEIGHT).toBeGreaterThanOrEqual(76);
  });
});
