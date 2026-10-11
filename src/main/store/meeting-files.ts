import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { formatClock, meetingFolderName, sanitizeTitle, toLocalIso } from '../../shared/naming';
import { t, type UiLanguage } from '../i18n';
import { renameRetry } from '../platform/fs';
import type { ChatTurn, MeetingMeta, MeetingTrigger, Segment } from '../../shared/types';

export const MEETING_FILES = {
  meta: 'meta.json',
  transcript: 'transcricao.md',
  annotations: 'anotacoes.md',
  annotationsLog: 'anotacoes.json',
  speakers: 'falantes.json',
  chat: 'chat.md',
  chatLog: 'chat.jsonl',
  notes: 'notas.md',
  previousNotes: 'notas-anterior.md',
  audio: 'audio.m4a',
} as const;

export type CreateMeetingInput = {
  title: string;
  startedAt: Date;
  trigger: MeetingTrigger;
  app?: string;
  calendarEventId?: string;
  /** 'draft' = criada na UI e ainda não gravada (padrão: 'recording'). */
  state?: 'draft' | 'recording';
  templateId?: string;
  folderId?: string;
};

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === code;
}

async function makeUniqueDir(root: string, base: string): Promise<string> {
  for (let n = 1; ; n++) {
    const dir = join(root, n === 1 ? base : `${base} (${n})`);
    try {
      await mkdir(dir);
      return dir;
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err;
    }
  }
}

export async function createMeeting(root: string, input: CreateMeetingInput): Promise<{ dir: string; meta: MeetingMeta }> {
  await mkdir(root, { recursive: true });
  const collapsed = input.title.replace(/\s+/g, ' ').trim();
  const title = collapsed ? collapsed : sanitizeTitle(input.title, t('meeting.default-title'));
  const dir = await makeUniqueDir(root, meetingFolderName(input.startedAt, title));
  const meta: MeetingMeta = {
    id: randomUUID(),
    title,
    startedAt: toLocalIso(input.startedAt),
    state: input.state ?? 'recording',
    trigger: input.trigger,
    ...(input.app ? { app: input.app } : {}),
    ...(input.calendarEventId ? { calendarEventId: input.calendarEventId } : {}),
    notesStatus: 'pending',
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(input.folderId ? { folderId: input.folderId } : {}),
    ...((input.state ?? 'recording') === 'recording' ? { sessions: [{ startedAt: toLocalIso(input.startedAt) }] } : {}),
    gaps: [],
  };
  await writeMeta(dir, meta);
  await writeFile(join(dir, MEETING_FILES.transcript), `${t('file.transcript-heading', { title })}\n\n`);
  return { dir, meta };
}

/** Só altera o título do meta.json; a pasta fica como está para não quebrar uma gravação em andamento. */
export async function renameMeeting(dir: string, title: string): Promise<MeetingMeta> {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error(t('err.empty-title'));
  return updateMeta(dir, (meta) => ({ ...meta, title: clean }));
}

const metaQueues = new Map<string, Promise<unknown>>();

/** Read-modify-write do meta.json: relê do disco e serializa por pasta, para nenhuma escrita sobrescrever outra com dados velhos. */
export function updateMeta(dir: string, change: (meta: MeetingMeta) => MeetingMeta): Promise<MeetingMeta> {
  const run = (metaQueues.get(dir) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const next = change(await readMeta(dir));
    await writeMeta(dir, next);
    return next;
  });
  const tail = run.catch(() => undefined);
  metaQueues.set(dir, tail);
  void tail.then(() => {
    if (metaQueues.get(dir) === tail) metaQueues.delete(dir);
  });
  return run;
}

export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, data);
    await renameRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function writeMeta(dir: string, meta: MeetingMeta): Promise<void> {
  await writeAtomic(join(dir, MEETING_FILES.meta), `${JSON.stringify(meta, null, 2)}\n`);
}

export async function readMeta(dir: string): Promise<MeetingMeta> {
  return JSON.parse(await readFile(join(dir, MEETING_FILES.meta), 'utf8')) as MeetingMeta;
}

export function formatSegmentLine(startedAt: Date, segment: Segment): string {
  const clock = formatClock(new Date(startedAt.getTime() + segment.startMs));
  const who = segment.source === 'Outros' && segment.speaker ? `Pessoa ${segment.speaker}` : segment.source; // `Pessoa N` no arquivo; o app mostra "Person N" em inglês e aplica os nomes
  return `**[${clock}] ${who}:** ${segment.text.trim()}\n\n`;
}

/** Texto de um marcador de lacuna (o mesmo que `appendGapMarker` grava); `key` troca a causa (ex.: `marker.sleep`). */
export function gapMarkerLine(startedAt: Date, fromMs: number, toMs: number, language: UiLanguage = 'pt-BR', key = 'marker.gap'): string {
  const hm = (ms: number) => formatClock(new Date(startedAt.getTime() + ms)).slice(0, 5);
  return `${t(key, { from: hm(fromMs), to: hm(toMs) }, language)}\n\n`;
}

export async function appendSegment(dir: string, startedAt: Date, segment: Segment): Promise<void> {
  await appendFile(join(dir, MEETING_FILES.transcript), formatSegmentLine(startedAt, segment));
}

export async function appendGapMarker(dir: string, startedAt: Date, fromMs: number, toMs: number, language: UiLanguage = 'pt-BR'): Promise<void> {
  const hm = (ms: number) => formatClock(new Date(startedAt.getTime() + ms)).slice(0, 5);
  await appendFile(join(dir, MEETING_FILES.transcript), `${t('marker.gap', { from: hm(fromMs), to: hm(toMs) }, language)}\n\n`);
}

/** Nome de uma "Pessoa N" da reunião (`meta.speakers`); nome vazio remove. Devolve os nomes atuais. */
export async function setSpeakerName(dir: string, id: number, name: string): Promise<Record<string, string>> {
  const meta = await updateMeta(dir, (m) => {
    const speakers = { ...(m.speakers ?? {}) };
    if (name) speakers[String(id)] = name;
    else delete speakers[String(id)];
    const { speakers: _old, ...rest } = m;
    return Object.keys(speakers).length > 0 ? { ...rest, speakers } : rest;
  });
  return meta.speakers ?? {};
}

export async function writeAnnotations(dir: string, text: string): Promise<void> {
  await writeAtomic(join(dir, MEETING_FILES.annotations), text);
}

export async function writeNotes(dir: string, markdown: string): Promise<void> {
  await writeAtomic(join(dir, MEETING_FILES.notes), markdown);
}

export async function appendChat(dir: string, at: Date, question: string, answer: string): Promise<void> {
  const block = `### [${formatClock(at)}] ${t('file.you')}\n${question.trim()}\n\n### Rice\n${answer.trim()}\n\n`;
  await appendFile(join(dir, MEETING_FILES.chat), block);
  const line = JSON.stringify({ at: toLocalIso(at), question, answer });
  await appendFile(join(dir, MEETING_FILES.chatLog), `${line}\n`);
}

export async function readChat(dir: string): Promise<ChatTurn[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, MEETING_FILES.chatLog), 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return [];
    throw err;
  }
  const turns: ChatTurn[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o.question === 'string' && typeof o.answer === 'string') turns.push({ question: o.question, answer: o.answer });
    } catch {
      // linha malformada: ignora
    }
  }
  return turns;
}

export async function readMeetingText(
  dir: string,
  file: 'transcript' | 'annotations' | 'chat' | 'notes',
): Promise<string> {
  try {
    return await readFile(join(dir, MEETING_FILES[file]), 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return '';
    throw err;
  }
}

export async function listMeetingDirs(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return [];
    throw err;
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    try {
      await stat(join(dir, MEETING_FILES.meta));
      dirs.push(dir);
    } catch (err) {
      if (!isErrno(err, 'ENOENT')) throw err;
    }
  }
  return dirs.sort();
}
