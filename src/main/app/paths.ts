import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sobe a partir deste arquivo até achar o package.json do Rice (funciona em src/ e em out/). */
export function repoRoot(): string {
  // __dirname existe no bundle CJS do Electron e no Vitest; em ESM puro (tsx) usa import.meta.url.
  let dir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    // no repositório existe `native/`; no app empacotado, `native-bin/` (binários já compilados)
    if (existsSync(join(dir, 'package.json')) && (existsSync(join(dir, 'native')) || existsSync(join(dir, 'native-bin')))) return dir;
    dir = dirname(dir);
  }
  throw new Error('não encontrei a raiz do repositório do Rice');
}

/** Binário nativo: o compilado no repositório (`native/<nome>/.build/release`) ou, no app empacotado, o de `native-bin/`. */
function nativeBinary(name: string): string {
  const built = join(repoRoot(), 'native', name, '.build', 'release', name);
  return existsSync(built) ? built : join(repoRoot(), 'native-bin', name);
}

export function riceAudioBinary(): string {
  return process.env.RICE_AUDIO_BIN ?? nativeBinary('rice-audio');
}

export function riceDetectorBinary(): string {
  return process.env.RICE_DETECTOR_BIN ?? nativeBinary('rice-detector');
}

export function claudeBinary(): string {
  const candidates = [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return candidates.find((p) => existsSync(p)) ?? 'claude';
}

function findBinary(name: string, extra: string[]): string {
  const candidates = [...extra, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, join(homedir(), '.local', 'bin', name), join(homedir(), '.npm-global', 'bin', name)];
  return candidates.find((p) => existsSync(p)) ?? name;
}

/** Codex CLI (assinatura do ChatGPT); `codex` no PATH se não achar nos lugares comuns. */
export function codexBinary(): string {
  return process.env.RICE_CODEX_BIN ?? findBinary('codex', []); // RICE_CODEX_BIN: instância de teste com um codex falso
}

/** Antigravity CLI (`agy`, em `~/.local/bin`). */
export function agyBinary(): string {
  return process.env.RICE_AGY_BIN ?? findBinary('agy', [join(homedir(), '.local', 'bin', 'agy')]);
}

/** OpenCode CLI (instala em `~/.opencode/bin`). */
export function opencodeBinary(): string {
  return process.env.RICE_OPENCODE_BIN ?? findBinary('opencode', [join(homedir(), '.opencode', 'bin', 'opencode')]);
}

/** `/Users/ana/Rice` → `~/Rice` (só para mostrar; o caminho real continua o completo). */
export function tildify(path: string, home: string = homedir()): string {
  if (path === home) return '~';
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** Verdadeiro se `dir` é a própria raiz ou está dentro dela (sem seguir symlinks). */
export function isInsideRoot(root: string, dir: string): boolean {
  const rel = relative(resolve(root), resolve(dir));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}
