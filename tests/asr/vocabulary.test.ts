import { expect, test } from 'vitest';
import { WHISPER_VOCAB_CHARS, mergeVocabulary, parseVocabulary, whisperVocabularyPrompt } from '../../src/main/asr/vocabulary';

test('um termo por linha; ignora vazios e repetidos (sem diferenciar maiúsculas) e aceita vírgula', () => {
  expect(parseVocabulary('  Uirapuru Tecnologia \n\nOKR\nokr\nJéssica   Albuquerque, SLA;Ana')).toEqual(['Uirapuru Tecnologia', 'OKR', 'Jéssica Albuquerque', 'SLA', 'Ana']);
  expect(parseVocabulary(undefined)).toEqual([]);
});

test('termos enormes e listas gigantes têm limite', () => {
  expect(parseVocabulary('x'.repeat(500))[0]).toHaveLength(60);
  expect(parseVocabulary(Array.from({ length: 1000 }, (_, i) => `termo${i}`).join('\n'))).toHaveLength(300);
});

test('prompt do whisper: só termos inteiros, dentro do limite (~200 tokens com o contexto), nunca cortado no meio', () => {
  const terms = Array.from({ length: 200 }, (_, i) => `Cliente${i}`);
  const prompt = whisperVocabularyPrompt(terms);
  expect(prompt.length).toBeLessThanOrEqual(WHISPER_VOCAB_CHARS);
  expect(prompt.endsWith('.')).toBe(true);
  const used = prompt.slice(0, -1).split(', ');
  expect(used).toEqual(terms.slice(0, used.length));
  expect(used.length).toBeGreaterThan(10);
  expect(whisperVocabularyPrompt(['Uirapuru Tecnologia', 'OKR'])).toBe('Uirapuru Tecnologia, OKR.');
  expect(whisperVocabularyPrompt([])).toBe('');
  expect(whisperVocabularyPrompt(['x'.repeat(60)], 30)).toBe('');
});

test('mergeVocabulary junta as listas sem repetir, usuário primeiro', () => {
  expect(mergeVocabulary(['Ana', 'OKR'], ['ana', 'Bruno'])).toEqual(['Ana', 'OKR', 'Bruno']);
});
