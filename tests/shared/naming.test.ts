import { describe, expect, test } from 'vitest';
import { formatClock, meetingFolderName, sanitizeTitle, toLocalIso } from '../../src/shared/naming';

const at = new Date(2026, 9, 8, 14, 30, 5); // local: 8 out 2026 14:30:05

describe('sanitizeTitle', () => {
  test('mantém título comum com acentos', () => {
    expect(sanitizeTitle('Reunião de Planejamento')).toBe('Reunião de Planejamento');
  });
  test('troca separadores de caminho e caracteres proibidos por espaço', () => {
    expect(sanitizeTitle('Q4/Q1: plano "final" <v2>')).toBe('Q4 Q1 plano final v2');
  });
  test('título vazio ou só espaços vira Reunião', () => {
    expect(sanitizeTitle('   ')).toBe('Reunião');
    expect(sanitizeTitle('')).toBe('Reunião');
  });
  test('remove pontos iniciais para não criar pasta oculta', () => {
    expect(sanitizeTitle('...secreto')).toBe('secreto');
  });
  test('remove ponto e espaço no fim (o Windows os descarta do nome da pasta)', () => {
    expect(sanitizeTitle('Reunião final.')).toBe('Reunião final');
    expect(sanitizeTitle('Alinhamento...')).toBe('Alinhamento');
    expect(sanitizeTitle('...')).toBe('Reunião');
    expect(meetingFolderName(at, 'Plano Q4.')).toBe('2026-10-08 1430 - Plano Q4');
  });
  test('corta em 80 caracteres', () => {
    expect(sanitizeTitle('a'.repeat(300))).toHaveLength(80);
  });
  test('preserva emoji', () => {
    expect(sanitizeTitle('Daily 🍚')).toBe('Daily 🍚');
  });
});

describe('meetingFolderName', () => {
  test('formata data e hora locais', () => {
    expect(meetingFolderName(at, 'Daily Squad')).toBe('2026-10-08 1430 - Daily Squad');
  });
  test('aplica sanitizeTitle', () => {
    expect(meetingFolderName(at, 'a/b')).toBe('2026-10-08 1430 - a b');
  });
});

test('formatClock usa HH:MM:SS local', () => {
  expect(formatClock(at)).toBe('14:30:05');
});

test('toLocalIso inclui o offset local', () => {
  expect(toLocalIso(at)).toBe('2026-10-08T14:30:05-03:00');
  expect(new Date(toLocalIso(at)).getTime()).toBe(at.getTime());
});
