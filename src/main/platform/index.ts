import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

/**
 * Camada de plataforma: tudo que muda entre macOS e Windows passa por aqui. Lê `process.platform` a cada chamada (não em
 * constante), para os testes simularem o Windows no Mac.
 */
export type PlatformId = 'mac' | 'win' | 'linux';

export function platformId(): PlatformId {
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
}
export const isMac = (): boolean => process.platform === 'darwin';
export const isWindows = (): boolean => process.platform === 'win32';

/** Nome do executável: `rice-audio` → `rice-audio.exe` no Windows. */
export function exeName(name: string): string {
  return isWindows() ? `${name}.exe` : name;
}

/** Separador do PATH (`;` no Windows, `:` no Mac), lido a cada chamada como o resto da camada. */
export const pathDelimiter = (): string => (isWindows() ? win32.delimiter : posix.delimiter);

/** Variável de ambiente sem diferenciar caixa (no Windows `Path`, `PATH` e `path` são a mesma). */
export function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (!isWindows()) return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** Nome real da variável PATH no ambiente (`Path` no Windows). */
export function pathKey(env: NodeJS.ProcessEnv): string {
  return (isWindows() && Object.keys(env).find((k) => k.toLowerCase() === 'path')) || 'PATH';
}

type DirEnv = { home?: string; env?: NodeJS.ProcessEnv };

/** Pastas onde os CLIs de IA costumam estar, em ordem de preferência. */
export function cliDirs({ home = homedir(), env = process.env }: DirEnv = {}): string[] {
  if (isWindows()) {
    const appData = envGet(env, 'APPDATA') ?? win32.join(home, 'AppData', 'Roaming');
    const local = envGet(env, 'LOCALAPPDATA') ?? win32.join(home, 'AppData', 'Local');
    return [
      win32.join(home, '.local', 'bin'), // instalador nativo do Claude Code
      win32.join(appData, 'npm'), // npm i -g
      win32.join(local, 'Programs', 'claude'),
      win32.join(home, '.opencode', 'bin'),
      win32.join(home, '.claude', 'local'),
      win32.join(home, 'scoop', 'shims'),
      win32.join(local, 'Microsoft', 'WinGet', 'Links'),
    ];
  }
  return [posix.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', posix.join(home, '.npm-global', 'bin'), posix.join(home, '.opencode', 'bin'), posix.join(home, '.claude', 'local')];
}

/** Extensões que um CLI pode ter: nenhuma no Mac; `.exe` (instalador nativo) ou `.cmd` (shim do npm) no Windows. */
export function cliExtensions(): string[] {
  return isWindows() ? ['.exe', '.cmd'] : [''];
}

/** Pastas do PATH do processo, para achar o CLI quando ele não está nos lugares comuns (substitui o `where.exe`, sem spawn). */
export function pathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (envGet(env, 'PATH') ?? '').split(pathDelimiter()).filter(Boolean);
}

/**
 * Procura o CLI `name` em `extra`, nas pastas comuns e no PATH. Devolve o caminho absoluto existente ou `null`.
 * `exists` é injetável nos testes.
 */
export function findCli(name: string, extra: string[] = [], opts: DirEnv & { exists?: (path: string) => boolean } = {}): string | null {
  const exists = opts.exists ?? existsSync;
  const env = opts.env ?? process.env;
  const dirs = [...extra, ...cliDirs(opts), ...(isWindows() ? pathDirs(env) : [])]; // no Mac o app aberto pelo Finder tem PATH mínimo: só os lugares comuns
  const sep = isWindows() ? win32 : posix;
  for (const dir of dirs) for (const ext of cliExtensions()) {
    const candidate = sep.join(dir, name + ext);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** `.cmd`/`.bat` (shims do npm) não rodam direto: precisam de cmd.exe ou do `.js` do pacote (ver spawn.ts). */
export const isCmdScript = (binary: string): boolean => isWindows() && /\.(cmd|bat)$/i.test(binary);

/** Caminho absoluto na convenção da plataforma (`/x` no Mac, `C:\x` no Windows). */
export const isAbsolutePath = (path: string): boolean => (isWindows() ? win32 : posix).isAbsolute(path);

/** A pasta pessoal para os testes e para a lista de pastas bloqueadas. */
export function userHome(): string {
  return homedir();
}

/** Só instâncias de teste (RICE_BENCH=1 + RICE_FAKE_PLATFORM=win32): mostra no Mac como a UI do Windows fica sem agy, agenda do sistema e Lembretes. */
const fakeWindows = (): boolean => process.env.RICE_BENCH === '1' && process.env.RICE_FAKE_PLATFORM === 'win32';

/** O Antigravity (`agy`) só roda dentro do `sandbox-exec` do macOS: no Windows não há equivalente, então fica indisponível. */
export const agySupported = (): boolean => isMac() && !fakeWindows();

/** Agenda do sistema (Calendário e Lembretes) só existe no macOS; no Windows a agenda vem do Google. */
export const systemCalendarSupported = (): boolean => isMac() && !fakeWindows();
export const remindersSupported = (): boolean => isMac() && !fakeWindows();
