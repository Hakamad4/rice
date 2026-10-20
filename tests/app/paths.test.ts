import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { isInsideRoot, nativeBinary, tildify, claudeBinary, codexBinary, opencodeBinary, repoRoot, riceAudioBinary, riceDetectorBinary } from '../../src/main/app/paths';

afterEach(() => {
  delete process.env.RICE_AUDIO_BIN;
  delete process.env.RICE_DETECTOR_BIN;
  delete process.env.RICE_CODEX_BIN;
  delete process.env.RICE_OPENCODE_BIN;
});

test('repoRoot aponta para a raiz com package.json', () => {
  expect(existsSync(join(repoRoot(), 'package.json'))).toBe(true);
  expect(existsSync(join(repoRoot(), 'native', 'rice-audio', 'Package.swift'))).toBe(true);
});

test('binários nativos: o build release no repositório; sem ele, o native-bin do app empacotado (independe do que a máquina compilou)', () => {
  const root = '/repo';
  expect(nativeBinary('rice-audio', () => true, root)).toBe('/repo/native/rice-audio/.build/release/rice-audio');
  expect(nativeBinary('rice-detector', () => true, root)).toBe('/repo/native/rice-detector/.build/release/rice-detector');
  expect(nativeBinary('rice-audio', () => false, root)).toBe('/repo/native-bin/rice-audio');
  expect(nativeBinary('rice-translate', () => true, root)).toBe('/repo/native/translate/.build/release/rice-translate'); // pasta native/translate
  expect(nativeBinary('rice-translate', () => false, root)).toBe('/repo/native-bin/rice-translate');
});

test('variáveis de ambiente sobrescrevem', () => {
  process.env.RICE_AUDIO_BIN = '/x/a';
  process.env.RICE_DETECTOR_BIN = '/x/d';
  expect(riceAudioBinary()).toBe('/x/a');
  expect(riceDetectorBinary()).toBe('/x/d');
});

test('claudeBinary prefere ~/.local/bin/claude quando existe; sem nenhum, "claude" (independe do que a máquina tem instalado)', () => {
  const local = join(homedir(), '.local', 'bin', 'claude');
  expect(claudeBinary((p) => p === local)).toBe(local);
  expect(claudeBinary(() => false)).toBe('claude');
});

test('isInsideRoot aceita a raiz e subpastas', () => {
  expect(isInsideRoot('/a/Rice', '/a/Rice')).toBe(true);
  expect(isInsideRoot('/a/Rice', '/a/Rice/2026/reuniao')).toBe(true);
  expect(isInsideRoot('/a/Rice', '/a/Rice/..notas')).toBe(true);
});

test('isInsideRoot rejeita .., prefixo enganoso e caminhos fora', () => {
  expect(isInsideRoot('/a/Rice', '/a/Rice/../secreto')).toBe(false);
  expect(isInsideRoot('/a/Rice', '/a/Rice2/x')).toBe(false);
  expect(isInsideRoot('/a/Rice', '/etc')).toBe(false);
  expect(isInsideRoot('/a/Rice', '/a')).toBe(false);
});

test.skipIf(process.platform === 'win32')('tildify troca a home por ~ só quando o caminho está dentro dela', () => {
  expect(tildify('/Users/ana/Rice', '/Users/ana')).toBe('~/Rice');
  expect(tildify('/Users/ana', '/Users/ana')).toBe('~');
  expect(tildify('/Users/anabela/Rice', '/Users/ana')).toBe('/Users/anabela/Rice');
  expect(tildify('/Volumes/Disco/Rice', '/Users/ana')).toBe('/Volumes/Disco/Rice');
});

test('RICE_CODEX_BIN troca o codex (instância de teste)', () => {
  process.env.RICE_CODEX_BIN = '/x/codex';
  expect(codexBinary()).toBe('/x/codex');
});

test('RICE_OPENCODE_BIN troca o opencode (instância de teste)', () => {
  process.env.RICE_OPENCODE_BIN = '/x/opencode';
  expect(opencodeBinary()).toBe('/x/opencode');
});

// Windows com espaço e acento no nome do usuário (C:\Users\José da Silva\…): as regras de caminho do Windows rodam também no Mac dos testes
describe('caminhos do Windows com espaço e acento', () => {
  const home = 'C:\\Users\\José da Silva';
  const root = `${home}\\AppData\\Local\\Programs\\Rice\\resources\\app`;

  test('os helpers nativos são achados dentro de uma pasta com espaço e acento (instalado e em desenvolvimento)', () => {
    const packaged = nativeBinary('rice-audio', () => false, root, win32);
    expect(packaged).toBe(`${root}\\native-bin\\win\\rice-audio.exe`);
    const dev = `${home}\\Documentos com espaço\\rice`;
    const built = `${dev}\\native\\win\\build\\Release\\rice-detector.exe`;
    expect(nativeBinary('rice-detector', (p) => p === built, dev, win32)).toBe(built);
  });

  test('tildify mostra ~ para a pasta do usuário, sem se importar com maiúsculas e minúsculas', () => {
    expect(tildify(`${home}\\Rice`, home, win32)).toBe('~\\Rice');
    expect(tildify(`${home}\\Reuniões da Empresa\\2026`, home, win32)).toBe('~\\Reuniões da Empresa\\2026');
    expect(tildify('c:\\users\\josé da silva\\Rice', home, win32)).toBe('~\\Rice');
    expect(tildify(home, home, win32)).toBe('~');
    expect(tildify('C:\\Users\\José da Silva2\\Rice', home, win32)).toBe('C:\\Users\\José da Silva2\\Rice'); // outra pasta com o mesmo começo
    expect(tildify('D:\\Rice', home, win32)).toBe('D:\\Rice');
  });

  test('isInsideRoot: dentro, fora, vizinha com o mesmo prefixo, subir com .. e outra unidade', () => {
    const r = `${home}\\Rice`;
    expect(isInsideRoot(r, `${r}\\2026-10-08 1430 - Planejamento\\notas.md`, win32)).toBe(true);
    expect(isInsideRoot(r, r, win32)).toBe(true);
    expect(isInsideRoot(r, `${home}\\Rice2\\x`, win32)).toBe(false);
    expect(isInsideRoot(r, `${r}\\..\\Outra`, win32)).toBe(false);
    expect(isInsideRoot(r, 'D:\\Rice\\x', win32)).toBe(false);
    expect(isInsideRoot(r, `${r.toUpperCase()}\\Pasta`, win32)).toBe(true); // o Windows ignora maiúsculas
  });
});
