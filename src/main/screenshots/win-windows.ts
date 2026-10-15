import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseWindows, windowsToDip, type Rect, type WinInfo } from './target';

const execFileAsync = promisify(execFile);

/**
 * Janelas dos apps da chamada no Windows: `rice-detector.exe --list-windows --app <nome>...` responde com HWND, dono, título e
 * retângulo em pixels físicos (da frente para trás). `toDip` converte para as unidades das telas do Electron
 * (`screen.screenToDipRect(null, r)`). Qualquer falha (sem o binário, tempo esgotado, saída ruim) = lista vazia, e a captura cai na tela do cursor.
 */
export async function listWindowsWin(apps: readonly string[], binary: string, toDip: (r: Rect) => Rect): Promise<WinInfo[]> {
  if (apps.length === 0) return [];
  try {
    const { stdout } = await execFileAsync(binary, ['--list-windows', ...apps.flatMap((a) => ['--app', a])], { timeout: 3000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return windowsToDip(parseWindows(stdout), toDip);
  } catch {
    return [];
  }
}
