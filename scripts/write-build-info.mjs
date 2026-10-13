// Parte do `npm run build:app`: grava out/build-info.json (commit, data, remote público e caminho do clone) para o app saber
// de onde veio e avisar de versão nova. O caminho do clone é local: fica só dentro do app (out/ não vai para o repositório).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Só o repositório público do Rice conta; qualquer outro remote (fork, repositório privado) fica de fora. */
export const PUBLIC_REPO = 'github.com/WalissonCF/rice';

/** "https://github.com/WalissonCF/rice.git", "git@github.com:WalissonCF/rice.git"… -> "github.com/WalissonCF/rice", ou null. */
export function publicRemote(url) {
  const m = /^(?:https:\/\/(?:[^@/]+@)?|git@|ssh:\/\/git@)github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? '').trim());
  if (!m) return null;
  const id = `github.com/${m[1]}/${m[2]}`;
  return id.toLowerCase() === PUBLIC_REPO.toLowerCase() ? PUBLIC_REPO : null;
}

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

export function buildInfo(root, now = new Date(), release = process.env.RICE_RELEASE === '1') {
  const sha = git(root, 'rev-parse', '--short=7', 'HEAD');
  return {
    commit: sha || null,
    commitDate: git(root, 'log', '-1', '--format=%cI') || null,
    date: now.toISOString(),
    remote: publicRemote(git(root, 'remote', 'get-url', 'origin')),
    clonePath: sha && !release ? git(root, 'rev-parse', '--show-toplevel') || null : null, // release (.dmg): o caminho da máquina que gerou não vai junto
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync('out', { recursive: true });
  writeFileSync(join('out', 'build-info.json'), JSON.stringify(buildInfo(process.cwd()), null, 2) + '\n');
}
