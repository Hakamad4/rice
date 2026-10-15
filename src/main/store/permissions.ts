import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MEETING_FILES } from './meeting-files';
import { restrictMode } from '../platform/fs';
import { isWindows } from '../platform';

/**
 * Dados do Rice (áudio, transcrição, notas, chats, configurações) são só do usuário: pastas 0700 e arquivos 0600.
 * Em novos arquivos o `umask` 077 do processo cuida disso; aqui se corrige o que já existia (criado com 0755/0644).
 * Não segue links simbólicos e nunca lança: é melhor-esforço.
 */
export async function tightenTree(path: string, depth = 3): Promise<number> {
  if (isWindows()) return 0; // ACLs do perfil do usuário no lugar de 0700/0600
  let changed = 0;
  let info;
  try {
    info = await lstat(path);
  } catch {
    return 0;
  }
  if (info.isSymbolicLink()) return 0;
  const want = info.isDirectory() ? 0o700 : 0o600;
  if ((info.mode & 0o777) !== want && (info.mode & 0o077) !== 0) {
    try {
      await restrictMode(path, want);
      changed++;
    } catch {
      // sem dono do arquivo ou volume sem permissões: segue
    }
  }
  if (info.isDirectory() && depth > 0) {
    let names: string[] = [];
    try {
      names = await readdir(path);
    } catch {
      return changed;
    }
    for (const name of names) changed += await tightenTree(join(path, name), depth - 1);
  }
  return changed;
}

/** Uma pasta de reunião é a que tem `meta.json` (mesma regra de `listMeetingDirs`). */
async function isMeetingDir(dir: string): Promise<boolean> {
  try {
    return (await lstat(join(dir, MEETING_FILES.meta))).isFile();
  } catch {
    return false;
  }
}

/**
 * Reuniões (pastas com `meta.json`) e `.rice` da pasta escolhida, e os dados do app em `userData`. A pasta em si e o que mais o
 * usuário guardar nela não são mexidos: `~/Rice` pode ser também o clone do código (no APFS `~/rice` é a mesma pasta), e trancar
 * `install.sh`, `update.sh` e `node_modules` com 0600 quebra o update.
 * Meetings (folders with `meta.json`) and `.rice` in the chosen folder, plus the app data in `userData`. The folder itself and anything
 * else the user keeps there are left alone: `~/Rice` may also be the source clone (on APFS `~/rice` is the same folder), and locking
 * `install.sh`, `update.sh` and `node_modules` to 0600 breaks the update.
 */
export async function tightenAppData(root: string, userData: string): Promise<number> {
  let changed = 0;
  try {
    for (const name of await readdir(root)) {
      const path = join(root, name);
      if (name === '.rice' || (!name.startsWith('.') && (await isMeetingDir(path)))) changed += await tightenTree(path, 3);
    }
  } catch {
    // pasta ainda não existe
  }
  for (const name of ['settings.json', 'secrets', 'spool', 'claude-cwd', 'codex-cwd', 'gemini-cwd', 'opencode-cwd']) changed += await tightenTree(join(userData, name), 3);
  try {
    for (const name of await readdir(userData)) if (/\.bin$/.test(name)) changed += await tightenTree(join(userData, name), 0); // token do Google e o legado do Claude
  } catch {
    // sem userData
  }
  return changed;
}
