import { execFile } from 'node:child_process';
import { isWindows } from './index';

/** Encerra um processo e seus filhos. Windows: `taskkill /T /F` (sem shell); Mac/Linux: SIGKILL no grupo, se o processo for líder. */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (isWindows()) {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // já saiu
    }
  }
}
