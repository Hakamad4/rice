import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { envGet, isWindows } from './index';

/** Caminho do Windows Terminal (`wt.exe`, alias de execução em WindowsApps) se estiver instalado. */
export function windowsTerminal(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  const local = envGet(env, 'LOCALAPPDATA') ?? win32.join(homedir(), 'AppData', 'Local');
  const wt = win32.join(local, 'Microsoft', 'WindowsApps', 'wt.exe');
  return exists(wt) ? wt : null;
}

/** Linha de comando que abre o script numa aba nova do Windows Terminal. */
export const wtArgs = (script: string): string[] => ['new-tab', '--title', 'Rice', script];

/**
 * Abre o script de "Continuar no terminal". Mac: o app padrão do `.command` (Terminal). Windows: Windows Terminal (`wt.exe`) se existir;
 * senão o `shell.openPath` do `.cmd`, que abre o cmd.exe. Devolve texto de erro ou ''.
 */
export async function openInTerminal(
  script: string,
  openPath: (path: string) => Promise<string>,
  launch: (command: string, args: string[]) => void = (c, a) => spawn(c, a, { detached: true, stdio: 'ignore', windowsHide: false }).unref(),
  wt: string | null = isWindows() ? windowsTerminal() : null,
): Promise<string> {
  if (!isWindows() || !wt) return openPath(script);
  try {
    launch(wt, wtArgs(script));
    return '';
  } catch {
    return openPath(script);
  }
}
