import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { BrowserWindow, desktopCapturer, nativeImage, screen, systemPreferences } from 'electron';
import type { Frame } from './capture';
import { chooseTarget, findWindowSource, LIST_WINDOWS_JXA, parseWindows, type WinInfo } from './target';
import { listWindowsWin } from './win-windows';
import { isWindows } from '../platform';
import { riceDetectorBinary } from '../app/paths';
import { dHash, grayFromBitmap, HASH_H, HASH_W } from './phash';

/** Largura máxima guardada (o brief pede ~1280 px) e a qualidade do JPEG. */
export const SHOT_WIDTH = 1280;
export const JPEG_QUALITY = 70;

export type ScreenPermission = 'granted' | 'denied' | 'not-determined' | 'unsupported';

/** macOS pede a permissão de Gravação de Tela; no Windows o desktopCapturer funciona sem pedir nada. */
export function screenPermission(): ScreenPermission {
  if (process.env.RICE_SHOT_SOURCE_DIR) return 'granted'; // instância de teste com quadros prontos
  if (process.platform === 'win32') return 'granted';
  if (process.platform !== 'darwin') return 'unsupported';
  const status = systemPreferences.getMediaAccessStatus('screen');
  return status === 'granted' ? 'granted' : status === 'not-determined' ? 'not-determined' : 'denied';
}

/** O que a captura sabe sobre o momento: os apps da chamada (detector) e se vale capturar só a janela deles. */
export type GrabHint = { apps?: readonly string[]; preferWindow?: boolean };

const execFileAsync = promisify(execFile);

/** Janelas na tela, da frente para trás: macOS pelo CoreGraphics (JXA), Windows pelo rice-detector. Outros sistemas: vazio (vale a tela do cursor). */
async function listWindows(apps: readonly string[]): Promise<WinInfo[]> {
  if (isWindows()) return listWindowsWin(apps, riceDetectorBinary(), (r) => screen.screenToDipRect(null, r));
  if (process.platform !== 'darwin') return [];
  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', LIST_WINDOWS_JXA], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
    return parseWindows(stdout);
  } catch {
    return [];
  }
}

/**
 * Tira um quadro: a janela do app da chamada (se outra pessoa está mostrando algo) ou a tela que a contém; sem o app
 * da chamada, a tela do cursor, como antes. As janelas do Rice ficam protegidas contra captura só durante a foto.
 * Nunca pede a permissão do sistema: sem ela já concedida, devolve null.
 */
export async function grabScreen(hint: GrabHint = {}): Promise<Frame | null> {
  if (screenPermission() !== 'granted') return null;
  const displays = screen.getAllDisplays();
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? screen.getPrimaryDisplay();
  const windowList = hint.apps?.length ? await listWindows(hint.apps) : [];
  const target = chooseTarget({
    windows: windowList,
    displays: displays.map((d) => ({ id: d.id, bounds: d.bounds })),
    apps: hint.apps ?? [],
    cursorDisplayId: cursor.id,
    primaryDisplayId: screen.getPrimaryDisplay().id,
    preferWindow: hint.preferWindow === true,
  });
  const display = displays.find((d) => d.id === target.displayId) ?? cursor;
  const chosen = target.kind === 'window' ? windowList.find((w) => w.id === target.windowId) : undefined;
  const width = Math.min(SHOT_WIDTH, Math.round(display.size.width * display.scaleFactor));
  const height = Math.max(1, Math.round((width * display.size.height) / display.size.width));
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible());
  for (const w of windows) w.setContentProtection(true);
  try {
    if (target.kind === 'window') {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: SHOT_WIDTH, height: SHOT_WIDTH } });
      const wanted = chosen && isWindows() ? findWindowSource(sources, chosen) : sources.find((s) => s.id === `window:${target.windowId}:0`);
      const source = wanted ?? undefined;
      const frame = source && !source.thumbnail.isEmpty() ? frameFromImage(source.thumbnail) : null;
      if (frame) return frame; // senão cai na tela que contém a janela
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    return frameFromImage(source.thumbnail);
  } finally {
    for (const w of windows) if (!w.isDestroyed()) w.setContentProtection(false);
  }
}

/** Reduz uma imagem qualquer para o quadro guardado: no máximo SHOT_WIDTH de largura, JPEG e hash perceptual. */
export function frameFromImage(image: Electron.NativeImage): Frame | null {
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  const scaled = width > SHOT_WIDTH ? image.resize({ width: SHOT_WIDTH, quality: 'good' }) : image;
  const small = scaled.resize({ width: HASH_W, height: HASH_H, quality: 'good' });
  return { jpeg: scaled.toJPEG(JPEG_QUALITY), hash: dHash(grayFromBitmap(small.toBitmap(), HASH_W, HASH_H)) };
}

/**
 * SÓ PARA INSTÂNCIAS DE TESTE (RICE_SHOT_SOURCE_DIR): em vez da tela, devolve os quadros prontos de uma pasta, um por
 * rodada, em ordem e em círculo. Assim os testes isolados não dependem da permissão de Gravação de Tela nem mostram nada.
 */
export function grabFromFolder(folder: string): () => Promise<Frame | null> {
  let n = 0;
  return async () => {
    const files = readdirSync(folder).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
    if (files.length === 0) return null;
    return frameFromImage(nativeImage.createFromBuffer(readFileSync(join(folder, files[n++ % files.length]!))));
  };
}
