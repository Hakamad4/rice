import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { t } from '../i18n';
import { envGet, isWindows } from '../platform';

/** Pastas com credenciais que nunca viram "pasta de trabalho", nem como subpasta. */
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.claude', '.codex', '.gemini', '.config', '.kube', '.docker', 'Library/Keychains', 'Library/Application Support'];
/** Windows: `AppData` guarda os dados de todos os apps (tokens do navegador, credenciais do Git, perfis); `.ssh` e companhia ficam na pasta pessoal. */
const SECRET_DIRS_WIN = ['.ssh', '.aws', '.gnupg', '.claude', '.codex', '.gemini', '.config', '.kube', '.docker', 'AppData', 'NTUSER.DAT'];
/** Windows: pastas do sistema, fora da pasta pessoal. */
const SYSTEM_DIRS_WIN = ['SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'ProgramW6432'];

/**
 * Valida a pasta de trabalho do War room (acesso SOMENTE LEITURA). Recusa a raiz, a pasta pessoal inteira (e qualquer pasta que a
 * contenha, como /Users ou C:\Users) e as pastas de credenciais. Devolve o caminho real (sem links simbólicos).
 * No Windows a comparação ignora maiúsculas e minúsculas (NTFS) e as barras de `\\\\?\\` não passam.
 */
export async function checkWorkFolder(raw: unknown, home: string = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; folder: string } | { ok: false; message: string }> {
  const win = isWindows();
  const absolute = typeof raw === 'string' && (win ? /^[a-zA-Z]:[\\/]/.test(raw) && !raw.startsWith('\\\\?\\') : raw.startsWith('/'));
  if (typeof raw !== 'string' || !absolute) return { ok: false, message: t('warroom.err.folder') };
  let real: string;
  try {
    real = await realpath(raw);
    if (!(await stat(real)).isDirectory()) return { ok: false, message: t('warroom.err.folder') };
  } catch {
    return { ok: false, message: t('warroom.err.folder') };
  }
  const realHome = await realpath(home).catch(() => home);
  const reason = blockedReason(real, realHome, env, win);
  if (reason) return { ok: false, message: t(reason) };
  return { ok: true, folder: real };
}

/** Só a regra (sem disco): `warroom.err.folder-broad`, `warroom.err.folder-secret` ou null se a pasta pode ser usada. Exportada para testar o Windows no Mac. */
export function blockedReason(real: string, realHome: string, env: NodeJS.ProcessEnv, win: boolean): 'warroom.err.folder-broad' | 'warroom.err.folder-secret' | null {
  const p = win ? win32 : posix;
  const norm = (x: string) => (win ? x.toLowerCase() : x);
  const contains = (outer: string, inner: string) => {
    const o = norm(outer);
    const i = norm(inner);
    return i === o || i.startsWith(o.endsWith(p.sep) ? o : o + p.sep);
  };
  if (real === p.sep || (win && /^[a-zA-Z]:\\?$/.test(real)) || contains(real, realHome)) return 'warroom.err.folder-broad';
  if ((win ? SECRET_DIRS_WIN : SECRET_DIRS).some((d) => contains(p.join(realHome, d), real))) return 'warroom.err.folder-secret';
  if (win && SYSTEM_DIRS_WIN.some((name) => { const dir = envGet(env, name); return !!dir && contains(dir, real); })) return 'warroom.err.folder-secret';
  return null;
}
