/** Escolha do que capturar: a janela (ou a tela que a contém) do app da chamada; sem ela, a tela do cursor. Lógica pura, sem Electron. */
export type Rect = { x: number; y: number; width: number; height: number };
export type WinInfo = { id: number; owner: string; pid: number; title: string; bounds: Rect };
export type DisplayInfo = { id: number; bounds: Rect };
export type Target = { kind: 'window'; windowId: number; displayId: number } | { kind: 'display'; displayId: number; reason: 'call-app' | 'cursor' | 'primary' };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Nomes pelos quais o mesmo app aparece no detector e como dono da janela. */
const ALIASES: string[][] = [
  ['zoom', 'zoom.us'],
  ['teams', 'microsoft teams', 'msteams', 'microsoft teams (work or school)'],
  ['google meet', 'meet'],
  ['slack'],
  ['discord'],
  ['webex', 'cisco webex meetings'],
  ['facetime'],
];
/** O título da janela de uma chamada (num navegador, a aba da chamada). */
const CALL_TITLE = /\b(meet|zoom|teams|webex|huddle|call|chamada|reuni|meeting|discord|whereby|jitsi)\b/i;
const MIN_W = 300;
const MIN_H = 200;

/** O dono da janela é um dos apps da chamada? (igualdade, "contém" nos dois sentidos e apelidos conhecidos). */
export function ownerMatches(owner: string, apps: readonly string[]): boolean {
  const o = norm(owner);
  if (!o) return false;
  return apps.some((app) => {
    const a = norm(app);
    if (!a) return false;
    if (o === a || (a.length >= 4 && o.includes(a)) || (o.length >= 4 && a.includes(o))) return true;
    return ALIASES.some((group) => group.some((n) => o === n || o.includes(n)) && group.some((n) => a === n || a.includes(n)));
  });
}

/** A janela da chamada: dono certo, tamanho de janela de verdade e, entre várias (abas/janelas do navegador), a que parece uma chamada, depois a da frente. `windows` vem da frente para trás. */
export function pickCallWindow(windows: readonly WinInfo[], apps: readonly string[]): WinInfo | null {
  let best: { win: WinInfo; score: number } | null = null;
  windows.forEach((win, index) => {
    if (!ownerMatches(win.owner, apps) || win.bounds.width < MIN_W || win.bounds.height < MIN_H) return;
    const score = (CALL_TITLE.test(win.title) ? 1000 : 0) - index;
    if (!best || score > best.score) best = { win, score };
  });
  return best ? (best as { win: WinInfo }).win : null;
}

const overlap = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** A tela que mais contém a janela (a que ela ocupa mais). */
export function displayForWindow(win: WinInfo, displays: readonly DisplayInfo[]): DisplayInfo | null {
  let best: DisplayInfo | null = null;
  let area = 0;
  for (const d of displays) {
    const a = overlap(win.bounds, d.bounds);
    if (a > area) {
      area = a;
      best = d;
    }
  }
  return best;
}

export type TargetInput = {
  windows: readonly WinInfo[];
  displays: readonly DisplayInfo[];
  /** Apps de chamada conhecidos (detector do microfone, reunião). */
  apps: readonly string[];
  cursorDisplayId: number | null;
  primaryDisplayId: number;
  /** Quando outra pessoa fala/mostra (áudio do sistema), a imagem está DENTRO da janela da chamada: captura só ela. */
  preferWindow: boolean;
};

export function chooseTarget(input: TargetInput): Target {
  const win = input.apps.length ? pickCallWindow(input.windows, input.apps) : null;
  const display = win ? displayForWindow(win, input.displays) : null;
  if (win && display) return input.preferWindow ? { kind: 'window', windowId: win.id, displayId: display.id } : { kind: 'display', displayId: display.id, reason: 'call-app' };
  if (input.cursorDisplayId !== null && input.displays.some((d) => d.id === input.cursorDisplayId)) return { kind: 'display', displayId: input.cursorDisplayId, reason: 'cursor' };
  return { kind: 'display', displayId: input.primaryDisplayId, reason: 'primary' };
}

/** Lê a saída JSON de `listWindowsScript` (descarta o que vier malformado). */
export function parseWindows(json: string): WinInfo[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x): WinInfo[] => {
      const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      const nums = [o.id, o.pid, o.x, o.y, o.w, o.h];
      if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n)) || typeof o.owner !== 'string') return [];
      return [{ id: o.id as number, owner: o.owner, pid: o.pid as number, title: typeof o.title === 'string' ? o.title : '', bounds: { x: o.x as number, y: o.y as number, width: o.w as number, height: o.h as number } }];
    });
  } catch {
    return [];
  }
}

/** JXA do macOS: janelas normais na tela, da frente para trás. Só dono, título e posição; sem permissão extra nem janela. */
export const LIST_WINDOWS_JXA = `ObjC.import('CoreGraphics');
const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0 && w.kCGWindowBounds).map((w) => ({ id: w.kCGWindowNumber, owner: w.kCGWindowOwnerName, pid: w.kCGWindowOwnerPID, title: w.kCGWindowName || '', x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height })));`;
