import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
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
