import { describe, expect, test } from 'vitest';
import { escapeForCmd, parseNpmShim, resolveSpawn, spawnOptions, UnsafeArgumentError } from '../../src/main/platform/spawn';
import { asPlatform } from '../helpers/platform';

/** O shim que o npm gera para `npm i -g @openai/codex` (cmd-shim 6/7). */
const SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;
const CMD = 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.cmd';
const EVIL = ['--model', 'x" & calc.exe & "', '%PATH%', 'a|b>c', '^caret', '!bang!', 'com espaço', 'barra\\'];

describe('spawn seguro de .cmd', () => {
  test('lê o .js do pacote no shim do npm', () => {
    expect(parseNpmShim(SHIM)).toBe('node_modules\\@openai\\codex\\bin\\codex.js');
    expect(parseNpmShim('@echo off\r\necho oi')).toBeNull();
    expect(parseNpmShim('"%dp0%\\..\\..\\evil.js" %*')).toBeNull(); // sem sair da pasta do shim
  });

  test('Mac: o binário sai intacto, sem cmd.exe', async () => {
    const spec = await asPlatform('darwin', () => resolveSpawn('/opt/homebrew/bin/codex', ['exec', 'a & b']));
    expect(spec).toEqual({ command: '/opt/homebrew/bin/codex', args: ['exec', 'a & b'], env: {} });
  });

  test('Windows: .exe roda direto', async () => {
    const spec = await asPlatform('win32', () => resolveSpawn('C:\\Users\\Ana\\.local\\bin\\claude.exe', EVIL));
    expect(spec).toMatchObject({ command: 'C:\\Users\\Ana\\.local\\bin\\claude.exe', args: EVIL });
  });

  test('Windows: .cmd do npm vira "node script.js args" — os argumentos passam crus, sem cmd.exe', async () => {
    const spec = await asPlatform('win32', () => resolveSpawn(CMD, EVIL, {}, { read: () => SHIM, exists: () => true }));
    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual(['C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', ...EVIL]);
    expect(spec.windowsVerbatimArguments).toBeUndefined();
  });

  test('Windows: shim desconhecido cai em cmd.exe /d /s /c com tudo escapado', async () => {
    const spec = await asPlatform('win32', () => resolveSpawn(CMD, EVIL, {}, { read: () => '@echo off\r\nfoo', exists: () => true }));
    expect(spec.command).toBe('cmd.exe');
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(spec.windowsVerbatimArguments).toBe(true);
    const line = spec.args[3]!;
    // nenhum metacaractere do cmd.exe aparece sem o ^ antes (fora o par de aspas externo)
    const inner = line.slice(1, -1);
    expect(inner.replace(/\^./g, '')).not.toMatch(/[&|<>%!()]/);
    expect(inner).toContain('^&');
    expect(line.startsWith('"') && line.endsWith('"')).toBe(true);
  });

  test('Windows: argumento com quebra de linha ou NUL é recusado no fallback', async () => {
    await asPlatform('win32', () => {
      expect(() => escapeForCmd('a\nb')).toThrow(UnsafeArgumentError);
      expect(() => resolveSpawn(CMD, ['a\r\nb'], {}, { read: () => '', exists: () => false })).toThrow(UnsafeArgumentError);
    });
  });

  test('o texto do usuário vai pelo stdin, não pela linha de comando: o argumento nunca é interpretado pelo shim', () => {
    expect(escapeForCmd('simples', 1)).toBe('^"simples^"');
  });

  test('spawnOptions: soma o env do filho e esconde o console', () => {
    const o = spawnOptions({ command: 'x', args: [], env: { ELECTRON_RUN_AS_NODE: '1' }, windowsVerbatimArguments: true }, { env: { A: '1' } });
    expect(o).toMatchObject({ env: { A: '1', ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, windowsVerbatimArguments: true });
  });
});
