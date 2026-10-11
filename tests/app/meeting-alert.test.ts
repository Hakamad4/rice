import { expect, test, vi } from 'vitest';
import { alertPosition, AlertScheduler, isHttpsUrl } from '../../src/main/app/meeting-alert';
import type { CalEvent } from '../../src/main/calendar/google-events';

const T0 = Date.parse('2026-10-09T10:00:00Z');
const ev = (id: string, startOffsetMs: number, title = id): CalEvent => ({
  id, title, start: new Date(T0 + startOffsetMs).toISOString(), end: new Date(T0 + startOffsetMs + 1800_000).toISOString(), calendar: 'c', attendees: 0, source: 'google',
});

function harness(recording = false) {
  let now = T0;
  const timers: { at: number; fn: () => void; id: number; cleared: boolean }[] = [];
  const closed: string[] = [];
  const shown: string[] = [];
  const s = {
    recording,
    deps: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => { const t = { at: now + ms, fn, id: timers.length, cleared: false }; timers.push(t); return t; },
      clearTimer: (h: any) => { h.cleared = true; },
      isRecording: () => s.recording,
      show: vi.fn((plan) => { shown.push(plan.event.id); return { close: () => closed.push(plan.event.id) }; }),
    },
  };
  const sched = new AlertScheduler(s.deps);
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.cleared && x.at <= now).sort((a, b) => a.at - b.at)) { t.cleared = true; t.fn(); }
  };
  return { sched, s, shown, closed, advance };
}

test('aparece 58 s antes e fecha sozinho após 4 min', () => {
  const h = harness();
  h.sched.update([ev('a', 120_000)]);
  expect(h.shown).toEqual([]);
  h.advance(120_000 - 58_000 - 1);
  expect(h.shown).toEqual([]);
  h.advance(1);
  expect(h.shown).toEqual(['a']);
  h.advance(4 * 60_000 - 1);
  expect(h.closed).toEqual([]);
  h.advance(1);
  expect(h.closed).toEqual(['a']);
});

test('dedupe: update repetido não reabre o aviso; evento que já começou há <4 min avisa na hora', () => {
  const h = harness();
  h.sched.update([ev('a', -60_000)]);
  h.sched.update([ev('a', -60_000)]);
  expect(h.shown).toEqual(['a']);
  h.sched.dismiss(`${ev('a', -60_000).id}|${ev('a', -60_000).start}`);
  h.sched.update([ev('a', -60_000)]);
  expect(h.shown).toEqual(['a']); // fechado pelo usuário: não volta
});

test('não mostra se já está gravando (e não aparece depois)', () => {
  const h = harness(true);
  h.sched.update([ev('a', 10_000)]);
  expect(h.shown).toEqual([]);
  h.s.recording = false;
  h.sched.update([ev('a', 10_000)]);
  expect(h.shown).toEqual([]);
});

test('reagenda quando o horário muda e cancela quando o evento é apagado', () => {
  const h = harness();
  h.sched.update([ev('a', 600_000), ev('b', 600_000)]);
  h.sched.update([ev('a', 900_000)]); // a movido, b apagado
  h.advance(600_000 - 58_000);
  expect(h.shown).toEqual([]); // nada no horário antigo
  h.advance(300_000);
  expect(h.shown).toEqual(['a']);
});

test('aviso já na tela fecha se o evento é apagado ou movido', () => {
  const h = harness();
  h.sched.update([ev('a', 30_000)]);
  expect(h.shown).toEqual(['a']);
  h.sched.update([]);
  expect(h.closed).toEqual(['a']);
});

test('mudar só o fim ou o título atualiza o aviso aberto e o pendente', () => {
  const h = harness();
  h.sched.update([ev('a', 30_000), ev('b', 600_000)]);
  expect(h.shown).toEqual(['a']);
  const longer = (e: CalEvent) => ({ ...e, end: new Date(Date.parse(e.end) + 900_000).toISOString() });
  h.sched.update([longer(ev('a', 30_000)), longer(ev('b', 600_000))]);
  expect(h.closed).toEqual(['a']); // aviso antigo fechado
  expect(h.shown).toEqual(['a', 'a']); // reaberto com o horário novo
  expect(h.s.deps.show.mock.calls[1]![0].event.end).toBe(longer(ev('a', 30_000)).end);
  h.advance(600_000 - 58_000);
  expect(h.shown).toEqual(['a', 'a', 'b']);
  expect(h.s.deps.show.mock.calls[2]![0].event.end).toBe(longer(ev('b', 600_000)).end); // plano pendente usa o dado novo
});

test('mudar só o título também reabre o aviso com o nome novo', () => {
  const h = harness();
  h.sched.update([ev('a', 30_000, 'Velho')]);
  h.sched.update([ev('a', 30_000, 'Novo')]);
  expect(h.closed).toEqual(['a']);
  expect(h.s.deps.show.mock.calls[1]![0].event.title).toBe('Novo');
});

test('alertPosition: x = área.x + largura − 408, empilha a partir do topo', () => {
  const area = { x: 100, y: 25, width: 1440, height: 800 };
  expect(alertPosition(area, 0)).toEqual({ x: 100 + 1440 - 408, y: 25 + 8 });
  expect(alertPosition(area, 2).y).toBe(25 + 8 + 2 * (96 + 8));
});

test('isHttpsUrl só aceita https', () => {
  expect(isHttpsUrl('https://meet.google.com/x')).toBe(true);
  for (const bad of ['http://x.com', 'file:///etc/passwd', 'javascript:alert(1)', 'zoommtg://x', 'não é url', undefined, 5]) expect(isHttpsUrl(bad)).toBe(false);
});
