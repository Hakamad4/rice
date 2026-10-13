import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { t, type UiLanguage } from '../i18n';
import { agySupported, findCli, isWindows } from '../platform';
import { restrictMode } from '../platform/fs';
import { MEETING_FILES } from '../store/meeting-files';
import { contextFacts, type Fact, type WarRoomConfig } from './store';

/** "Continuar no meu Claude/Codex…": abre outro harness (CLI do usuário) no Terminal, com um prompt de investigação e a pasta de trabalho. */
export type HarnessId = 'claude' | 'codex' | 'gemini' | 'agy' | 'opencode';
export type Harness = { id: HarnessId; label: string; bin: string };

const LABEL: Record<HarnessId, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', agy: 'Antigravity (agy)', opencode: 'OpenCode' };
const NAME: Record<HarnessId, string> = { claude: 'claude', codex: 'codex', gemini: 'gemini', agy: 'agy', opencode: 'opencode' };

/** Argumentos de cada CLI para abrir a sessão interativa já com o prompt. */
export function harnessArgs(id: HarnessId, prompt: string): string[] {
  if (id === 'gemini' || id === 'agy') return ['-i', prompt]; // agy: -i = prompt inicial em sessão interativa (`agy --help`)
  if (id === 'opencode') return ['--prompt', prompt];
  return [prompt];
}

/** Só os CLIs encontrados neste computador (caminho absoluto existente). */
export function detectHarnesses(exists: (path: string) => boolean = existsSync, home: string = homedir(), env: NodeJS.ProcessEnv = process.env): Harness[] {
  const found: Harness[] = [];
  for (const id of Object.keys(LABEL) as HarnessId[]) {
    if (id === 'agy' && !agySupported()) continue; // o agy só roda no sandbox-exec do macOS
    const bin = findCli(NAME[id], [], { home, exists, env });
    if (bin) found.push({ id, label: LABEL[id], bin });
  }
  return found;
}

/** Aspas simples do shell: `'` vira `'\\''`; nada mais é interpretado (nem `$`, crases, `\\` ou quebras de linha). */
export function shellQuote(text: string): string {
  return "'" + text.split("'").join("'\\''") + "'";
}

/** Texto de terceiros (achados da IA) numa linha só: sem caracteres de controle, espaços colapsados, tamanho limitado. */
export function sanitizeLine(text: string, max = 300): string {
  let clean = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    clean += code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029 ? ' ' : ch;
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Prompt de investigação: só CAMINHOS (a transcrição cresce no arquivo) e os achados (fixados primeiro, depois os recentes), sanitizados. */
export function buildPrompt(input: { dir: string; folder: string; facts: Fact[]; language: UiLanguage }): string {
  const confirmed = contextFacts({ facts: input.facts } as WarRoomConfig, 20);
  const facts = confirmed.length > 0 ? confirmed.map((f) => `- ${sanitizeLine(f.text)} (${sanitizeLine(f.source.ref || f.source.type, 120)})`).join('\n') : t('warroom.handoff.no-facts', undefined, input.language);
  return t('warroom.handoff.prompt', { transcript: join(input.dir, MEETING_FILES.transcript), annotations: join(input.dir, MEETING_FILES.annotations), facts, folder: input.folder }, input.language);
}

export function buildScript(input: { folder: string; bin: string; args: string[] }): string {
  return `#!/bin/bash\ncd ${shellQuote(input.folder)} || exit 1\nexec ${shellQuote(input.bin)} ${input.args.map(shellQuote).join(' ')}\n`;
}

/** Texto do argumento no Windows: o prompt completo fica num arquivo e o CLI é mandado lê-lo (nada de texto de terceiros na linha de comando). */
export function windowsPromptArgs(id: HarnessId, file: string, language: UiLanguage): string[] {
  return harnessArgs(id, t('warroom.handoff.file-prompt', { file }, language));
}

/** Aspas do cmd.exe dentro de um `.cmd`: `%` dobra; as aspas duplas não existem em nomes de arquivo do Windows, e `&|^<>` valem como texto entre aspas. */
export function cmdQuote(text: string): string {
  if (/["\r\n\0]/.test(text)) throw new Error('unsafe batch argument');
  return `"${text.split('%').join('%%')}"`;
}

/** `.cmd` do Windows: UTF-8, entra na pasta (com troca de unidade), roda o CLI. `call` porque o CLI do npm é outro `.cmd`. */
export function buildWindowsScript(input: { folder: string; bin: string; args: string[] }): string {
  const lines = ['@echo off', 'chcp 65001 >nul', `cd /d ${cmdQuote(input.folder)} || exit /b 1`, `call ${cmdQuote(input.bin)} ${input.args.map(cmdQuote).join(' ')}`];
  return lines.join('\r\n') + '\r\n';
}

const DAY_MS = 86_400_000;

/** Grava o prompt completo ao lado do script (Windows) e devolve o caminho. */
export async function writePromptFile(baseDir: string, prompt: string): Promise<string> {
  const folder = join(baseDir, 'handoff');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, `prompt-${randomBytes(6).toString('hex')}.md`);
  await writeFile(path, prompt, { mode: 0o600 });
  return path;
}

/** Grava o `.command` (0700) em `<userData>/handoff/` e apaga os de mais de 1 dia. */
export async function writeHandoffScript(baseDir: string, script: string, now = Date.now(), extension: 'command' | 'cmd' = isWindows() ? 'cmd' : 'command'): Promise<string> {
  const folder = join(baseDir, 'handoff');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await restrictMode(folder, 0o700);
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    const path = join(folder, name);
    if ((await stat(path).catch(() => null))?.mtimeMs !== undefined && now - (await stat(path)).mtimeMs > DAY_MS) await rm(path, { force: true });
  }
  const path = join(folder, `continuar-${randomBytes(6).toString('hex')}.${extension}`);
  await writeFile(path, script, { mode: 0o700 });
  await restrictMode(path, 0o700);
  return path;
}
