import { t } from '../i18n';
import type { FetchLike } from './google-auth';

export type CalEvent = {
  id: string;
  title: string;
  /** ISO 8601 */
  start: string;
  end: string;
  joinUrl?: string;
  color?: string;
  calendar: string;
  attendees: number;
  /** Nomes dos participantes (displayName, ou o início do e-mail), sem salas/recursos; vão para o vocabulário da reunião. */
  attendeeNames?: string[];
  /** E-mails dos participantes (sem o do próprio usuário nem salas); só o Google informa. */
  attendeeEmails?: string[];
  /** O e-mail do próprio usuário (o participante `self` do Google): dele sai o "domínio da própria empresa" da memória. Não vai para o renderer. */
  selfEmail?: string;
  source: 'google' | 'eventkit';
  /** Dia inteiro: aparece na lista do Início, mas nunca gera aviso nem convite de gravação. */
  allDay?: boolean;
};

export const ALERT_LEAD_MS = 58_000;
export const ALERT_VISIBLE_MS = 4 * 60_000;
export const ALERT_LATE_MS = 4 * 60_000;
const DEDUPE_MS = 2 * 60_000;
const VIDEO_RE = /https:\/\/(?:[\w-]+\.)?(?:zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\/[^\s"'<>)\]]*/i;

type RawEvent = Record<string, any>;
type RawCalendar = { summary?: string; summaryOverride?: string; backgroundColor?: string };

/** Link da videochamada: hangoutLink, entryPoint de vídeo ou URL conhecida em location/description. */
export function extractJoinUrl(ev: RawEvent): string | undefined {
  if (typeof ev.hangoutLink === 'string' && ev.hangoutLink) return ev.hangoutLink;
  const entry = (ev.conferenceData?.entryPoints ?? []).find((e: RawEvent) => e?.entryPointType === 'video' && typeof e.uri === 'string');
  if (entry) return entry.uri;
  for (const text of [ev.location, ev.description]) {
    if (typeof text !== 'string') continue;
    const m = VIDEO_RE.exec(text.replace(/&amp;/g, '&'));
    if (m) return m[0].replace(/[.,;]+$/, '');
  }
  return undefined;
}

/** `2026-10-17` → meia-noite local desse dia (ISO). */
const localMidnight = (date: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : null;
};

/** Evento da API do Google → CalEvent; null para cancelado, recusado ou sem horário (dia inteiro vem com `allDay`). */
export function normalizeEvent(ev: RawEvent, cal: RawCalendar): CalEvent | null {
  if (!ev || ev.status === 'cancelled') return null;
  const allDay = typeof ev.start?.date === 'string' && typeof ev.end?.date === 'string' && !ev.start?.dateTime;
  const start = allDay ? localMidnight(ev.start.date) : ev.start?.dateTime;
  const end = allDay ? localMidnight(ev.end.date) : ev.end?.dateTime;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  const attendees: RawEvent[] = Array.isArray(ev.attendees) ? ev.attendees : [];
  if (attendees.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const joinUrl = extractJoinUrl(ev);
  const emails = attendees.filter((a) => !a.resource && !a.self && typeof a.email === 'string' && a.email).map((a) => String(a.email));
  return {
    id: String(ev.id),
    title: String(ev.summary ?? '').trim() || t('calendar.untitled'),
    start,
    end,
    ...(joinUrl ? { joinUrl } : {}),
    ...(cal.backgroundColor ? { color: cal.backgroundColor } : {}),
    calendar: cal.summaryOverride || cal.summary || '',
    attendees: attendees.filter((a) => !a.resource).length,
    ...(attendeeNamesOf(attendees).length > 0 ? { attendeeNames: attendeeNamesOf(attendees) } : {}),
    ...(emails.length > 0 ? { attendeeEmails: emails } : {}),
    ...(typeof attendees.find((a) => a.self)?.email === 'string' ? { selfEmail: String(attendees.find((a) => a.self)!.email) } : {}),
    source: 'google',
    ...(allDay ? { allDay: true } : {}),
  };
}

/** `jessica.albuquerque@x.com` → `Jessica Albuquerque`; nada útil (ex.: `contato@`) → undefined. */
function nameFromEmail(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter((p) => /^[A-Za-zÀ-ÿ]{2,}$/.test(p));
  if (parts.length < 2) return undefined;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

export function attendeeNamesOf(attendees: RawEvent[]): string[] {
  const names = attendees
    .filter((a) => !a.resource)
    .map((a) => (typeof a.displayName === 'string' && a.displayName.trim() ? a.displayName.trim() : nameFromEmail(a.email)))
    .filter((n): n is string => !!n);
  return [...new Set(names)];
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Une Google + EventKit: mesmo título normalizado e início ±2 min = o mesmo evento; o Google ganha. Ordenado por início. */
export function mergeEvents(google: CalEvent[], eventkit: CalEvent[]): CalEvent[] {
  const extra = eventkit.filter((k) => !google.some((g) => norm(g.title) === norm(k.title) && Math.abs(Date.parse(g.start) - Date.parse(k.start)) <= DEDUPE_MS));
  return [...google, ...extra].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export type AlertPlan = { key: string; event: CalEvent; showAt: number; hideAt: number };

/** Chave de versão do evento: mudar início, fim ou título gera outra chave (reagenda / atualiza o aviso). */
export const alertKey = (e: CalEvent): string => `${e.id}|${e.start}|${e.end}|${e.title}`;

/**
 * Quais avisos agendar agora. Aparece 58 s antes do início (ou já, se passou disso), considera eventos que
 * começaram há até 4 min, fica 4 min visível a partir de quando aparece. `shown` guarda chaves `id|início` já
 * exibidas (dedupe por evento; mudar o horário gera nova chave e reagenda).
 */
export function scheduleFor(events: CalEvent[], now: number, shown: ReadonlySet<string>): AlertPlan[] {
  const plans: AlertPlan[] = [];
  for (const event of events) {
    const start = Date.parse(event.start);
    const end = Date.parse(event.end);
    if (event.allDay || !Number.isFinite(start) || start < now - ALERT_LATE_MS || end <= now) continue; // dia inteiro não gera aviso
    const key = alertKey(event);
    if (shown.has(key)) continue;
    const showAt = Math.max(now, start - ALERT_LEAD_MS);
    plans.push({ key, event, showAt, hideAt: showAt + ALERT_VISIBLE_MS });
  }
  return plans.sort((a, b) => a.showAt - b.showAt);
}

const API = 'https://www.googleapis.com/calendar/v3';

/** Eventos de (agora − 4 min) até +7 dias de todas as agendas selecionadas. Falha de uma agenda não derruba as outras. */
export async function fetchGoogleEvents(token: string, fetch: FetchLike, now: number): Promise<{ events: CalEvent[]; calendars: number }> {
  const headers = { authorization: `Bearer ${token}` };
  const list = await fetch(`${API}/users/me/calendarList?minAccessRole=reader`, { headers });
  if (!list.ok) throw new Error(t('google.err.list', { status: list.status }));
  const calendars: (RawCalendar & { id: string; selected?: boolean })[] = ((await list.json()).items ?? []).filter((c: RawEvent) => c.selected);
  const q = new URLSearchParams({
    timeMin: new Date(now - ALERT_LATE_MS).toISOString(),
    timeMax: new Date(now + 7 * 86_400_000).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const res = await fetch(`${API}/calendars/${encodeURIComponent(cal.id)}/events?${q}`, { headers });
        if (!res.ok) return [];
        return ((await res.json()).items ?? []).map((e: RawEvent) => normalizeEvent(e, cal)).filter((e: CalEvent | null): e is CalEvent => e !== null);
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const events = perCalendar.flat().filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return { events: events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), calendars: calendars.length };
}

/** Evento do rice-detector (EventKit) → CalEvent. Os campos extras só vêm na lista do Início (`list-events`). */
export type EventKitEvent = { id: string; title: string; start: string; end: string; url: string | null; allDay?: boolean; calendar?: string; color?: string; attendees?: number };

export function fromEventKit(ev: EventKitEvent): CalEvent {
  const joinUrl = ev.url && VIDEO_RE.test(ev.url) ? ev.url : extractJoinUrl({ location: ev.url ?? '' });
  return {
    id: ev.id,
    title: ev.title || t('calendar.untitled'),
    start: ev.start,
    end: ev.end,
    ...(joinUrl ? { joinUrl } : {}),
    ...(ev.color ? { color: ev.color } : {}),
    calendar: ev.calendar || t('calendar.macos'),
    attendees: ev.attendees ?? 0,
    source: 'eventkit',
    ...(ev.allDay ? { allDay: true } : {}),
  };
}
