import { describe, expect, test } from 'vitest';
import { committedPrefix, normalizeWords } from '../../src/main/asr/partials';

describe('committedPrefix', () => {
  test('maior prefixo comum por palavra normalizada', () => {
    expect(committedPrefix(['Olá,', 'mundo!', 'tudo'], ['ola', 'MUNDO', 'bem'])).toEqual([]);
    expect(committedPrefix(['Bom,', 'dia!', 'tudo'], ['bom', 'DIA', 'bem'])).toEqual(['bom', 'dia']);
  });

  test('ignora pontuação, mantém apóstrofo e acentos', () => {
    expect(normalizeWords("Don't, stop... ÁGUA!")).toEqual(["don't", 'stop', 'água']);
    expect(committedPrefix(["don't", 'stop'], ["Don't", 'stop,', 'now'])).toEqual(["don't", 'stop']);
  });

  test('vazio ou sem prefixo comum', () => {
    expect(committedPrefix([], ['a'])).toEqual([]);
    expect(committedPrefix(['a'], ['b'])).toEqual([]);
  });

  test('um parcial que encolhe confirma só o que sobrou em comum', () => {
    expect(committedPrefix(['a', 'b', 'c'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
