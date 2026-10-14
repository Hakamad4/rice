import { expect, test, vi } from 'vitest';
import { extractJoinUrl, fromEventKit, fetchGoogleEvents, mergeEvents, normalizeEvent, scheduleFor, type CalEvent } from '../../src/main/calendar/google-events';

const cal = { summary: 'Trabalho', backgroundColor: '#3366cc' };
const ev = (over: Record<string, unknown> = {}) => ({ id: 'e1', summary: 'Daily', start: { dateTime: '2026-10-09T10:00:00-03:00' }, end: { dateTime: '2026-10-09T10:30:00-03:00' }, ...over });
const cev = (id: string, title: string, start: string, source: CalEvent['source'] = 'google'): CalEvent => ({
  id, title, start, end: new Date(Date.parse(start) + 1800_000).toISOString(), calendar: 'x', attendees: 0, source,
});

test('extractJoinUrl: hangoutLink, entryPoint de vídeo, location e description', () => {
  expect(extractJoinUrl({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij');
  expect(extractJoinUrl({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://x.zoom.us/j/1' }] } })).toBe('https://x.zoom.us/j/1');
  expect(extractJoinUrl({ location: 'Sala 3 / https://us02web.zoom.us/j/123?pwd=a.' })).toBe('https://us02web.zoom.us/j/123?pwd=a');
  expect(extractJoinUrl({ description: '<a>Entre: https://teams.microsoft.com/l/meetup-join/abc</a>' })).toBe('https://teams.microsoft.com/l/meetup-join/abc');
  expect(extractJoinUrl({ description: 'veja https://exemplo.com/zoom.us' })).toBeUndefined();
  expect(extractJoinUrl({})).toBeUndefined();
});

test('normalizeEvent: campos, cor da agenda, participantes sem salas', () => {
  const n = normalizeEvent(ev({ hangoutLink: 'https://meet.google.com/a', attendees: [{ self: true, email: 'eu@mim.com', responseStatus: 'accepted' }, { email: 'ana@acme.com' }, { email: 'sala@x.com', resource: true }] }), cal)!;
  expect(n).toEqual({ id: 'e1', title: 'Daily', start: '2026-10-09T10:00:00-03:00', end: '2026-10-09T10:30:00-03:00', joinUrl: 'https://meet.google.com/a', color: '#3366cc', calendar: 'Trabalho', attendees: 2, attendeeEmails: ['ana@acme.com'], selfEmail: 'eu@mim.com', source: 'google' }); // sem o próprio usuário nem a sala
});

test('normalizeEvent ignora cancelado e recusado por mim; dia inteiro vira allDay em meia-noite local', () => {
  expect(normalizeEvent(ev({ status: 'cancelled' }), cal)).toBeNull();
  const allDay = normalizeEvent(ev({ start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }), cal)!;
  expect(allDay.allDay).toBe(true);
  expect(new Date(allDay.start).getTime()).toBe(new Date(2026, 9, 9).getTime());
  expect(new Date(allDay.end).getTime()).toBe(new Date(2026, 9, 10).getTime());
  expect(normalizeEvent(ev({ attendees: [{ self: true, responseStatus: 'declined' }] }), cal)).toBeNull();
  expect(normalizeEvent(ev({ attendees: [{ responseStatus: 'declined' }] }), cal)).not.toBeNull(); // outra pessoa recusou
  expect(normalizeEvent(ev({ summary: '  ' }), cal)!.title).toBe('(sem título)');
});

test('mergeEvents: dedupe por título normalizado + início ±2 min, Google ganha, ordena', () => {
  const g = [cev('g1', 'Reunião Semanal', '2026-10-09T10:00:00Z')];
  const k = [
    cev('k1', 'reuniao   semanal', '2026-10-09T10:01:30Z', 'eventkit'), // duplicado
    cev('k2', 'Reunião Semanal', '2026-10-09T10:05:00Z', 'eventkit'), // início fora de ±2 min
    cev('k3', 'Outra', '2026-10-09T09:00:00Z', 'eventkit'),
  ];
  expect(mergeEvents(g, k).map((e) => e.id)).toEqual(['k3', 'g1', 'k2']);
});

const T0 = Date.parse('2026-10-09T10:00:00Z');
test('scheduleFor: 58 s antes, 4 min visível, ignora passado distante e já exibidos', () => {
  const events = [
    cev('futuro', 'A', new Date(T0 + 10 * 60_000).toISOString()),
    cev('proximo', 'B', new Date(T0 + 30_000).toISOString()),
    cev('comecou', 'C', new Date(T0 - 3 * 60_000).toISOString()),
    cev('velho', 'D', new Date(T0 - 5 * 60_000).toISOString()),
  ];
  const plans = scheduleFor(events, T0, new Set());
  expect(plans.map((p) => p.event.id)).toEqual(['proximo', 'comecou', 'futuro']);
  const byId = Object.fromEntries(plans.map((p) => [p.event.id, p]));
  expect(byId.futuro!.showAt).toBe(T0 + 10 * 60_000 - 58_000);
  expect(byId.futuro!.hideAt - byId.futuro!.showAt).toBe(4 * 60_000);
  expect(byId.proximo!.showAt).toBe(T0); // já passou dos 58 s: aparece já
  expect(byId.comecou!.showAt).toBe(T0);
  expect(scheduleFor(events, T0, new Set([byId.futuro!.key])).map((p) => p.event.id)).not.toContain('futuro');
});

test('scheduleFor: horário alterado gera nova chave (reagenda); evento já terminado é ignorado', () => {
  const a = cev('x', 'A', new Date(T0 + 600_000).toISOString());
  const shown = new Set([scheduleFor([a], T0, new Set())[0]!.key]);
  expect(scheduleFor([a], T0, shown)).toHaveLength(0);
  const moved = { ...a, start: new Date(T0 + 900_000).toISOString(), end: new Date(T0 + 1_200_000).toISOString() };
  expect(scheduleFor([moved], T0, shown)).toHaveLength(1);
  const over = { ...a, start: new Date(T0 - 60_000).toISOString(), end: new Date(T0 - 1000).toISOString() };
  expect(scheduleFor([over], T0, new Set())).toHaveLength(0);
});

test('fetchGoogleEvents: só agendas selecionadas, janela -4min..+7d, tolera falha de uma agenda', async () => {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes('calendarList')) return { ok: true, status: 200, json: async () => ({ items: [{ id: 'a', summary: 'A', selected: true, backgroundColor: '#111' }, { id: 'b', selected: false }, { id: 'c', selected: true }] }) };
    if (url.includes('/calendars/c/')) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ items: [ev()] }) };
  });
  const r = await fetchGoogleEvents('TOK', fetch as never, T0);
  expect(r.events.map((e) => e.id)).toEqual(['e1']);
  expect(r.calendars).toBe(2);
  expect(calls.some((u) => u.includes('/calendars/b/'))).toBe(false);
  const u = new URL(calls.find((c) => c.includes('/calendars/a/'))!);
  expect(u.searchParams.get('singleEvents')).toBe('true');
  expect(u.searchParams.get('orderBy')).toBe('startTime');
  expect(u.searchParams.get('timeMin')).toBe(new Date(T0 - 240_000).toISOString());
  expect(u.searchParams.get('timeMax')).toBe(new Date(T0 + 7 * 86_400_000).toISOString());
  expect((fetch.mock.calls[0] as any)[1].headers.authorization).toBe('Bearer TOK');
});

test('nomes dos participantes: displayName, ou o início do e-mail; sem salas, sem endereços genéricos, sem repetir', () => {
  const n = normalizeEvent(ev({ attendees: [
    { email: 'jessica.albuquerque@x.com', displayName: 'Jéssica Albuquerque' },
    { email: 'carlos_silva@x.com' },
    { email: 'contato@x.com' },
    { email: 'sala@x.com', resource: true, displayName: 'Sala 3' },
    { email: 'j2@x.com', displayName: 'Jéssica Albuquerque' },
  ] }), cal)!;
  expect(n.attendeeNames).toEqual(['Jéssica Albuquerque', 'Carlos Silva']);
  expect(normalizeEvent(ev({}), cal)!.attendeeNames).toBeUndefined();
});

test('dia inteiro aparece nos eventos mas NÃO gera aviso (scheduleFor ignora)', () => {
  const day = { ...cev('dia', 'Feriado', new Date(T0 - 60_000).toISOString()), allDay: true, end: new Date(T0 + 86_400_000).toISOString() };
  const meeting = cev('reuniao', 'Daily', new Date(T0 + 30_000).toISOString());
  expect(scheduleFor([day, meeting], T0, new Set()).map((p) => p.event.id)).toEqual(['reuniao']);
});

test('fromEventKit leva dia inteiro, calendário, cor e participantes da lista do Início', () => {
  const e = fromEventKit({ id: 'k', title: 'Ler livro', start: '2026-10-17T03:00:00Z', end: '2026-10-18T03:00:00Z', url: null, allDay: true, calendar: 'Pessoal', color: '#33AA66', attendees: 0 });
  expect(e).toMatchObject({ allDay: true, calendar: 'Pessoal', color: '#33AA66', attendees: 0, source: 'eventkit' });
  expect(fromEventKit({ id: 'j', title: 'x', start: 'a', end: 'b', url: null }).allDay).toBeUndefined();
});
