import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Dados do Rice (áudio, transcrição, notas, chats, configurações) são só do usuário: pastas 0700 e arquivos 0600.
 * Em novos arquivos o `umask` 077 do processo cuida disso; aqui se corrige o que já existia (criado com 0755/0644).
 * Não segue links simbólicos e nunca lança: é melhor-esforço.
 */
export async function tightenTree(path: string, depth = 3): Promise<number> {
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
      await chmod(path, want);
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

/** Reuniões e `.rice` da pasta escolhida (a pasta em si é do usuário e não é mexida) e os dados do app em `userData`. */
export async function tightenAppData(root: string, userData: string): Promise<number> {
  let changed = 0;
  try {
    for (const name of await readdir(root)) {
      if (name.startsWith('.') && name !== '.rice') continue;
      changed += await tightenTree(join(root, name), 3);
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
