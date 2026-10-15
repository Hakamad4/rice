import { describe, expect, test } from 'vitest';
import { chooseTarget, displayForWindow, findWindowSource, ownerMatches, parseWindows, pickCallWindow, windowsToDip, type DisplayInfo, type WinInfo } from '../../src/main/screenshots/target';

const D1: DisplayInfo = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const D2: DisplayInfo = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
const win = (id: number, owner: string, x: number, y: number, w = 1200, h = 800, title = ''): WinInfo => ({ id, owner, pid: id * 10, title, bounds: { x, y, width: w, height: h } });
const base = { displays: [D1, D2], cursorDisplayId: 1, primaryDisplayId: 1, preferWindow: false };

describe('dono da janela × app da chamada', () => {
  test('igualdade, "contém" e apelidos (Zoom é zoom.us, Teams é Microsoft Teams)', () => {
    expect(ownerMatches('zoom.us', ['Zoom'])).toBe(true);
    expect(ownerMatches('Microsoft Teams', ['Teams'])).toBe(true);
    expect(ownerMatches('Google Chrome', ['Google Chrome'])).toBe(true);
    expect(ownerMatches('Slack', ['Slack'])).toBe(true);
    expect(ownerMatches('Terminal', ['Zoom', 'Google Chrome'])).toBe(false);
    expect(ownerMatches('', ['Zoom'])).toBe(false);
    expect(ownerMatches('Code', ['Co'])).toBe(false); // nome curto demais não vale "contém"
  });
});

describe('janela da chamada', () => {
  test('a da frente do app certo; janelinhas e outros apps não contam', () => {
    const w = [win(1, 'Terminal', 0, 0), win(2, 'zoom.us', 2000, 100, 100, 100), win(3, 'zoom.us', 2100, 100), win(4, 'zoom.us', 50, 50)];
    expect(pickCallWindow(w, ['Zoom'])?.id).toBe(3); // a de 100x100 é só um controle; a 3 está na frente da 4
    expect(pickCallWindow(w, ['Teams'])).toBeNull();
  });
  test('num navegador com várias janelas, a que parece uma chamada ganha da da frente', () => {
    const w = [win(1, 'Google Chrome', 0, 0, 1400, 900, 'Documento - Google Docs'), win(2, 'Google Chrome', 100, 100, 1400, 900, 'Meet - abc-defg-hij')];
    expect(pickCallWindow(w, ['Google Chrome'])?.id).toBe(2);
  });
});

describe('tela que contém a janela', () => {
  test('a que ela ocupa mais, mesmo atravessando duas', () => {
    expect(displayForWindow(win(1, 'x', 100, 100), [D1, D2])?.id).toBe(1);
    expect(displayForWindow(win(1, 'x', 2000, 100), [D1, D2])?.id).toBe(2);
    expect(displayForWindow(win(1, 'x', 1500, 100, 1000, 800), [D1, D2])?.id).toBe(2); // 420 px na 1, 580 na 2
    expect(displayForWindow(win(1, 'x', 9000, 9000), [D1, D2])).toBeNull();
  });
});

describe('escolha do alvo', () => {
  test('o app da chamada está no 2º monitor: captura a 2ª tela, não a do cursor', () => {
    const t = chooseTarget({ ...base, windows: [win(7, 'zoom.us', 2200, 200)], apps: ['Zoom'], cursorDisplayId: 1 });
    expect(t).toEqual({ kind: 'display', displayId: 2, reason: 'call-app' });
  });
  test('fala de outra pessoa: só a janela da chamada', () => {
    const t = chooseTarget({ ...base, windows: [win(7, 'zoom.us', 2200, 200)], apps: ['Zoom'], preferWindow: true });
    expect(t).toEqual({ kind: 'window', windowId: 7, displayId: 2 });
  });
  test('sem janela do app (ou sem app): tela do cursor; cursor fora de qualquer tela: a principal', () => {
    expect(chooseTarget({ ...base, windows: [win(1, 'Terminal', 0, 0)], apps: ['Zoom'], cursorDisplayId: 2 })).toEqual({ kind: 'display', displayId: 2, reason: 'cursor' });
    expect(chooseTarget({ ...base, windows: [], apps: [], cursorDisplayId: 2 })).toEqual({ kind: 'display', displayId: 2, reason: 'cursor' });
    expect(chooseTarget({ ...base, windows: [], apps: ['Zoom'], cursorDisplayId: 99 })).toEqual({ kind: 'display', displayId: 1, reason: 'primary' });
    expect(chooseTarget({ ...base, windows: [], apps: [], cursorDisplayId: null })).toEqual({ kind: 'display', displayId: 1, reason: 'primary' });
  });
  test('janela fora de qualquer tela conhecida: cai no cursor', () => {
    expect(chooseTarget({ ...base, windows: [win(7, 'zoom.us', 9000, 9000)], apps: ['Zoom'], cursorDisplayId: 1, preferWindow: true })).toEqual({ kind: 'display', displayId: 1, reason: 'cursor' });
  });
});

describe('lista de janelas do sistema', () => {
  test('lê o JSON e descarta o que vier malformado', () => {
    const json = JSON.stringify([{ id: 5, owner: 'zoom.us', pid: 9, title: 'Zoom Meeting', x: 10, y: 20, w: 800, h: 600 }, { id: 'x' }, null, { id: 6, owner: 'A', pid: 1, x: 0, y: 0, w: 'a', h: 1 }]);
    expect(parseWindows(json)).toEqual([{ id: 5, owner: 'zoom.us', pid: 9, title: 'Zoom Meeting', bounds: { x: 10, y: 20, width: 800, height: 600 } }]);
    expect(parseWindows('{quebrado')).toEqual([]);
    expect(parseWindows('{}')).toEqual([]);
  });
});

describe('Windows: janelas do rice-detector --list-windows', () => {
  test('o JSON do helper (id = HWND, owner = nome do app) vira WinInfo; campos extras são ignorados e o malformado cai fora', () => {
    const json = JSON.stringify([
      { id: 1049802, owner: 'Zoom', pid: 300, exe: 'Zoom.exe', title: 'Zoom Meeting', x: 100, y: 100, w: 1280, h: 720, monitor: 65537, mx: 0, my: 0, mw: 1920, mh: 1080 },
      { id: 'x', owner: 'Zoom' },
    ]);
    expect(parseWindows(json)).toEqual([{ id: 1049802, owner: 'Zoom', pid: 300, title: 'Zoom Meeting', bounds: { x: 100, y: 100, width: 1280, height: 720 } }]);
    expect(parseWindows('não é json')).toEqual([]);
  });

  test('retângulos físicos viram DIP com a conversão do Electron (200% de escala)', () => {
    const out = windowsToDip([win(1, 'Zoom', 400, 200, 2000, 1000)], (r) => ({ x: r.x / 2, y: r.y / 2, width: r.width / 2, height: r.height / 2 }));
    expect(out[0]!.bounds).toEqual({ x: 200, y: 100, width: 1000, height: 500 });
  });

  test('escolhe a tela da janela da call em dois monitores; a própria janela quando outra pessoa fala', () => {
    const w = [win(1, 'Code', 0, 0), win(2, 'Zoom', 2100, 100, 1280, 720, 'Zoom Meeting')];
    expect(chooseTarget({ ...base, windows: w, apps: ['Zoom'], preferWindow: false })).toEqual({ kind: 'display', displayId: 2, reason: 'call-app' });
    expect(chooseTarget({ ...base, windows: w, apps: ['Zoom'], preferWindow: true })).toEqual({ kind: 'window', windowId: 2, displayId: 2 });
  });

  test('a janela da reunião do Zoom ganha da janela inicial; Meet no Chrome/Edge pela aba; Whereby e Teams pelo nome do app', () => {
    const zoom = [win(1, 'Zoom', 0, 0, 1000, 700, 'Zoom Workplace'), win(2, 'Zoom', 50, 50, 1280, 720, 'Zoom Meeting')];
    expect(pickCallWindow(zoom, ['Zoom'])?.id).toBe(2);
    const edge = [win(1, 'Microsoft Edge', 0, 0, 1400, 900, 'Notícias - Microsoft Edge'), win(2, 'Microsoft Edge', 0, 0, 1400, 900, 'Videochamada - Microsoft Edge')];
    expect(pickCallWindow(edge, ['Microsoft Edge'])?.id).toBe(2);
    expect(pickCallWindow([win(1, 'Whereby', 0, 0)], ['Whereby'])?.id).toBe(1);
    expect(pickCallWindow([win(1, 'Microsoft Teams', 0, 0, 1200, 800, 'Reunião | Microsoft Teams')], ['Microsoft Teams'])?.id).toBe(1);
  });

  test('fallback: sem janela do app (lista vazia, app minimizado) vale a tela do cursor, e o app errado não conta', () => {
    expect(chooseTarget({ ...base, cursorDisplayId: 2, windows: [], apps: ['Zoom'], preferWindow: true })).toEqual({ kind: 'display', displayId: 2, reason: 'cursor' });
    expect(chooseTarget({ ...base, windows: [win(1, 'Code', 0, 0)], apps: ['Zoom'], preferWindow: true })).toEqual({ kind: 'display', displayId: 1, reason: 'cursor' });
    // janela fora de todas as telas (monitor desligado no meio da call): tela do cursor
    expect(chooseTarget({ ...base, windows: [win(1, 'Zoom', 9000, 9000)], apps: ['Zoom'], preferWindow: true })).toEqual({ kind: 'display', displayId: 1, reason: 'cursor' });
  });

  test('fonte do desktopCapturer: pelo HWND (window:<hwnd>:0) e, sem ele, pelo título só se for único', () => {
    const sources = [{ id: 'window:11:0', name: 'Code' }, { id: 'window:22:0', name: 'Zoom Meeting' }, { id: 'window:33:0', name: 'Zoom Meeting' }];
    expect(findWindowSource(sources, { id: 22, title: 'qualquer' })?.id).toBe('window:22:0');
    expect(findWindowSource(sources, { id: 99, title: 'Code' })?.id).toBe('window:11:0');
    expect(findWindowSource(sources, { id: 99, title: 'Zoom Meeting' })).toBeNull(); // ambíguo: melhor a tela do que a janela errada
    expect(findWindowSource(sources, { id: 99, title: '' })).toBeNull();
  });
});
