import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCli, isWindows } from '../platform';

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

/**
 * Binário nativo. Mac: o compilado no repositório (`native/<nome>/.build/release`) ou, no app empacotado, o de `native-bin/`.
 * Windows: o do build CMake (`native/win/build/Release`) ou, empacotado, `native-bin/win/<nome>.exe`.
 */
export function nativeBinary(name: string, exists: (path: string) => boolean = existsSync, root: string = repoRoot(), flavor: typeof posix = pathFlavor()): string {
  if (flavor === win32) {
    const exe = `${name}.exe`;
    const dev = [
      flavor.join(root, 'native', 'win', 'build', 'Release', exe),
      flavor.join(root, 'native', 'win', 'build', exe),
      flavor.join(root, 'native', 'translate', 'build', 'Release', exe), // rice-translate (CMake próprio)
      flavor.join(root, 'native', 'translate', 'build', exe),
    ].find((p) => exists(p));
    return dev ?? flavor.join(root, 'native-bin', 'win', exe);
  }
  const built = flavor.join(root, 'native', name === 'rice-translate' ? 'translate' : name, '.build', 'release', name);
  return exists(built) ? built : flavor.join(root, 'native-bin', name);
}

/** As regras de caminho da plataforma (`C:\\Users\\José da Silva\\…` no Windows, `/Users/…` no Mac); injetável para testar uma plataforma na outra. */
export const pathFlavor = (): typeof posix => (isWindows() ? win32 : posix);

export function riceAudioBinary(): string {
  return process.env.RICE_AUDIO_BIN ?? nativeBinary('rice-audio');
}

export function riceDetectorBinary(): string {
  return process.env.RICE_DETECTOR_BIN ?? nativeBinary('rice-detector');
}

/** Sidecar da tradução offline. Mac: `scripts/build-native.sh` (CMake em `native/translate/.build/release`); Windows: `native/translate/build`. */
export function riceTranslateBinary(): string {
  return process.env.RICE_TRANSLATE_BIN ?? nativeBinary('rice-translate');
}

/** Claude Code: `claude.exe` (instalador nativo) ou `claude.cmd` (npm) no Windows; `claude` no PATH se não achar. */
export function claudeBinary(exists?: (path: string) => boolean): string {
  return findCli('claude', [], exists ? { exists } : {}) ?? 'claude';
}

/** CLI `name` nos lugares comuns e no PATH; o próprio nome se não achar (o spawn falha com ENOENT e a UI explica). */
function findBinary(name: string, extra: string[]): string {
  return findCli(name, extra) ?? name;
}

/** Codex CLI (assinatura do ChatGPT); `codex` no PATH se não achar nos lugares comuns. */
export function codexBinary(): string {
  return process.env.RICE_CODEX_BIN ?? findBinary('codex', []); // RICE_CODEX_BIN: instância de teste com um codex falso
}

/** Antigravity CLI (`agy`, em `~/.local/bin`). Só roda no macOS (sandbox-exec): ver `agySupported()`. */
export function agyBinary(): string {
  return process.env.RICE_AGY_BIN ?? findBinary('agy', [join(homedir(), '.local', 'bin')]);
}

/** OpenCode CLI (instala em `~/.opencode/bin`). */
export function opencodeBinary(): string {
  return process.env.RICE_OPENCODE_BIN ?? findBinary('opencode', [join(homedir(), '.opencode', 'bin')]);
}

/** `/Users/ana/Rice` → `~/Rice` (só para mostrar; o caminho real continua o completo). */
export function tildify(path: string, home: string = homedir(), flavor: typeof posix = pathFlavor()): string {
  const norm = (p: string) => (flavor === win32 ? p.toLowerCase() : p); // no Windows C:\\Users\\Ana e c:\\users\\ana são a mesma pasta
  if (norm(path) === norm(home)) return '~';
  return norm(path).startsWith(norm(home) + flavor.sep) ? `~${path.slice(home.length)}` : path;
}

/** Verdadeiro se `dir` é a própria raiz ou está dentro dela (sem seguir symlinks). */
export function isInsideRoot(root: string, dir: string, flavor: typeof posix = pathFlavor()): boolean {
  const norm = (p: string) => flavor.resolve(flavor === win32 ? p.toLowerCase() : p);
  const rel = flavor.relative(norm(root), norm(dir));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + flavor.sep) && !flavor.isAbsolute(rel));
}
