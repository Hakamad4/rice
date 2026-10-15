/**
 * Parser de agenda ICS (RFC 5545) para "Assinar por link": eventos únicos e recorrentes (RRULE com EXDATE/RDATE e exceções por RECURRENCE-ID),
 * fuso TZID (nomes IANA, nomes do Windows/Outlook e o deslocamento do VTIMEZONE como último recurso), dia inteiro e cancelados.
 * Próprio e sem dependências: o Node já traz os dados de fuso (Intl), e o formato que importa é um subconjunto pequeno. Nada aqui usa rede.
 */
import { t } from '../i18n';
import { extractJoinUrl, type CalEvent } from './google-events';

// ───────────────────────── 1. linhas e propriedades ─────────────────────────

type Prop = { name: string; params: Record<string, string>; value: string };
type Component = { type: string; props: Prop[]; children: Component[] };

/** Desdobra as linhas (continuação começa com espaço ou tab) e separa em linhas lógicas. */
export function unfold(text: string): string[] {
  return text.replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter((l) => l.length > 0);
}

/** `NOME;P1=v;P2="a;b":valor` → propriedade. Aspas nos parâmetros protegem `;` `:` e `,`. */
export function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  let colon = -1;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = '';
  quoted = false;
  for (const c of head) {
    if (c === '"') quoted = !quoted;
    if (c === ';' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0]!.toUpperCase(), params, value };
}

export const unescapeText = (v: string): string => v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

function parseComponents(lines: string[]): Component[] {
  const root: Component = { type: 'ROOT', props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    const top = stack[stack.length - 1]!;
    if (p.name === 'BEGIN') {
      const c: Component = { type: p.value.toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1 && top.type === p.value.toUpperCase()) stack.pop();
    } else top.props.push(p);
  }
  return root.children;
}

// ───────────────────────── 2. datas e fusos ─────────────────────────

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };
type Dt = { wall: Wall; dateOnly: boolean; utc: boolean; tzid?: string };

export function parseDt(value: string, params: Record<string, string>): Dt | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(v);
  if (!m) return null;
  const dateOnly = m[4] === undefined || params.VALUE === 'DATE';
  return {
    wall: { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: dateOnly ? 0 : +(m[4] ?? 0), mi: dateOnly ? 0 : +(m[5] ?? 0), s: dateOnly ? 0 : +(m[6] ?? 0) },
    dateOnly,
    utc: !dateOnly && m[7] !== undefined,
    ...(params.TZID ? { tzid: params.TZID } : {}),
  };
}

/** Nomes de fuso do Windows (o Outlook/Microsoft 365 publica assim) → IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  'dateline standard time': 'Etc/GMT+12', 'hawaiian standard time': 'Pacific/Honolulu', 'alaskan standard time': 'America/Anchorage', 'pacific standard time': 'America/Los_Angeles',
  'pacific standard time (mexico)': 'America/Tijuana', 'us mountain standard time': 'America/Phoenix', 'mountain standard time': 'America/Denver', 'central standard time': 'America/Chicago',
  'canada central standard time': 'America/Regina', 'central america standard time': 'America/Guatemala', 'central standard time (mexico)': 'America/Mexico_City', 'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indiana/Indianapolis', 'sa pacific standard time': 'America/Bogota', 'venezuela standard time': 'America/Caracas', 'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns', 'pacific sa standard time': 'America/Santiago', 'sa western standard time': 'America/La_Paz', 'central brazilian standard time': 'America/Cuiaba',
  'e. south america standard time': 'America/Sao_Paulo', 'argentina standard time': 'America/Argentina/Buenos_Aires', 'sa eastern standard time': 'America/Cayenne', 'bahia standard time': 'America/Bahia',
  'montevideo standard time': 'America/Montevideo', 'paraguay standard time': 'America/Asuncion', 'greenland standard time': 'America/Godthab', 'azores standard time': 'Atlantic/Azores',
  'utc': 'UTC', 'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik', 'w. europe standard time': 'Europe/Berlin', 'central europe standard time': 'Europe/Budapest',
  'romance standard time': 'Europe/Paris', 'central european standard time': 'Europe/Warsaw', 'w. central africa standard time': 'Africa/Lagos', 'gtb standard time': 'Europe/Bucharest',
  'e. europe standard time': 'Europe/Chisinau', 'fle standard time': 'Europe/Kiev', 'egypt standard time': 'Africa/Cairo', 'south africa standard time': 'Africa/Johannesburg',
  'israel standard time': 'Asia/Jerusalem', 'turkey standard time': 'Europe/Istanbul', 'russian standard time': 'Europe/Moscow', 'arab standard time': 'Asia/Riyadh', 'arabian standard time': 'Asia/Dubai',
  'e. africa standard time': 'Africa/Nairobi', 'iran standard time': 'Asia/Tehran', 'pakistan standard time': 'Asia/Karachi', 'india standard time': 'Asia/Kolkata', 'sri lanka standard time': 'Asia/Colombo',
  'bangladesh standard time': 'Asia/Dhaka', 'se asia standard time': 'Asia/Bangkok', 'china standard time': 'Asia/Shanghai', 'singapore standard time': 'Asia/Singapore', 'taipei standard time': 'Asia/Taipei',
  'w. australia standard time': 'Australia/Perth', 'tokyo standard time': 'Asia/Tokyo', 'korea standard time': 'Asia/Seoul', 'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin', 'e. australia standard time': 'Australia/Brisbane', 'aus eastern standard time': 'Australia/Sydney', 'west pacific standard time': 'Pacific/Port_Moresby',
  'tasmania standard time': 'Australia/Hobart', 'new zealand standard time': 'Pacific/Auckland', 'fiji standard time': 'Pacific/Fiji',
};

const zoneCache = new Map<string, Intl.DateTimeFormat | null>();
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (zoneCache.has(zone)) return zoneCache.get(zone)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch {
    f = null;
  }
  zoneCache.set(zone, f);
  return f;
}

/** O nome de fuso do ICS → um fuso IANA que o Intl conhece, ou null. */
export function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const raw = tzid.trim().replace(/^"|"$/g, '');
  if (formatterFor(raw)) return raw;
  const win = WINDOWS_ZONES[raw.toLowerCase()];
  if (win && formatterFor(win)) return win;
  const parts = raw.split('/').filter(Boolean); // "/mozilla.org/20050126_1/America/New_York": tenta os fins do caminho (Area/Cidade, Area/Regiao/Cidade)
  for (let i = 0; i < parts.length - 1; i++) {
    const tail = parts.slice(i).join('/');
    if (formatterFor(tail)) return tail;
  }
  return null;
}

/** Deslocamento (ms) do fuso num instante UTC. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const f = formatterFor(zone)!;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Hora de parede num fuso → instante UTC (resolve a hora que não existe ou se repete na troca de horário de verão). */
export function wallToUtc(w: Wall, zone: string): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  const off1 = zoneOffsetMs(zone, guess);
  const t1 = guess - off1;
  const off2 = zoneOffsetMs(zone, t1);
  return off2 === off1 ? t1 : guess - off2;
}

type Ctx = { localZone: string; defaultZone: string | null; vtz: Map<string, number> };

/** Instante de uma data do ICS: UTC, com TZID, ou flutuante (fuso padrão do calendário ou o do computador). */
function instantOf(dt: Dt, ctx: Ctx): number {
  if (dt.utc) return Date.UTC(dt.wall.y, dt.wall.m - 1, dt.wall.d, dt.wall.h, dt.wall.mi, dt.wall.s);
  const zone = resolveZone(dt.tzid);
  if (zone) return wallToUtc(dt.wall, zone);
  if (dt.tzid && ctx.vtz.has(dt.tzid)) return Date.UTC(dt.wall.y, dt.wall.m - 1, dt.wall.d, dt.wall.h, dt.wall.mi, dt.wall.s) - ctx.vtz.get(dt.tzid)!; // só o deslocamento do VTIMEZONE
  return wallToUtc(dt.wall, ctx.defaultZone ?? ctx.localZone);
}

/** O fuso em que a recorrência anda (para manter a hora local ao cruzar o horário de verão). */
function zoneOfRule(dt: Dt, ctx: Ctx): string {
  if (dt.utc) return 'UTC';
  return resolveZone(dt.tzid) ?? (dt.tzid ? 'UTC' : ctx.defaultZone ?? ctx.localZone);
}

// ───────────────────────── 3. RRULE ─────────────────────────

type Rule = { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'; interval: number; count?: number; until?: Dt; byDay: Array<{ n: number; day: number }>; byMonthDay: number[]; byMonth: number[]; bySetPos: number[]; wkst: number };

const DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ as Rule['freq'] | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null; // HOURLY e menores não existem em reuniões
  const nums = (v?: string) => (v ? v.split(',').map(Number).filter((n) => Number.isFinite(n)) : []);
  const byDay = (kv.BYDAY ? kv.BYDAY.split(',') : []).flatMap((d) => {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d.trim());
    return m ? [{ n: m[1] ? Number(m[1]) : 0, day: DAYS[m[2]!.toUpperCase()]! }] : [];
  });
  const until = kv.UNTIL ? parseDt(kv.UNTIL, {}) : null;
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    ...(kv.COUNT && Number(kv.COUNT) > 0 ? { count: Number(kv.COUNT) } : {}),
    ...(until ? { until } : {}),
    byDay,
    byMonthDay: nums(kv.BYMONTHDAY),
    byMonth: nums(kv.BYMONTH),
    bySetPos: nums(kv.BYSETPOS),
    wkst: DAYS[(kv.WKST ?? 'MO').toUpperCase()] ?? 1,
  };
}

const DAY_MS = 86_400_000;
const dayIndex = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
const fromIndex = (i: number) => {
  const dt = new Date(i * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};
const weekdayOf = (i: number) => (((i + 4) % 7) + 7) % 7; // 1970-01-01 foi quinta
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Dias (índices) de um mês que casam com BYDAY (com ou sem ordinal) e/ou BYMONTHDAY. */
function monthDays(y: number, m: number, rule: Rule, startDay: number): number[] {
  const last = daysInMonth(y, m);
  const out = new Set<number>();
  if (rule.byDay.length > 0) {
    for (const { n, day } of rule.byDay) {
      const all: number[] = [];
      for (let d = 1; d <= last; d++) if (weekdayOf(dayIndex(y, m, d)) === day) all.push(d);
      if (n === 0) all.forEach((d) => out.add(d));
      else {
        const pick = n > 0 ? all[n - 1] : all[all.length + n];
        if (pick) out.add(pick);
      }
    }
    if (rule.byMonthDay.length > 0) {
      const wanted = new Set(rule.byMonthDay.map((d) => (d < 0 ? last + 1 + d : d)));
      for (const d of [...out]) if (!wanted.has(d)) out.delete(d);
    }
  } else if (rule.byMonthDay.length > 0) {
    for (const d of rule.byMonthDay) {
      const day = d < 0 ? last + 1 + d : d;
      if (day >= 1 && day <= last) out.add(day);
    }
  } else if (startDay <= last) out.add(startDay);
  let days = [...out].sort((a, b) => a - b);
  if (rule.bySetPos.length > 0) days = rule.bySetPos.flatMap((p) => (p > 0 ? days[p - 1] : days[days.length + p]) ?? []).sort((a, b) => a - b);
  return days.map((d) => dayIndex(y, m, d));
}

/** Gera as datas (índices de dia) da regra, em ordem, a partir de DTSTART. `visit` devolve false para parar. */
function* ruleDays(startIdx: number, rule: Rule): Generator<number> {
  const start = fromIndex(startIdx);
  const monthOk = (i: number) => rule.byMonth.length === 0 || rule.byMonth.includes(fromIndex(i).m);
  if (rule.freq === 'DAILY') {
    for (let k = 0; k < 400_000; k++) {
      const i = startIdx + k * rule.interval;
      const dt = fromIndex(i);
      if (rule.byDay.length > 0 && !rule.byDay.some((b) => b.day === weekdayOf(i))) continue;
      if (rule.byMonthDay.length > 0 && !rule.byMonthDay.some((d) => (d < 0 ? daysInMonth(dt.y, dt.m) + 1 + d : d) === dt.d)) continue;
      if (!monthOk(i)) continue;
      yield i;
    }
    return;
  }
  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length > 0 ? [...new Set(rule.byDay.map((b) => b.day))] : [weekdayOf(startIdx)];
    const weekStart = startIdx - ((weekdayOf(startIdx) - rule.wkst + 7) % 7);
    for (let k = 0; k < 100_000; k++) {
      const base = weekStart + k * 7 * rule.interval;
      const inWeek = days.map((wd) => base + ((wd - rule.wkst + 7) % 7)).sort((a, b) => a - b);
      for (const i of inWeek) if (i >= startIdx && monthOk(i)) yield i;
    }
    return;
  }
  if (rule.freq === 'MONTHLY') {
    for (let k = 0; k < 20_000; k++) {
      const total = start.y * 12 + (start.m - 1) + k * rule.interval;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (rule.byMonth.length > 0 && !rule.byMonth.includes(m)) continue;
      for (const i of monthDays(y, m, rule, start.d)) if (i >= startIdx) yield i;
    }
    return;
  }
  // YEARLY
  const months = rule.byMonth.length > 0 ? [...rule.byMonth].sort((a, b) => a - b) : [start.m];
  for (let k = 0; k < 5_000; k++) {
    const y = start.y + k * rule.interval;
    for (const m of months) for (const i of monthDays(y, m, rule, start.d)) if (i >= startIdx) yield i;
  }
}

// ───────────────────────── 4. eventos ─────────────────────────

export type IcsParsed = { name: string | null; ctx: Ctx; vevents: Component[] };

const first = (c: Component, name: string): Prop | undefined => c.props.find((p) => p.name === name);
const all = (c: Component, name: string): Prop[] => c.props.filter((p) => p.name === name);

/** "PT1H30M", "P1D", "-PT15M" → ms. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 3600 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

export function parseIcs(text: string, localZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): IcsParsed {
  const comps = parseComponents(unfold(text));
  const cal = comps.find((c) => c.type === 'VCALENDAR') ?? { type: 'VCALENDAR', props: [], children: comps };
  const vtz = new Map<string, number>();
  for (const tz of cal.children.filter((c) => c.type === 'VTIMEZONE')) {
    const id = first(tz, 'TZID')?.value;
    const obs = tz.children.find((c) => c.type === 'STANDARD') ?? tz.children[0];
    const to = obs && first(obs, 'TZOFFSETTO')?.value;
    const m = to && /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(to);
    if (id && m) vtz.set(id, (m[1] === '-' ? -1 : 1) * (+m[2]! * 3600 + +m[3]! * 60 + +(m[4] ?? 0)) * 1000);
  }
  const wrTz = resolveZone(first(cal, 'X-WR-TIMEZONE')?.value);
  return {
    name: unescapeText(first(cal, 'X-WR-CALNAME')?.value ?? '') || null,
    ctx: { localZone, defaultZone: wrTz, vtz },
    vevents: cal.children.filter((c) => c.type === 'VEVENT'),
  };
}

/** Janela em que se expandem as recorrências e se listam os eventos. */
export type IcsWindow = { from: number; to: number };
export const MAX_EVENTS = 4000;

type Instance = { start: number; end: number; allDay: boolean; comp: Component };

function eventDates(c: Component, ctx: Ctx): { dt: Dt; start: number; duration: number; allDay: boolean } | null {
  const s = first(c, 'DTSTART');
  const dt = s && parseDt(s.value, s.params);
  if (!s || !dt) return null;
  const start = dt.dateOnly ? wallToUtc(dt.wall, ctx.localZone) : instantOf(dt, ctx);
  let duration: number | null = null;
  const e = first(c, 'DTEND');
  const edt = e && parseDt(e.value, e.params);
  if (e && edt) duration = (edt.dateOnly ? wallToUtc(edt.wall, ctx.localZone) : instantOf(edt, ctx)) - start;
  else if (first(c, 'DURATION')) duration = parseDuration(first(c, 'DURATION')!.value);
  if (duration === null || duration < 0) duration = dt.dateOnly ? DAY_MS : 0; // sem fim: dia inteiro dura 1 dia; os demais são pontuais
  return { dt, start, duration, allDay: dt.dateOnly };
}

/** Todas as instâncias do VEVENT mestre dentro da janela (ou só a própria, se não repete). */
function instancesOf(master: Component, ctx: Ctx, win: IcsWindow): Instance[] {
  const base = eventDates(master, ctx);
  if (!base) return [];
  const out: Instance[] = [];
  const push = (start: number) => {
    const end = start + base.duration;
    if (end > win.from && start < win.to) out.push({ start, end: Math.max(end, start), allDay: base.allDay, comp: master });
  };
  const ruleProp = first(master, 'RRULE');
  const rule = ruleProp ? parseRule(ruleProp.value) : null;
  const rdates = all(master, 'RDATE').flatMap((p) => p.value.split(',').map((v) => parseDt(v.split('/')[0]!, p.params)).filter((d): d is Dt => d !== null));
  if (!rule) {
    push(base.start);
    for (const r of rdates) push(r.dateOnly ? wallToUtc(r.wall, ctx.localZone) : instantOf(r, ctx));
  } else {
    const zone = base.allDay ? ctx.localZone : zoneOfRule(base.dt, ctx);
    const startIdx = dayIndex(base.dt.wall.y, base.dt.wall.m, base.dt.wall.d);
    const untilMs = rule.until ? (rule.until.dateOnly ? wallToUtc({ ...rule.until.wall, h: 23, mi: 59, s: 59 }, zone) : instantOf(rule.until, ctx)) : Infinity;
    let n = 0;
    let produced = false;
    for (const idx of ruleDays(startIdx, rule)) {
      const { y, m, d } = fromIndex(idx);
      const start = wallToUtc({ y, m, d, h: base.dt.wall.h, mi: base.dt.wall.mi, s: base.dt.wall.s }, zone);
      if (idx === startIdx) produced = true;
      if (start > untilMs || start >= win.to + DAY_MS * 2 + base.duration) break;
      if (rule.count !== undefined && ++n > rule.count) break;
      push(start);
    }
    if (!produced && (rule.count === undefined || rule.count > 0)) push(base.start); // DTSTART é sempre a primeira ocorrência
    for (const r of rdates) push(r.dateOnly ? wallToUtc(r.wall, zone) : instantOf(r, ctx));
  }
  // EXDATE: tira as ocorrências (por instante; dia inteiro, pelo dia)
  const ex = new Set<number>();
  for (const p of all(master, 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const dt = parseDt(v, p.params);
      if (!dt) continue;
      ex.add(dt.dateOnly ? wallToUtc(dt.wall, base.allDay ? ctx.localZone : zoneOfRule(base.dt, ctx)) : instantOf(dt, ctx));
      if (dt.dateOnly && !base.allDay) {
        // EXDATE só com a data numa recorrência com hora: tira a ocorrência desse dia
        for (const i of out) {
          const z = zoneOfRule(base.dt, ctx);
          const w = zoneOffsetMs(z, i.start);
          const local = new Date(i.start + w);
          if (local.getUTCFullYear() === dt.wall.y && local.getUTCMonth() + 1 === dt.wall.m && local.getUTCDate() === dt.wall.d) ex.add(i.start);
        }
      }
    }
  }
  return out.filter((i) => !ex.has(i.start));
}

function cleanName(v: string | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s ? s : undefined;
}

function toCalEvent(inst: Instance, uid: string, calendar: string, ctx: Ctx): CalEvent | null {
  const c = inst.comp;
  const summary = unescapeText(first(c, 'SUMMARY')?.value ?? '').trim();
  const attendeeProps = all(c, 'ATTENDEE').filter((p) => (p.params.CUTYPE ?? 'INDIVIDUAL').toUpperCase() !== 'RESOURCE' && (p.params.CUTYPE ?? '').toUpperCase() !== 'ROOM');
  const emails = attendeeProps.map((p) => p.value.replace(/^mailto:/i, '').trim()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
  const names = attendeeProps.map((p) => cleanName(p.params.CN ? unescapeText(p.params.CN) : undefined)).filter((n): n is string => Boolean(n && !n.includes('@')));
  const conferences = ['X-GOOGLE-CONFERENCE', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'CONFERENCE', 'URL'].flatMap((n) => all(c, n).map((p) => p.value.trim()));
  const joinUrl = extractJoinUrl({
    hangoutLink: conferences.find((u) => /^https:\/\//i.test(u) && /(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)/i.test(u)),
    location: unescapeText(first(c, 'LOCATION')?.value ?? ''),
    description: unescapeText(first(c, 'DESCRIPTION')?.value ?? ''),
  });
  const organizer = first(c, 'ORGANIZER')?.value.replace(/^mailto:/i, '').trim();
  const people = attendeeProps.length + (organizer && !emails.includes(organizer) && attendeeProps.length > 0 ? 1 : 0);
  void ctx;
  return {
    id: `ics:${uid}:${inst.start}`,
    title: summary || t('calendar.untitled'),
    start: new Date(inst.start).toISOString(),
    end: new Date(inst.end).toISOString(),
    ...(joinUrl ? { joinUrl } : {}),
    calendar,
    attendees: people,
    ...(names.length > 0 ? { attendeeNames: [...new Set(names)] } : {}),
    ...(emails.length > 0 ? { attendeeEmails: emails } : {}),
    source: 'ics',
    ...(inst.allDay ? { allDay: true } : {}),
  };
}

/** Texto ICS → eventos da agenda na janela (recorrências expandidas, exceções aplicadas, cancelados fora). */
export function icsEvents(text: string, win: IcsWindow, localZone?: string): CalEvent[] {
  const parsed = parseIcs(text, localZone);
  const { ctx } = parsed;
  const calendar = parsed.name ?? 'ICS';
  const byUid = new Map<string, { master?: Component; overrides: Component[] }>();
  for (const v of parsed.vevents) {
    const uid = first(v, 'UID')?.value.trim() || `${first(v, 'DTSTART')?.value ?? ''}|${first(v, 'SUMMARY')?.value ?? ''}`;
    const slot = byUid.get(uid) ?? { overrides: [] };
    if (first(v, 'RECURRENCE-ID')) slot.overrides.push(v);
    else if (!slot.master || !first(slot.master, 'RRULE')) slot.master = v;
    byUid.set(uid, slot);
  }
  const events: CalEvent[] = [];
  for (const [uid, { master, overrides }] of byUid) {
    const replaced = new Set<number>();
    for (const o of overrides) {
      const r = first(o, 'RECURRENCE-ID');
      const rdt = r && parseDt(r.value, r.params);
      if (rdt) replaced.add(rdt.dateOnly ? wallToUtc(rdt.wall, ctx.localZone) : instantOf(rdt, ctx));
    }
    const list: Instance[] = [];
    if (master && first(master, 'STATUS')?.value.toUpperCase() !== 'CANCELLED') list.push(...instancesOf(master, ctx, win).filter((i) => !replaced.has(i.start)));
    for (const o of overrides) {
      if (first(o, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
      const d = eventDates(o, ctx);
      if (d && d.start + d.duration > win.from && d.start < win.to) list.push({ start: d.start, end: d.start + d.duration, allDay: d.allDay, comp: o });
    }
    for (const inst of list) {
      const e = toCalEvent(inst, uid, calendar, ctx);
      if (e) events.push(e);
      if (events.length >= MAX_EVENTS) break;
    }
  }
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
