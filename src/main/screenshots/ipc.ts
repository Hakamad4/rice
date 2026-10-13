import { readFile } from 'node:fs/promises';
import { isShotFile, type Shot } from '../../shared/screenshots';
import { listShots, shotPath } from './store';
import { discardShot } from './capture';

export type ScreenshotsHost = {
  handle: (channel: string, fn: (e: unknown, ...args: any[]) => unknown) => void;
  send: (channel: string, payload: unknown) => void;
  /** Valida que a pasta é uma reunião dentro da raiz (nunca aceita caminho arbitrário do renderer). */
  checkedDir: (dir: unknown) => Promise<string>;
  /** Miniatura pronta (data URL) de um JPEG que já passou pela validação de nome. */
  thumbnail: (path: string, width: number) => string | null;
  enabled: () => boolean;
  setEnabled: (on: boolean) => Promise<void>;
  /** Estado do que a captura precisa: provedor, se ele vê imagens e a permissão da plataforma. */
  environment: () => Promise<{ provider: string; seesImages: boolean; permission: 'granted' | 'denied' | 'not-determined' | 'unsupported' }>;
  openPrivacy: () => void;
  isRecording: (dir: string) => boolean;
  /** Captura manual (botão ou atalho): só vale gravando, com a opção ligada. */
  captureNow: () => Promise<boolean>;
};

const THUMB_WIDTH = 160; // 64 px de altura a 16:10 ficam em ~100 px; o dobro para telas de alta densidade

export function registerScreenshots(host: ScreenshotsHost): { changed: (dir: string, shots: Shot[]) => void } {
  const changed = (dir: string, shots: Shot[]) => host.send('screenshots:changed', { dir, count: shots.length });

  host.handle('screenshots:status', async () => ({ enabled: host.enabled(), ...(await host.environment()) }));
  host.handle('screenshots:set-enabled', async (_e, on: unknown) => {
    await host.setEnabled(on === true);
    return { ok: true as const, enabled: host.enabled(), ...(await host.environment()) };
  });
  host.handle('screenshots:capture-now', async () => ({ ok: host.enabled() ? await host.captureNow() : false }));
  host.handle('screenshots:open-privacy', () => host.openPrivacy());
  host.handle('screenshots:list', async (_e, rawDir: unknown) => {
    const dir = await host.checkedDir(rawDir);
    return { shots: await listShots(dir), recording: host.isRecording(dir) };
  });
  host.handle('screenshots:thumb', async (_e, rawDir: unknown, file: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const path = isShotFile(file) ? await shotPath(dir, file) : null;
    return path ? host.thumbnail(path, THUMB_WIDTH) : null;
  });
  host.handle('screenshots:image', async (_e, rawDir: unknown, file: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const path = isShotFile(file) ? await shotPath(dir, file) : null;
    if (!path) return null;
    try {
      return `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}`;
    } catch {
      return null;
    }
  });
  host.handle('screenshots:remove', async (_e, rawDir: unknown, file: unknown) => {
    const dir = await host.checkedDir(rawDir);
    return { ok: await discardShot(dir, String(file), changed) };
  });
  return { changed };
}
