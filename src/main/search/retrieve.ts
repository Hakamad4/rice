import type { Folder } from '../../shared/types';
import { descendantIds, folderPaths } from '../store/folders';
import { findWordStart, fold, queryTerms } from './fold';
import { bestLine, buildSnippet, matchEntry, recencyBoost, type IndexedMeeting, type SearchIndex } from './index';

export type Period = { from: number; to: number };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Segunda-feira da semana de `d` (semana começa na segunda, como no Brasil). */
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

const MONTHS: Record<string, number> = {
  janeiro: 0, january: 0, fevereiro: 1, february: 1, marco: 2, march: 2, abril: 3, april: 3, maio: 4, may: 4, junho: 5, june: 5,
  julho: 6, july: 6, agosto: 7, august: 7, setembro: 8, september: 8, outubro: 9, october: 9, novembro: 10, november: 10, dezembro: 11, december: 11,
};
const UNIT_DAYS: Record<string, number> = { dia: 1, dias: 1, day: 1, days: 1, semana: 7, semanas: 7, week: 7, weeks: 7, mes: 30, meses: 30, month: 30, months: 30 };
const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, one: 1, dois: 2, duas: 2, two: 2, tres: 3, three: 3, quatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, sete: 7, seven: 7 };

type Rule = { re: RegExp; range: (m: RegExpExecArray, now: Date) => Period };

const span = (from: Date, to: Date): Period => ({ from: from.getTime(), to: to.getTime() });
const monthRange = (year: number, month: number): Period => span(new Date(year, month, 1), new Date(year, month + 1, 1));
const quarterRange = (year: number, q: number): Period => span(new Date(year, q * 3, 1), new Date(year, q * 3 + 3, 1));

const RULES: Rule[] = [
  { re: /\b(?:ultimos|ultimas|last|past)\s+(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|one|two|three|four|five|six|seven)\s+(dias?|semanas?|mes(?:es)?|days?|weeks?|months?)\b/, range: (m, now) => {
    const n = /^\d/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!]!;
    return span(addDays(startOfDay(now), -n * UNIT_DAYS[m[2]!]! + 1), new Date(now.getTime() + 1));
  } },
  { re: /\b(?:semana passada|last week)\b/, range: (_m, now) => span(addDays(mondayOf(now), -7), mondayOf(now)) },
  { re: /\b(?:essa|esta|nesta|this)\s+semana\b|\bthis week\b/, range: (_m, now) => span(mondayOf(now), new Date(now.getTime() + 1)) },
  { re: /\b(?:mes passado|last month)\b/, range: (_m, now) => monthRange(now.getFullYear(), now.getMonth() - 1) },
  { re: /\b(?:ultimo mes|past month)\b/, range: (_m, now) => span(addDays(startOfDay(now), -29), new Date(now.getTime() + 1)) },
  { re: /\b(?:esse|este|neste|this)\s+mes\b|\bthis month\b/, range: (_m, now) => span(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getTime() + 1)) },
  { re: /\b(?:ultimo|last)\s+(?:trimestre|quarter)\b/, range: (_m, now) => {
    const q = Math.floor(now.getMonth() / 3) - 1;
    return q < 0 ? quarterRange(now.getFullYear() - 1, 3) : quarterRange(now.getFullYear(), q);
  } },
  { re: /\b(?:esse|este|neste|this)\s+(?:trimestre|quarter)\b/, range: (_m, now) => span(new Date(quarterRange(now.getFullYear(), Math.floor(now.getMonth() / 3)).from), new Date(now.getTime() + 1)) },
  { re: /\b(?:ano passado|last year)\b/, range: (_m, now) => span(new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear(), 0, 1)) },
  { re: /\b(?:esse|este|neste|this)\s+ano\b|\bthis year\b/, range: (_m, now) => span(new Date(now.getFullYear(), 0, 1), new Date(now.getTime() + 1)) },
  { re: /\bontem\b|\byesterday\b/, range: (_m, now) => span(addDays(startOfDay(now), -1), startOfDay(now)) },
  { re: /\bhoje\b|\btoday\b/, range: (_m, now) => span(startOfDay(now), new Date(now.getTime() + 1)) },
  { re: /\b(?:em|de|in|during|no mes de|durante)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(?:de\s+)?(20\d\d))?\b/, range: (m, now) => {
    const month = MONTHS[m[1]!]!;
    const year = m[2] ? Number(m[2]) : month <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
    return monthRange(year, month);
  } },
];

/** Período dito na pergunta ("último mês", "semana passada", "last 3 weeks"…), em português ou inglês; `rest` é a pergunta sem essa expressão. */
export function parsePeriod(question: string, now: Date = new Date()): { period: Period | null; rest: string } {
  const text = fold(question);
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) return { period: rule.range(m, now), rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
  }
  return { period: null, rest: text };
}

const STOP = new Set(
  `o a os as um uma uns umas de do da dos das no na nos nas em ao aos pelo pela pelos pelas por para pra com sem sobre entre ate e ou mas que qual quais quem quando onde como quanto quantos porque
  foi foram fui ser sao era eram tem tinha tinham teve ha houve fazer fez feito falamos falei falou falaram disse disseram discutimos discutiram combinamos
  eu voce nos eles elas ele ela meu minha meus minhas seu sua seus suas esse essa esses essas este esta estes estas isso isto aquilo me te se lhe
  mais menos muito muita pouco tambem ainda ja so apenas todo toda todos todas cada algum alguma alguns algumas nenhum nenhuma outro outra
  reuniao reunioes meeting meetings call calls conversa conversas
  the an of in on at to for from with without about between and or but that which what who when where how why many much is are was were be been being did do does done have has had having
  i you we they he she it my your our their his her its this these those me us them
  more less also still already only all each any some other another talk talked discussed said say mention mentioned
  resumo resuma resumir liste listar lista me diga dizer mostre mostrar summarize summary list tell show give
  ultima ultimo ultimas ultimos recente recentes recentemente anterior anteriores atual atuais passada passado passadas passados semana semanas mes meses ano anos dia dias hoje ontem anteontem agora
  fiz fizemos fizeram faco fazemos acontecer aconteceu rolou foi sobre
  last latest recent recently previous past current week weeks month months year years day days today yesterday now happened`.split(/\s+/),
);

/** Palavras da pergunta que valem como busca: sem acento, sem palavras comuns, sem o período nem os nomes das pastas citadas. */
export function questionTerms(rest: string): string[] {
  return queryTerms(rest).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Variação de flexão ("orçamentos", "decidimos"): só o começo da palavra, para achar "orçamento", "decidiu". */
export function stem(term: string): string {
  if (term.length >= 8) return term.slice(0, term.length - 3);
  if (term.length >= 6) return term.slice(0, term.length - 2);
  return term;
}

export type RetrievedMeeting = { n: number; entry: IndexedMeeting; folder: string | null; matched: number; score: number };

export type Retrieval = {
  meetings: RetrievedMeeting[];
  terms: string[];
  period: Period | null;
  folderIds: string[];
  /** A pergunta tinha palavras de busca mas nenhuma reunião as menciona: vão as mais recentes (a resposta avisa). */
  fallback: boolean;
  /** Havia um período na pergunta e nenhuma reunião cai nele. */
  emptyPeriod: boolean;
};

export type RetrieveOptions = {
  folders: Folder[];
  /** Pasta escolhida no chip do painel (vale além das pastas citadas na pergunta). */
  scopeFolderId?: string | null;
  now?: Date;
  limit?: number;
};

export const DEFAULT_LIMIT = 8;
/** Pergunta de recência/genérica ("última reunião", "ontem", "minhas reuniões") ou sem match: as N mais recentes do período. */
export const RECENT_LIMIT = 5;

/**
 * As reuniões que a pergunta pede: filtra por período e pasta (citada ou escolhida), pontua pelas palavras da pergunta
 * (começo de palavra, com flexão) e ordena por relevância e recência. Sem palavras úteis, vale só o filtro e a recência.
 */
export function retrieve(index: SearchIndex, question: string, opts: RetrieveOptions): Retrieval {
  const now = opts.now ?? new Date();
  const { period, rest: afterPeriod } = parsePeriod(question, now);
  let rest = afterPeriod;
  const folderIds = new Set<string>();
  const addFolder = (id: string) => [id, ...descendantIds(opts.folders, id)].forEach((x) => folderIds.add(x)); // a pasta e tudo que está dentro dela
  if (opts.scopeFolderId) addFolder(opts.scopeFolderId);
  const folderNameOf = folderPaths(opts.folders);
  for (const folder of opts.folders) {
    const name = fold(folder.name).replace(/\s+/g, ' ').trim();
    if (name.length < 2) continue;
    const at = findWordStart(rest, name);
    if (at >= 0 && !opts.scopeFolderId) {
      addFolder(folder.id);
      rest = `${rest.slice(0, at)} ${rest.slice(at + name.length)}`;
    }
  }
  const terms = questionTerms(rest);
  const stems = [...new Set(terms.map(stem))];
  const candidates = index.all().filter((e) => {
    if (folderIds.size > 0 && !(e.folderId && folderIds.has(e.folderId))) return false;
    if (period) {
      const at = Date.parse(e.startedAt);
      if (!(at >= period.from && at < period.to)) return false;
    }
    return true;
  });
  const scored = candidates.map((entry) => {
    const m = stems.length > 0 ? matchEntry(entry, stems) : { score: 0, matched: 0 };
    return { entry, matched: m.matched, score: m.score + m.matched * 5 + recencyBoost(entry.startedAt, now.getTime()) };
  });
  scored.sort((a, b) => b.score - a.score || b.entry.startedAt.localeCompare(a.entry.startedAt));
  // sem palavras de busca ("última reunião", "ontem", "minhas reuniões"): vale o filtro e a recência; com palavras que
  // ninguém menciona: caem as mais recentes (e a resposta avisa), em vez de recusar
  const relevant = stems.length > 0 ? scored.filter((s) => s.matched > 0) : scored;
  const fallback = stems.length > 0 && relevant.length === 0 && scored.length > 0;
  const chosen = fallback ? scored : relevant;
  const limit = opts.limit ?? (stems.length === 0 || fallback ? RECENT_LIMIT : DEFAULT_LIMIT);
  return {
    meetings: chosen.slice(0, limit).map((s, i) => ({ n: i + 1, entry: s.entry, folder: (s.entry.folderId && folderNameOf.get(s.entry.folderId)) || null, matched: s.matched, score: s.score })),
    terms: stems,
    period,
    folderIds: [...folderIds],
    fallback,
    emptyPeriod: Boolean(period) && candidates.length === 0,
  };
}

export const DEFAULT_BUDGET = 48_000;
const NOTES_SHARE = 0.65;
const MAX_SNIPPETS = 6;
const SNIPPET_LINE = 280;

const cut = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const at = text.lastIndexOf('\n', max);
  return text.slice(0, at > max * 0.5 ? at : max).trimEnd();
};

/** Linhas da transcrição que têm as palavras buscadas (as primeiras, com todas as palavras antes), cada uma cortada. */
function transcriptLines(entry: IndexedMeeting, terms: string[], max: number): string[] {
  if (terms.length === 0 || max <= 0) return [];
  const out: string[] = [];
  let used = 0;
  let from = 0;
  const text = entry.text.transcript;
  const foldedText = entry.folded.transcript;
  while (out.length < MAX_SNIPPETS && from < text.length) {
    const rest = foldedText.slice(from);
    const line = bestLine(text.slice(from), rest, terms);
    if (!line) break;
    const raw = text.slice(from + line.start, from + line.end);
    const clock = /^\*\*\[(\d\d:\d\d):\d\d\]\s+([^:*]+):\*\*\s*(.*)$/.exec(raw.trim());
    const body = clock ? `[${clock[1]}] ${clock[2]}: ${buildSnippet(clock[3]!, terms).snippet}` : buildSnippet(raw, terms).snippet;
    const piece = body.slice(0, SNIPPET_LINE);
    if (used + piece.length > max) break;
    out.push(piece);
    used += piece.length + 1;
    from += line.end + 1;
  }
  return out;
}

// O texto da reunião não pode fechar nem abrir um dos nossos blocos.
export const neutralizeTags = (text: string): string => text.replace(/<(\/?)(reuniao|notas|trechos|anotacoes|conversa|pergunta)\b[^>]*>/gi, '‹$1$2›');

export type ContextLabels = { title: string; date: string; folder: string; notes: string; excerpts: string; none: string; truncated: string };

/**
 * O contexto da pergunta: para cada reunião, as notas (cortadas) e trechos da transcrição com as palavras buscadas,
 * dentro de um orçamento de caracteres dividido igualmente entre as reuniões.
 */
export function buildContext(meetings: RetrievedMeeting[], terms: string[], labels: ContextLabels, formatDate: (iso: string) => string, budget = DEFAULT_BUDGET): string {
  if (meetings.length === 0) return '';
  const each = Math.floor(budget / meetings.length);
  return meetings
    .map(({ n, entry, folder }) => {
      const header = [
        `${labels.title}: ${neutralizeTags(entry.title.replace(/[\r\n]+/g, ' '))}`,
        `${labels.date}: ${formatDate(entry.startedAt)}`,
        ...(folder ? [`${labels.folder}: ${neutralizeTags(folder)}`] : []),
      ].join('\n');
      const room = Math.max(0, each - header.length - 120);
      const notesText = entry.text.notes.trim();
      const notesMax = Math.floor(room * NOTES_SHARE);
      const notes = notesText ? `${cut(neutralizeTags(notesText), notesMax)}${notesText.length > notesMax ? `\n${labels.truncated}` : ''}` : labels.none;
      const lines = transcriptLines(entry, terms, room - Math.min(notes.length, notesMax)).map(neutralizeTags);
      return [
        `<reuniao n="${n}">`,
        header,
        `<notas>\n${notes}\n</notas>`,
        ...(lines.length > 0 ? [`<trechos>\n${lines.join('\n')}\n</trechos>`] : []),
        '</reuniao>',
      ].join('\n');
    })
    .join('\n\n');
}
