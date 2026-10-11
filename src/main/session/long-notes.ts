import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiRunner } from '../ai/types';
import { writeAtomic } from '../store/meeting-files';
import type { TranscriptionLanguage } from '../../shared/types';

/**
 * Reuniões longas: 2 h de fala são ~18-20 mil palavras (~120-165 mil caracteres com as marcas de horário, ~40-50 mil
 * tokens). Cabe nos 200k do Claude e nos 400k+ do GPT-5/Gemini, mas é lento, caro e a IA perde detalhes do meio.
 * Acima de `directMaxChars` o Rice faz map-reduce: extrai por parte (~15 min) e preenche o template a partir
 * das extrações e das anotações. As extrações ficam em `extracoes.json` (reaproveitadas ao regerar com outro template).
 */
export const DEFAULT_DIRECT_MAX_CHARS = 60_000;
export const PART_MS = 15 * 60_000;
export const OVERLAP_MS = 60_000;
const MIN_LAST_PART_MS = 3 * 60_000;
const PART_MAX_CHARS = 40_000; // rede de segurança: uma parte nunca passa disso, mesmo com fala muito densa

export const DIGEST_FILE = 'extracoes.json';

export type NotesProgress = { dir: string; phase: 'extract' | 'write' | 'done'; part?: number; total?: number };

/** `retryDelayMs`: espera antes da nova tentativa automática depois de uma falha transitória (R-46). */
type Config = {
  directMaxChars: number;
  onProgress: (p: NotesProgress) => void;
  retryDelayMs: number;
  /** Modelo leve para as extrações por parte (o passo final das notas continua no principal). */
  lightRunner?: Pick<AiRunner, 'run'>;
};
const config: Config = { directMaxChars: DEFAULT_DIRECT_MAX_CHARS, onProgress: () => {}, retryDelayMs: 5000 };

/** Ajustes do main: limite (configurável nas configurações) e o ouvinte de progresso que vai para a UI. */
export function configureLongNotes(next: Partial<Config>): void {
  Object.assign(config, next);
}
export const longNotesConfig = (): Readonly<Config> => config;
export const emitProgress = (p: NotesProgress): void => config.onProgress(p);

export type Part = { index: number; from: string; to: string; text: string };

type Line = { raw: string; clock: string | null; ms: number };

const CLOCK = /^\*\*\[(\d{2}):(\d{2}):(\d{2})\]/;

/** Linhas da transcrição com o horário em ms corridos (a virada da meia-noite soma um dia). Linhas sem horário herdam o anterior. */
export function parseLines(transcript: string): Line[] {
  const lines: Line[] = [];
  let day = 0;
  let prev = 0;
  let last = 0;
  for (const raw of transcript.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const m = CLOCK.exec(raw);
    if (!m) {
      lines.push({ raw, clock: null, ms: last });
      continue;
    }
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (sec < prev - 12 * 3600) day++;
    prev = sec;
    last = (sec + day * 86_400) * 1000;
    lines.push({ raw, clock: `${m[1]}:${m[2]}:${m[3]}`, ms: last });
  }
  return lines;
}

/** Divide em partes de ~15 min; cada parte (menos a primeira) repete o último minuto da anterior para não cortar uma ideia ao meio. */
export function splitTranscript(transcript: string, opts: { partMs?: number; overlapMs?: number; maxChars?: number } = {}): Part[] {
  const partMs = opts.partMs ?? PART_MS;
  const overlapMs = opts.overlapMs ?? OVERLAP_MS;
  const maxChars = opts.maxChars ?? PART_MAX_CHARS;
  const lines = parseLines(transcript).filter((l) => !l.raw.startsWith('# '));
  const groups: Line[][] = [];
  let current: Line[] = [];
  let ownStart = 0; // índice, dentro de `current`, onde começa o que é só desta parte (antes é sobreposição)
  let size = 0;
  for (const line of lines) {
    const first = current[ownStart];
    if (first && (line.ms - first.ms >= partMs || size + line.raw.length > maxChars)) {
      groups.push(current);
      const end = current[current.length - 1]!.ms;
      const tail = current.filter((l) => l.ms >= end - overlapMs);
      current = tail.length < current.length ? tail : [];
      ownStart = current.length;
      size = current.reduce((n, l) => n + l.raw.length, 0);
    }
    current.push(line);
    size += line.raw.length;
  }
  if (current.length > ownStart) {
    const own = current.slice(ownStart);
    const prev = groups[groups.length - 1];
    const chars = (ls: readonly Line[]) => ls.reduce((n, l) => n + l.raw.length, 0);
    if (prev && own[own.length - 1]!.ms - own[0]!.ms < MIN_LAST_PART_MS && chars(prev) + chars(own) < maxChars) {
      groups[groups.length - 1] = [...prev, ...own]; // sobra curta: junta na parte anterior
    } else {
      groups.push(current);
    }
  }
  return groups.map((g, i) => {
    const clocks = g.filter((l) => l.clock);
    return { index: i + 1, from: clocks[0]?.clock ?? '', to: clocks[clocks.length - 1]?.clock ?? '', text: g.map((l) => l.raw).join('\n\n') };
  });
}

export type DigestPart = { hash: string; from: string; to: string; text: string };
export type Digest = { v: 1; language: TranscriptionLanguage; parts: DigestPart[] };

const hashOf = (text: string, language: string): string => createHash('sha1').update(language).update('\0').update(text).digest('hex');

export async function readDigest(dir: string): Promise<Digest | null> {
  try {
    const d = JSON.parse(await readFile(join(dir, DIGEST_FILE), 'utf8')) as Digest;
    return d?.v === 1 && Array.isArray(d.parts) ? d : null;
  } catch {
    return null;
  }
}

/** As extrações como texto corrido, na ordem, para o passo final e para o chat. */
export function digestText(digest: Pick<Digest, 'parts'>): string {
  return digest.parts.map((p, i) => `### ${i + 1} (${p.from}–${p.to})\n${p.text.trim()}`).join('\n\n');
}

export type ExtractTexts = { system: string; prompt: (part: Part, total: number) => string };

const save = (dir: string, digest: Digest): Promise<void> => writeAtomic(join(dir, DIGEST_FILE), `${JSON.stringify(digest)}\n`);

/** Extrai cada parte em ordem (uma chamada por vez, para respeitar limites de uso das assinaturas) e guarda em `extracoes.json`. */
export async function extractParts(
  dir: string,
  runner: Pick<AiRunner, 'run'>,
  parts: readonly Part[],
  language: TranscriptionLanguage,
  texts: ExtractTexts,
): Promise<Digest> {
  const previous = await readDigest(dir);
  const reusable = new Map((previous?.parts ?? []).map((p) => [p.hash, p]));
  const out: DigestPart[] = [];
  for (const part of parts) {
    emitProgress({ dir, phase: 'extract', part: part.index, total: parts.length });
    const hash = hashOf(part.text, language);
    const hit = reusable.get(hash);
    if (hit) {
      out.push({ ...hit, from: part.from, to: part.to });
      continue;
    }
    const gen = runner.run({ system: texts.system, prompt: texts.prompt(part, parts.length) });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    out.push({ hash, from: part.from, to: part.to, text: step.value.trim() });
    await save(dir, { v: 1, language, parts: out }); // se uma parte falhar, o que já foi extraído não se perde
  }
  const digest: Digest = { v: 1, language, parts: out };
  await save(dir, digest);
  return digest;
}
