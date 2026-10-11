// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';

const g = globalThis as any;
beforeAll(() => {
  for (const f of ['i18n', 'locales/pt-BR', 'locales/en', 'grouping']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const now = new Date(2026, 9, 9, 15, 0, 0);
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0).toISOString();

it('rotula Hoje, Ontem e datas por extenso', () => {
  const { dayLabel } = g.window.RiceGroup;
  expect(dayLabel(new Date(2026, 9, 9, 8), now)).toBe('Hoje');
  expect(dayLabel(new Date(2026, 9, 8, 23), now)).toBe('Ontem');
  expect(dayLabel(new Date(2026, 9, 5, 10), now)).toBe('5 de outubro');
  expect(dayLabel(new Date(2025, 11, 31, 10), now)).toBe('31 de dezembro de 2025');
});

it('agrupa mantendo a ordem', () => {
  const groups = g.window.RiceGroup.groupByDay(
    [{ startedAt: at(9, 14) }, { startedAt: at(9, 9) }, { startedAt: at(8, 20) }, { startedAt: at(2, 10) }],
    now,
  );
  expect(groups.map((x: any) => [x.label, x.items.length])).toEqual([['Hoje', 2], ['Ontem', 1], ['2 de outubro', 1]]);
});

it('formata duração', () => {
  const { formatDuration } = g.window.RiceGroup;
  expect(formatDuration(at(9, 9), undefined)).toBe('');
  expect(formatDuration('2026-10-09T09:00:00', '2026-10-09T09:45:00')).toBe('45 min');
  expect(formatDuration('2026-10-09T09:00:00', '2026-10-09T10:05:00')).toBe('1 h 05 min');
});

it('duração da reunião soma as sessões; meta antiga usa startedAt/endedAt', () => {
  const { formatMeetingDuration } = g.window.RiceGroup;
  const sessions = [
    { startedAt: '2026-10-09T09:00:00', endedAt: '2026-10-09T09:30:00' },
    { startedAt: '2026-10-09T14:00:00', endedAt: '2026-10-09T14:45:00' },
    { startedAt: '2026-10-09T16:00:00' },
  ];
  expect(formatMeetingDuration({ startedAt: '2026-10-09T09:00:00', sessions })).toBe('1 h 15 min');
  expect(formatMeetingDuration({ startedAt: '2026-10-09T09:00:00', endedAt: '2026-10-09T09:45:00' })).toBe('45 min');
  expect(formatMeetingDuration({ startedAt: '2026-10-09T09:00:00' })).toBe('');
});

it('em inglês: Today/Yesterday, data no locale en-US e durações', () => {
  g.window.RiceI18n.setLanguage('en');
  try {
    const { dayLabel, formatDuration, groupByDay } = g.window.RiceGroup;
    expect(dayLabel(new Date(2026, 9, 9, 8), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 8, 8), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 2, 8), now)).toBe('October 2');
    expect(groupByDay([{ startedAt: at(9, 9) }], now)[0].label).toBe('Today');
    expect(formatDuration('2026-10-09T09:00:00', '2026-10-09T09:00:20')).toBe('under 1 min');
    expect(formatDuration('2026-10-09T09:00:00', '2026-10-09T10:05:00')).toBe('1 h 05 min');
  } finally {
    g.window.RiceI18n.setLanguage('pt-BR');
  }
});
