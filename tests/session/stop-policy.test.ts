import { expect, test } from 'vitest';
import { decideMeetingEnd } from '../../src/main/session/stop-policy';

const now = new Date(2026, 9, 8, 15, 0, 0);
const base = { recordedMs: 30 * 60_000, othersSpoke: true, calendarEnd: null, now, otherCallActive: false };

test('gravação curta (< 3 min) ou sem fala dos outros: ignora o sinal de fim', () => {
  expect(decideMeetingEnd({ ...base, recordedMs: 2 * 60_000 })).toBe('ignore');
  expect(decideMeetingEnd({ ...base, othersSpoke: false })).toBe('ignore');
});

test('outra chamada continua ativa: ignora', () => {
  expect(decideMeetingEnd({ ...base, otherCallActive: true })).toBe('ignore');
});

test('perto do fim do evento da agenda (±5 min): pergunta e, sem resposta, para', () => {
  expect(decideMeetingEnd({ ...base, calendarEnd: new Date(2026, 9, 8, 15, 4, 0) })).toBe('ask-then-stop');
  expect(decideMeetingEnd({ ...base, calendarEnd: new Date(2026, 9, 8, 14, 56, 0) })).toBe('ask-then-stop');
});

test('longe do fim do evento, ou sem evento: só pergunta, nunca para sozinho', () => {
  expect(decideMeetingEnd({ ...base, calendarEnd: new Date(2026, 9, 8, 16, 0, 0) })).toBe('ask');
  expect(decideMeetingEnd(base)).toBe('ask');
});
