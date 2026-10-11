import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { t } from '../i18n';

/** Pastas com credenciais que nunca viram "pasta de trabalho", nem como subpasta. */
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.claude', '.codex', '.gemini', '.config', '.kube', '.docker', 'Library/Keychains', 'Library/Application Support'];

/**
 * Valida a pasta de trabalho do War room (acesso SOMENTE LEITURA). Recusa a raiz, a pasta pessoal inteira (e qualquer pasta que a
 * contenha, como /Users) e as pastas de credenciais. Devolve o caminho real (sem links simbólicos).
 */
export async function checkWorkFolder(raw: unknown, home: string = homedir()): Promise<{ ok: true; folder: string } | { ok: false; message: string }> {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return { ok: false, message: t('warroom.err.folder') };
  let real: string;
  try {
    real = await realpath(raw);
    if (!(await stat(real)).isDirectory()) return { ok: false, message: t('warroom.err.folder') };
  } catch {
    return { ok: false, message: t('warroom.err.folder') };
  }
  const realHome = await realpath(home).catch(() => home);
  const contains = (outer: string, inner: string) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
  if (real === sep || contains(real, realHome)) return { ok: false, message: t('warroom.err.folder-broad') };
  if (SECRET_DIRS.some((d) => contains(join(realHome, d), real))) return { ok: false, message: t('warroom.err.folder-secret') };
  return { ok: true, folder: real };
}
