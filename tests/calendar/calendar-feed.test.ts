import { expect, test, vi } from 'vitest';
import { CalendarFeed } from '../../src/main/calendar/calendar-feed';

const T0 = Date.parse('2026-10-09T10:00:00Z');
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, summary: `G${i}`, start: { dateTime: new Date(T0 + (i + 1) * 3600_000).toISOString() }, end: { dateTime: new Date(T0 + (i + 1) * 3600_000 + 1800_000).toISOString() } }));
const fetchFake = (n: number) => vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes('calendarList') ? { items: [{ id: 'a', selected: true }] } : { items: items(n) }) }));
const auth = (connected: boolean) => ({ accessToken: async () => 'T', status: async () => ({ connected }) });

test('refresh junta Google + EventKit (Google ganha no duplicado) e emite change', async () => {
  const feed = new CalendarFeed(auth(true), fetchFake(1) as never, () => T0);
  const change = vi.fn();
  feed.on('change', change);
  feed.addEventKit({ id: 'k', title: 'G0', start: new Date(T0 + 3600_000).toISOString(), end: new Date(T0 + 5400_000).toISOString(), calendar: 'mac', attendees: 0, source: 'eventkit' });
  await feed.refresh();
  expect(feed.events().map((e) => e.id)).toEqual(['g0']);
  expect(feed.calendarCount()).toBe(1);
  expect(change).toHaveBeenCalled();
});

test('refresh em andamento que termina depois do disconnect é descartado', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = vi.fn(async (url: string) => {
    if (url.includes('calendarList')) return { ok: true, status: 200, json: async () => ({ items: [{ id: 'a', selected: true }] }) };
    await gate;
    return { ok: true, status: 200, json: async () => ({ items: items(2) }) };
  });
  const feed = new CalendarFeed(auth(true), slow as never, () => T0);
  const change = vi.fn();
  feed.on('change', change);
  const pending = feed.refresh();
  await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(2));
  feed.invalidate(); // disconnect
  release();
  await pending;
  expect(feed.events()).toHaveLength(0);
  expect(feed.calendarCount()).toBe(0);
  expect(change).not.toHaveBeenCalled();
});

test('o refresh mais novo vence o mais antigo', async () => {
  let n = 0;
  const releases: (() => void)[] = [];
  const f = vi.fn(async (url: string) => {
    if (url.includes('calendarList')) return { ok: true, status: 200, json: async () => ({ items: [{ id: 'a', selected: true }] }) };
    const mine = ++n;
    await new Promise<void>((r) => releases.push(r));
    return { ok: true, status: 200, json: async () => ({ items: items(mine === 1 ? 1 : 3) }) };
  });
  const feed = new CalendarFeed(auth(true), f as never, () => T0);
  const first = feed.refresh();
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  const second = feed.refresh();
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  releases[1]!();
  await second;
  releases[0]!();
  await first;
  expect(feed.events()).toHaveLength(3);
});

test('desconectado: sem eventos do Google; erro mantém a lista anterior', async () => {
  const f = fetchFake(2);
  const a = { accessToken: async () => 'T', status: async () => ({ connected: true }) };
  const feed = new CalendarFeed(a, f as never, () => T0);
  await feed.refresh();
  expect(feed.events()).toHaveLength(2);
  a.accessToken = async () => { throw new Error('boom'); };
  await feed.refresh();
  expect(feed.events()).toHaveLength(2);
  expect(feed.lastError).toBe('boom');
  a.status = async () => ({ connected: false });
  await feed.refresh();
  expect(feed.events()).toHaveLength(0);
});

test('setEventKit troca a lista do Calendário do macOS (inclui dia inteiro) e o Google continua ganhando no duplicado', async () => {
  const feed = new CalendarFeed(auth(true), fetchFake(1) as never, () => T0);
  await feed.refresh();
  const change = vi.fn();
  feed.on('change', change);
  const k = (id: string, title: string, start: number, extra: object = {}) => ({ id, title, start: new Date(start).toISOString(), end: new Date(start + 1800_000).toISOString(), calendar: 'mac', attendees: 0, source: 'eventkit' as const, ...extra });
  feed.setEventKit([k('k1', 'G0', T0 + 3600_000), k('k2', 'Treinar', T0 - 3600_000, { allDay: true }), k('k3', 'Outro', T0 + 7200_000)]);
  expect(feed.events().map((e) => e.id)).toEqual(['k2', 'g0', 'k3']); // k1 é o mesmo evento do g0 (título + horário)
  expect(feed.events().find((e) => e.id === 'k2')!.allDay).toBe(true);
  feed.setEventKit([k('k3', 'Outro', T0 + 7200_000)]);
  expect(feed.events().map((e) => e.id)).toEqual(['g0', 'k3']);
  expect(change).toHaveBeenCalledTimes(2);
});
