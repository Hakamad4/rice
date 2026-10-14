/** Prazos: ISO (AAAA-MM-DD) ou relativos em pt/en ("até sexta", "semana que vem", "next Friday", "dia 15", "em 3 dias"), sempre a partir da data da reunião. */
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const strip = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const WEEKDAYS: Record<string, number> = {
  domingo: 0, dom: 0, segunda: 1, 'segunda-feira': 1, seg: 1, terca: 2, 'terca-feira': 2, ter: 2, quarta: 3, 'quarta-feira': 3, qua: 3, quinta: 4, 'quinta-feira': 4, qui: 4, sexta: 5, 'sexta-feira': 5, sex: 5, sabado: 6, sab: 6,
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, sept: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};
const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Próxima ocorrência do dia da semana (hoje conta só se `allowToday`). */
function nextWeekday(base: Date, wd: number, allowToday: boolean): Date {
  let delta = (wd - base.getDay() + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  return addDays(base, delta);
}

/** O próximo dia `day` do mês: neste mês se ainda não passou (ou for hoje), senão no seguinte (virada de mês e de ano). */
function nextDayOfMonth(base: Date, day: number): Date | null {
  for (let add = 0; add < 13; add++) {
    const first = new Date(base.getFullYear(), base.getMonth() + add, 1);
    const candidate = new Date(first.getFullYear(), first.getMonth(), day);
    if (candidate.getMonth() !== first.getMonth()) continue; // dia 31 em mês de 30
    if (candidate >= new Date(base.getFullYear(), base.getMonth(), base.getDate())) return candidate;
  }
  return null;
}

function endOfMonth(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth() + 1, 0);
}

/**
 * Converte o texto de um prazo em AAAA-MM-DD, ou null se não houver data clara (nunca inventa).
 * `base` = data da reunião (hora ignorada).
 */
export function parseDue(raw: unknown, baseDate: Date): string | null {
  if (typeof raw !== 'string') return null;
  const text = strip(raw).replace(/[.,;!?]+$/g, '');
  if (!text || /^(null|none|n\/a|sem prazo|no deadline|-|nao definido|indefinido|tbd|a definir)$/.test(text)) return null;
  const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:t.*)?$/.exec(text);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return d.getMonth() === Number(iso[2]) - 1 ? isoDate(d) : null;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = slash[3] ? Number(slash[3]) : base.getFullYear();
    if (year < 100) year += 2000;
    let d = new Date(year, month - 1, day);
    if (d.getMonth() !== month - 1) return null;
    if (!slash[3] && d < base) d = new Date(year + 1, month - 1, day); // "15/01" depois de dezembro: o ano que vem
    return isoDate(d);
  }
  const body = text.replace(/^(ate|por|ate o|ate a|ate o dia|by|before|until|on|no|na|em|para|para o|para a|due|dia)\s+/, '').replace(/^(o|a|the)\s+/, '');
  if (/^(hoje|today|esta noite|tonight|ate o fim do dia|eod|end of day)$/.test(body) || /^(hoje|today)\b/.test(text)) return isoDate(base);
  if (/^(amanha|tomorrow)$/.test(body)) return isoDate(addDays(base, 1));
  if (/^(depois de amanha|day after tomorrow)$/.test(body)) return isoDate(addDays(base, 2));
  // semana que vem / próxima semana (segunda da semana seguinte) e "fim da semana"
  if (/^(semana que vem|proxima semana|next week|na semana que vem)$/.test(body)) return isoDate(nextWeekday(base, 1, false));
  if (/^(fim da semana|final da semana|end of (the )?week|eow|esta semana|essa semana|this week)$/.test(body)) return isoDate(nextWeekday(base, 5, true));
  if (/^(fim do mes|final do mes|end of (the )?month|eom|este mes|esse mes|this month)$/.test(body)) return isoDate(endOfMonth(base));
  if (/^(mes que vem|proximo mes|next month)$/.test(body)) return isoDate(new Date(base.getFullYear(), base.getMonth() + 1, 1));
  // em N dias/semanas
  const inN = /^(?:em |in |daqui a |dentro de )?(\d+|[a-z]+) (dia|dias|day|days|semana|semanas|week|weeks)(?: uteis)?$/.exec(body);
  if (inN) {
    const n = /^\d+$/.test(inN[1]!) ? Number(inN[1]) : NUMBER_WORDS[inN[1]!];
    if (n !== undefined) return isoDate(addDays(base, /sem|week/.test(inN[2]!) ? n * 7 : n));
  }
  // próxima sexta / next Friday / sexta que vem / sexta
  const wdMatch = /^(?:(proxima|proximo|next|this|esta|este|essa|esse)\s+)?([a-z-]+?)(?:\s+(?:que vem|next))?$/.exec(body);
  if (wdMatch && WEEKDAYS[wdMatch[2]!] !== undefined) {
    const wd = WEEKDAYS[wdMatch[2]!]!;
    const explicitNext = /^(proxima|proximo|next)$/.test(wdMatch[1] ?? '') || /(que vem|next)$/.test(body);
    let d = nextWeekday(base, wd, !explicitNext);
    if (explicitNext && d.getTime() - base.getTime() < 7 * 86400000 && base.getDay() !== wd && (wdMatch[1] === 'proxima' || wdMatch[1] === 'proximo' || wdMatch[1] === 'next') && wd <= base.getDay()) d = addDays(d, 0);
    return isoDate(d);
  }
  // dia 15 / 15th / 15 de novembro / november 15
  const dayOnly = /^(\d{1,2})(?:st|nd|rd|th|o)?$/.exec(body);
  if (dayOnly) {
    const d = nextDayOfMonth(base, Number(dayOnly[1]));
    return d ? isoDate(d) : null;
  }
  const dm = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:de\s+|of\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/.exec(body) ?? /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(body);
  if (dm) {
    const [a, b, y] = [dm[1]!, dm[2]!, dm[3]];
    const day = /^\d+$/.test(a) ? Number(a) : Number(b);
    const monthName = /^\d+$/.test(a) ? b : a;
    const month = MONTHS[monthName];
    if (month && day >= 1 && day <= 31) {
      let year = y ? Number(y) : base.getFullYear();
      let d = new Date(year, month - 1, day);
      if (d.getMonth() !== month - 1) return null;
      if (!y && d < base) {
        year++;
        d = new Date(year, month - 1, day);
      }
      return isoDate(d);
    }
  }
  return null;
}

/** Dias entre hoje e o prazo (negativo = vencida). */
export function daysUntil(due: string, now: Date): number {
  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const a = new Date(y, m - 1, d).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}
