import { attachmentsSearchText } from '../attachments/store';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { stripUserMarks } from '../../shared/notes-marks';
import { applySpeakerNames } from '../../shared/speakers';
import { MEETING_FILES, listMeetingDirs, readMeetingText, readMeta } from '../store/meeting-files';
import { findWordStart, fold, queryTerms } from './fold';

export type ContentField = 'notes' | 'transcript' | 'annotations';
export type HitField = ContentField | 'title' | 'folder';

/** Um trecho encontrado. `marks` são intervalos [início, fim) do `snippet` com o termo (o renderer põe em negrito). */
export type SearchHit = { field: HitField; snippet: string; offset: number; marks: [number, number][] };

export type SearchResult = { dir: string; title: string; date: string; folder: string | null; hits: SearchHit[] };

export type IndexedMeeting = {
  dir: string;
  id: string;
  title: string;
  startedAt: string;
  folderId?: string;
  titleFolded: string;
  /** Texto de cada campo (NFC) e o mesmo texto dobrado (sem acento, minúsculo, mesmo tamanho). */
  text: Record<ContentField, string>;
  folded: Record<ContentField, string>;
  stamps: string;
};

const CONTENT: readonly ContentField[] = ['notes', 'annotations', 'transcript'];
const FILE_OF: Record<ContentField, 'notes' | 'transcript' | 'annotations'> = { notes: 'notes', transcript: 'transcript', annotations: 'annotations' };
const WEIGHT = { title: 10, folder: 4, notes: 3, annotations: 3, transcript: 1 } as const;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;
const BATCH = 16;

const countWordStarts = (text: string, term: string, cap = 20): number => {
  let n = 0;
  let from = 0;
  while (n < cap) {
    const at = findWordStart(text, term, from);
    if (at < 0) break;
    n++;
    from = at + term.length;
  }
  return n;
};

export type EntryMatch = { score: number; matched: number; byField: Record<HitField, number> };

/** Quantos termos aparecem na reunião (começo de palavra) e a pontuação por campo. `folderFolded` é o nome da pasta, dobrado. */
export function matchEntry(entry: IndexedMeeting, terms: string[], folderFolded = ''): EntryMatch {
  const byField: Record<HitField, number> = { title: 0, folder: 0, notes: 0, annotations: 0, transcript: 0 };
  let score = 0;
  let matched = 0;
  for (const term of terms) {
    let found = false;
    const place = (field: HitField, text: string) => {
      const n = countWordStarts(text, term);
      if (n === 0) return;
      found = true;
      byField[field] += n;
      score += WEIGHT[field] * (1 + Math.log2(n));
    };
    place('title', entry.titleFolded);
    if (folderFolded) place('folder', folderFolded);
    for (const field of CONTENT) place(field, entry.folded[field]);
    if (found) matched++;
  }
  return { score, matched, byField };
}

const RECENCY_HALF_LIFE_DAYS = 120;
/** Bônus pequeno para o que é recente (desempata, não passa por cima da relevância). */
export function recencyBoost(startedAt: string, now: number): number {
  const age = Math.max(0, (now - Date.parse(startedAt)) / 86_400_000);
  return Number.isFinite(age) ? 2 * Math.pow(0.5, age / RECENCY_HALF_LIFE_DAYS) : 0;
}

const LINE_PREFIX = /^(?:#{1,6}\s+|[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|\*\*\[[\d:]+\]\s+[^:*]+:\*\*\s*)/;

type Line = { start: number; text: string };

function* lines(text: string): Generator<Line> {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    yield { start, text: text.slice(start, end) };
    start = end + 1;
  }
}

/** A primeira linha com todos os termos; sem ela, a linha com mais termos. -1 se nenhuma tiver. */
export function bestLine(text: string, foldedText: string, terms: string[]): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let bestCount = 0;
  for (const line of lines(foldedText)) {
    let count = 0;
    for (const term of terms) if (findWordStart(line.text, term) >= 0) count++;
    if (count > bestCount) {
      bestCount = count;
      best = { start: line.start, end: line.start + line.text.length };
      if (count === terms.length) break;
    }
  }
  void text;
  return best;
}

/** Intervalos de todos os termos em `foldedText` (começo de palavra), juntando os que se tocam. */
export function markRanges(foldedText: string, terms: string[], cap = 12): [number, number][] {
  const found: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (let n = 0; n < cap; n++) {
      const at = findWordStart(foldedText, term, from);
      if (at < 0) break;
      found.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** Trecho de uma linha, sem a marcação de Markdown e sem "[hh:mm:ss] Fulano:", com uns 120 caracteres em torno do primeiro termo. */
export function buildSnippet(raw: string, terms: string[]): { snippet: string; offsetInLine: number; marks: [number, number][] } {
  const prefix = LINE_PREFIX.exec(raw)?.[0].length ?? 0;
  const cleaned = raw.slice(prefix).replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
  const foldedClean = fold(cleaned);
  const first = Math.min(...terms.map((term) => findWordStart(foldedClean, term)).filter((at) => at >= 0), cleaned.length);
  let from = Math.max(0, first - SNIPPET_BEFORE);
  let to = Math.min(cleaned.length, first + SNIPPET_AFTER);
  if (from > 0) {
    const space = cleaned.indexOf(' ', from);
    if (space >= 0 && space < first) from = space + 1;
  }
  if (to < cleaned.length) {
    const space = cleaned.lastIndexOf(' ', to);
    if (space > first) to = space;
  }
  const body = cleaned.slice(from, to);
  const lead = from > 0 ? '…' : '';
  const tail = to < cleaned.length ? '…' : '';
  const snippet = `${lead}${body}${tail}`;
  const marks = markRanges(fold(snippet), terms);
  return { snippet, offsetInLine: prefix + from, marks };
}

export function hitFor(entry: IndexedMeeting, field: ContentField, terms: string[]): SearchHit | null {
  const line = bestLine(entry.text[field], entry.folded[field], terms);
  if (!line) return null;
  const { snippet, offsetInLine, marks } = buildSnippet(entry.text[field].slice(line.start, line.end), terms);
  return { field, snippet, offset: line.start + offsetInLine, marks };
}

const stampOf = async (path: string): Promise<string> => {
  try {
    const s = await stat(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
};

const TRACKED = [MEETING_FILES.meta, MEETING_FILES.notes, MEETING_FILES.transcript, MEETING_FILES.annotations, 'anexos/index.json'] as const;

async function stampsOf(dir: string): Promise<string> {
  return (await Promise.all(TRACKED.map((file) => stampOf(join(dir, file))))).join('|');
}

/**
 * Índice de busca em memória: título, notas, transcrição e anotações de todas as reuniões, dobrados (sem acento).
 * O `refresh` olha só a data de modificação dos 4 arquivos de cada reunião e relê o que mudou; por isso a busca vê
 * notas novas, anotações, renomeações e gravações sem depender de aviso de quem escreveu o arquivo.
 */
export class SearchIndex {
  private root: string | null = null;
  private entries = new Map<string, IndexedMeeting>();
  private running: Promise<void> | null = null;
  private again = false;

  /** Reunião a reunião: lê os arquivos só se a data de modificação mudou. */
  async refresh(root: string): Promise<void> {
    if (this.running) {
      this.again = true; // quem pediu durante um refresh recebe o resultado do próximo, que enxerga o que mudou antes do pedido
      await this.running;
      if (this.again) return this.refresh(root);
      return;
    }
    this.running = this.run(root).finally(() => {
      this.running = null;
    });
    await this.running;
  }

  private async run(root: string): Promise<void> {
    this.again = false;
    if (this.root !== root) {
      this.root = root;
      this.entries.clear();
    }
    const dirs = await listMeetingDirs(root);
    const present = new Set(dirs);
    for (const dir of [...this.entries.keys()]) if (!present.has(dir)) this.entries.delete(dir);
    for (let i = 0; i < dirs.length; i += BATCH) {
      await Promise.all(
        dirs.slice(i, i + BATCH).map(async (dir) => {
          const stamps = await stampsOf(dir);
          if (this.entries.get(dir)?.stamps === stamps) return;
          try {
            this.entries.set(dir, await loadEntry(dir, stamps));
          } catch {
            this.entries.delete(dir); // meta.json ilegível: a reunião fica fora da busca
          }
        }),
      );
    }
  }

  get size(): number {
    return this.entries.size;
  }

  all(): IndexedMeeting[] {
    return [...this.entries.values()];
  }

  get(dir: string): IndexedMeeting | undefined {
    return this.entries.get(dir);
  }

  /** Reunião que tem TODAS as palavras (em começo de palavra) em algum campo; do mais ao menos relevante, com desempate por data. */
  query(raw: string, folderNames: ReadonlyMap<string, string>, now = Date.now(), limit = 50): SearchResult[] {
    const terms = queryTerms(raw);
    if (terms.length === 0) return [];
    const phrase = terms.length > 1 ? terms.join(' ') : null;
    const scored: { entry: IndexedMeeting; score: number; folderName: string | null }[] = [];
    for (const entry of this.entries.values()) {
      const folderName = (entry.folderId && folderNames.get(entry.folderId)) || null;
      const m = matchEntry(entry, terms, folderName ? fold(folderName) : '');
      if (m.matched < terms.length) continue;
      let score = m.score + recencyBoost(entry.startedAt, now);
      if (phrase) {
        if (entry.titleFolded.includes(phrase)) score += WEIGHT.title;
        for (const field of CONTENT) if (entry.folded[field].includes(phrase)) score += WEIGHT[field];
      }
      scored.push({ entry, score, folderName });
    }
    scored.sort((a, b) => b.score - a.score || b.entry.startedAt.localeCompare(a.entry.startedAt));
    return scored.slice(0, limit).map(({ entry, folderName }) => {
      const hits: SearchHit[] = [];
      const titleMarks = markRanges(entry.titleFolded, terms);
      if (titleMarks.length > 0) hits.push({ field: 'title', snippet: entry.title, offset: 0, marks: titleMarks });
      if (folderName) {
        const marks = markRanges(fold(folderName), terms);
        if (marks.length > 0) hits.push({ field: 'folder', snippet: folderName, offset: 0, marks });
      }
      for (const field of CONTENT) {
        const hit = hitFor(entry, field, terms);
        if (hit) hits.push(hit);
      }
      return { dir: entry.dir, title: entry.title, date: entry.startedAt, folder: folderName, hits };
    });
  }
}

async function loadEntry(dir: string, stamps: string): Promise<IndexedMeeting> {
  const meta = await readMeta(dir);
  // nomes e texto dos anexos entram na busca (junto das anotações)
  const attached = (await attachmentsSearchText(dir).catch(() => '')).trim();
  const [notes, annotations, transcript] = await Promise.all(CONTENT.map((field) => readMeetingText(dir, FILE_OF[field])));
  const text = { notes: stripUserMarks(notes ?? '').normalize('NFC'), annotations: `${annotations ?? ''}${attached ? `\n\n${attached}` : ''}`.normalize('NFC'), transcript: applySpeakerNames(transcript ?? '', meta.speakers).normalize('NFC') }; // busca e chat enxergam os nomes dados às "Pessoa N"
  return {
    dir,
    id: meta.id,
    title: meta.title,
    startedAt: meta.startedAt,
    ...(meta.folderId ? { folderId: meta.folderId } : {}),
    titleFolded: fold(meta.title),
    text,
    folded: { notes: fold(text.notes), annotations: fold(text.annotations), transcript: fold(text.transcript) },
    stamps,
  };
}
