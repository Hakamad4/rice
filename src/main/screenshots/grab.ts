import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, desktopCapturer, nativeImage, screen, systemPreferences } from 'electron';
import type { Frame } from './capture';
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

/**
 * Tira um quadro da tela onde o usuário está trabalhando (a do cursor; senão a principal), SEM as janelas do Rice: elas
 * ficam protegidas contra captura só durante o instante da foto. Nunca dispara o pedido de permissão do sistema: sem a
 * permissão já concedida, devolve null.
 */
export async function grabScreen(): Promise<Frame | null> {
  if (screenPermission() !== 'granted') return null;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? screen.getPrimaryDisplay();
  const width = Math.min(SHOT_WIDTH, Math.round(display.size.width * display.scaleFactor));
  const height = Math.max(1, Math.round((width * display.size.height) / display.size.width));
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible());
  for (const w of windows) w.setContentProtection(true);
  try {
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
