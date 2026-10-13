import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { claudeBinary, codexBinary, riceAudioBinary } from '../../src/main/app/paths';
import { buildChildEnv } from '../../src/main/ai/env';
import { riceDataDir, whisperServerBinary } from '../../src/main/asr/config';
import { agySupported, cliDirs, envGet, exeName, findCli, isMac, isWindows, pathKey, remindersSupported, systemCalendarSupported } from '../../src/main/platform';
import { restrictMode } from '../../src/main/platform/fs';
import { tightenTree } from '../../src/main/store/permissions';
import { blockedReason } from '../../src/main/warroom/folder';
import { buildWindowsScript, cmdQuote, detectHarnesses } from '../../src/main/warroom/handoff';
import { openInTerminal, windowsTerminal } from '../../src/main/platform/terminal';
import { watchdogLaunch } from '../../src/main/asr/whisper-server';
import { asPlatform } from '../helpers/platform';

const home = 'C:\\Users\\Ana';
const env = { APPDATA: `${home}\\AppData\\Roaming`, LOCALAPPDATA: `${home}\\AppData\\Local`, Path: 'C:\\Windows;C:\\Tools' };

describe('camada de plataforma', () => {
  test('macOS: isMac, sem .exe, e o Antigravity, o Calendário e os Lembretes existem', () => {
    expect(isMac()).toBe(process.platform === 'darwin');
    expect(exeName('rice-audio')).toBe(process.platform === 'win32' ? 'rice-audio.exe' : 'rice-audio');
  });

  test('Windows simulado: .exe, agy indisponível, Lembretes e agenda do sistema escondidos', async () => {
    await asPlatform('win32', () => {
      expect(isWindows()).toBe(true);
      expect(exeName('rice-audio')).toBe('rice-audio.exe');
      expect(agySupported()).toBe(false);
      expect(remindersSupported()).toBe(false);
      expect(systemCalendarSupported()).toBe(false);
    });
    await asPlatform('darwin', () => {
      expect(agySupported() && remindersSupported() && systemCalendarSupported()).toBe(true);
    });
  });

  test('Windows: a detecção do CLI acha %APPDATA%\\npm\\claude.cmd (e prefere o .exe nativo se existir)', async () => {
    await asPlatform('win32', () => {
      const npm = `${home}\\AppData\\Roaming\\npm\\claude.cmd`;
      expect(findCli('claude', [], { home, env, exists: (p) => p === npm })).toBe(npm);
      const native = `${home}\\.local\\bin\\claude.exe`;
      expect(findCli('claude', [], { home, env, exists: (p) => p === npm || p === native })).toBe(native);
      expect(findCli('claude', [], { home, env, exists: () => false })).toBeNull();
    });
  });

  test('Windows: acha o CLI por qualquer pasta do Path (a chave é "Path", não "PATH")', async () => {
    await asPlatform('win32', () => {
      expect(envGet(env, 'PATH')).toBe('C:\\Windows;C:\\Tools');
      expect(pathKey(env)).toBe('Path');
      expect(findCli('codex', [], { home, env, exists: (p) => p === 'C:\\Tools\\codex.cmd' })).toBe('C:\\Tools\\codex.cmd');
    });
  });

  test('Windows: o PATH do filho estende "Path" sem criar uma segunda chave "PATH"', async () => {
    await asPlatform('win32', () => {
      const child = buildChildEnv({ Path: 'C:\\Windows', OPENAI_API_KEY: 'x' }, {}, 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.cmd');
      expect(Object.keys(child).filter((k) => k.toLowerCase() === 'path')).toEqual(['Path']);
      expect(child.Path).toContain('C:\\Windows');
      expect(child.Path).toContain('C:\\Users\\Ana\\AppData\\Roaming\\npm');
      expect(child.OPENAI_API_KEY).toBeUndefined();
    });
  });

  test('Mac: a ordem das pastas dos CLIs não mudou', async () => {
    await asPlatform('darwin', () => {
      expect(cliDirs({ home: '/Users/a' })).toEqual(['/Users/a/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/Users/a/.npm-global/bin', '/Users/a/.opencode/bin', '/Users/a/.claude/local']);
      expect(findCli('codex', [], { home: '/Users/a', exists: (p) => p === '/usr/local/bin/codex' })).toBe('/usr/local/bin/codex');
      expect(findCli('codex', [], { home: '/Users/a', env: { PATH: '/nao/usado' }, exists: (p) => p === '/nao/usado/codex' })).toBeNull(); // PATH só no Windows
    });
  });

  test('Windows: caminhos dos binários nativos, do whisper-server e dos dados', async () => {
    await asPlatform('win32', () => {
      expect(riceAudioBinary()).toMatch(/rice-audio\.exe$/);
      expect(riceAudioBinary()).toMatch(/native-bin[\\/]win[\\/]|native[\\/]win[\\/]/);
      expect(whisperServerBinary()).toMatch(/resources[\\/]win[\\/]whisper-server\.exe$/);
      expect(riceDataDir()).toMatch(/Rice$/);
      expect(riceDataDir()).not.toContain('Library');
      expect(claudeBinary()).toMatch(/claude/);
      expect(codexBinary()).toMatch(/codex/);
    });
  });

  test('Windows: o vigia do whisper-server é Node (sem /bin/sh); no Mac segue o sh em grupo próprio', async () => {
    const win = await asPlatform('win32', () => watchdogLaunch('C:\\w\\whisper-server.exe', ['-m', 'x']));
    expect(win.command).toBe(process.execPath);
    expect(win.args.slice(2)).toEqual(['C:\\w\\whisper-server.exe', '-m', 'x']);
    expect(win.args[0]).toBe('-e');
    expect(win.detached).toBe(false);
    const mac = await asPlatform('darwin', () => watchdogLaunch('/b/whisper-server', ['-m', 'x']));
    expect(mac).toMatchObject({ command: '/bin/sh', detached: true });
  });

  test.skipIf(process.platform === 'win32')('Windows: 0700/0600 viram no-op (o arquivo fica como estava); no Mac continua apertando', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rice-plat-'));
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x', { mode: 0o644 });
    await asPlatform('win32', async () => {
      await restrictMode(file, 0o600);
      expect(await tightenTree(dir)).toBe(0);
    });
    expect(statSync(file).mode & 0o777).toBe(0o644);
    await asPlatform('darwin', async () => {
      await restrictMode(file, 0o600);
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('Windows: pasta de trabalho do War room', () => {
  const winEnv = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' };
  const blocked = (dir: string) => blockedReason(dir, 'C:\\Users\\Ana', winEnv, true);
  test('bloqueia a pasta pessoal, o que a contém, .ssh, AppData e o sistema (sem diferenciar caixa)', () => {
    for (const d of ['C:\\Users\\Ana', 'C:\\Users', 'C:\\', 'c:\\users\\ana']) expect(blocked(d), d).toBe('warroom.err.folder-broad');
    for (const d of ['C:\\Users\\Ana\\.ssh', 'C:\\Users\\Ana\\.SSH\\keys', 'C:\\Users\\Ana\\AppData', 'C:\\Users\\Ana\\AppData\\Local\\Google', 'C:\\Windows\\System32', 'C:\\Program Files\\App']) expect(blocked(d), d).toBe('warroom.err.folder-secret');
  });
  test('libera projetos normais', () => {
    for (const d of ['C:\\Users\\Ana\\Documents\\proj', 'D:\\code\\rice', 'C:\\Users\\Ana\\Desktop']) expect(blocked(d), d).toBeNull();
  });
  test('Mac: as regras de sempre', () => {
    expect(blockedReason('/Users/a/.ssh', '/Users/a', {}, false)).toBe('warroom.err.folder-secret');
    expect(blockedReason('/Users', '/Users/a', {}, false)).toBe('warroom.err.folder-broad');
    expect(blockedReason('/Users/a/proj', '/Users/a', {}, false)).toBeNull();
  });
});

describe('Windows: "Continuar no terminal"', () => {
  test('detecta os CLIs do Windows e esconde o agy', async () => {
    const exists = (p: string) => ['C:\\Users\\Ana\\.local\\bin\\claude.exe', 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.cmd', 'C:\\Users\\Ana\\.local\\bin\\agy.exe'].includes(p);
    const found = await asPlatform('win32', () => detectHarnesses(exists, 'C:\\Users\\Ana', env));
    expect(found.map((h) => h.id)).toEqual(['claude', 'codex']);
  });
  test('script .cmd: UTF-8, cd /d, aspas em tudo e % dobrado; texto perigoso é recusado', () => {
    const script = buildWindowsScript({ folder: 'D:\\code & co\\50%', bin: 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.cmd', args: ['Leia C:\\x\\prompt.md'] });
    expect(script).toBe('@echo off\r\nchcp 65001 >nul\r\ncd /d "D:\\code & co\\50%%" || exit /b 1\r\ncall "C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.cmd" "Leia C:\\x\\prompt.md"\r\n');
    expect(() => cmdQuote('a"b')).toThrow();
    expect(() => cmdQuote('a\nb')).toThrow();
  });
  test('abre no wt.exe quando existe (aba nova com o script); senão pelo shell (cmd.exe)', async () => {
    const calls: unknown[] = [];
    const openPath = async (p: string) => (calls.push(['open', p]), '');
    await asPlatform('win32', async () => {
      await openInTerminal('C:\\h\\a.cmd', openPath, (c, a) => calls.push(['wt', c, a]), 'C:\\wt.exe');
      await openInTerminal('C:\\h\\b.cmd', openPath, () => {}, null);
    });
    expect(calls).toEqual([['wt', 'C:\\wt.exe', ['new-tab', '--title', 'Rice', 'C:\\h\\a.cmd']], ['open', 'C:\\h\\b.cmd']]);
    expect(windowsTerminal({ LOCALAPPDATA: 'C:\\L' }, (p) => p === 'C:\\L\\Microsoft\\WindowsApps\\wt.exe')).toBe('C:\\L\\Microsoft\\WindowsApps\\wt.exe');
  });
});
