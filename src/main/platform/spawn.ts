import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { envGet, isCmdScript } from './index';

/**
 * Como rodar um CLI sem shell injetável. No macOS é o próprio binário. No Windows o Node recusa `.cmd` sem shell (EINVAL, desde o
 * CVE-2024-27980) e os CLIs do npm são justamente shims `.cmd`. Duas saídas, nesta ordem:
 *
 *  1. PREFERIDA: o shim do npm só chama `node <pacote>\bin\x.js %*`. Lemos o `.js` do shim e rodamos o `node` (o próprio Electron com
 *     ELECTRON_RUN_AS_NODE) direto nele: nenhum cmd.exe participa, então argumentos com `& | ^ % "` ou quebras de linha não são
 *     interpretados por ninguém. Não depende de o usuário ter o Node instalado.
 *  2. SE o shim não for reconhecido (script `.bat` de outro instalador, formato novo do npm): `cmd.exe /d /s /c "<linha>"` com
 *     cada argumento entre aspas para o CreateProcess e depois escapado com `^` para o cmd.exe (duas vezes, porque o shim reexpande
 *     `%*`), como faz o cross-spawn. Argumentos com CR, LF ou NUL são recusados, pois o cmd.exe os trata como fim do comando.
 */
export type SpawnSpec = {
  command: string;
  args: string[];
  /** Variáveis a somar ao ambiente do filho. */
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
};

export class UnsafeArgumentError extends Error {
  readonly code = 'EINVAL';
  constructor() {
    super('argument with a line break or NUL cannot go through cmd.exe'); // erro interno de programação, não chega à tela
  }
}

/** `"%dp0%\node_modules\@openai\codex\bin\codex.js" %*` → `node_modules\@openai\codex\bin\codex.js` (relativo à pasta do shim). */
export function parseNpmShim(text: string): string | null {
  const m = /"%dp0%[\\/]([^"\r\n]+?\.(?:c|m)?js)"\s+%\*/i.exec(text);
  if (!m || !m[1]) return null;
  const rel = m[1].replace(/^[\\/]+/, '');
  return rel.split(/[\\/]/).includes('..') ? null : rel;
}

const META = /([()\][%!^"`<>&|;, *?])/g;

/** Argumento para o CreateProcess (regras do MSVCRT): aspas e barras invertidas antes de aspas dobram. */
export function quoteForCreateProcess(arg: string): string {
  const out = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${out}"`;
}

/** Escapa para o cmd.exe; `times` = quantas camadas (2 para shim `.cmd`, que reexpande `%*`). */
export function escapeForCmd(arg: string, times = 2): string {
  if (/[\r\n\0]/.test(arg)) throw new UnsafeArgumentError();
  let out = quoteForCreateProcess(arg);
  for (let i = 0; i < times; i++) out = out.replace(META, '^$1');
  return out;
}

export type SpawnDeps = { exists?: (path: string) => boolean; read?: (path: string) => string };

export function resolveSpawn(binary: string, args: string[], env: NodeJS.ProcessEnv = process.env, deps: SpawnDeps = {}): SpawnSpec {
  if (!isCmdScript(binary)) return { command: binary, args, env: {} };
  const exists = deps.exists ?? existsSync;
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf8'));
  try {
    const rel = parseNpmShim(read(binary));
    const script = rel ? win32.join(win32.dirname(binary), rel) : null;
    if (script && exists(script)) {
      return { command: process.execPath, args: [script, ...args], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
    }
  } catch {
    // ilegível: cai no cmd.exe
  }
  // como no cross-spawn: o comando só ganha `^` nos metacaracteres (sem aspas); os argumentos são citados e escapados duas vezes
  const line = [binary.replace(META, '^$1'), ...args.map((a) => escapeForCmd(a, 2))].join(' ');
  return { command: envGet(env, 'ComSpec') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], env: {}, windowsVerbatimArguments: true };
}

/** Opções do `spawn`/`execFile` para um SpawnSpec: soma o env extra e a flag de argumentos literais. */
export function spawnOptions<T extends { env?: NodeJS.ProcessEnv }>(spec: SpawnSpec, options: T): T & { windowsVerbatimArguments?: boolean } {
  const env = { ...(options.env ?? process.env), ...spec.env };
  return { ...options, env, windowsHide: true, ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) };
}
