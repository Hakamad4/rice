import { randomUUID } from 'node:crypto';
import { readFile, rename, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { toLocalIso } from '../../shared/naming';
import type { MeetingMeta } from '../../shared/types';
import { MEETING_FILES, readMeetingText, writeMeta } from './meeting-files';

/** `2026-10-08 1400 - Daily (2)` → data/hora e título (sem o sufixo de duplicata). */
export function parseFolderName(name: string): { startedAt: Date | null; title: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2}) - (.+?)(?: \(\d+\))?$/.exec(name);
  if (!m) return { startedAt: null, title: name };
  const startedAt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return { startedAt: Number.isNaN(startedAt.getTime()) ? null : startedAt, title: m[6]! };
}

/** O meta lido é utilizável? (JSON válido não basta: faltando campo básico a UI quebraria.) */
export function isUsableMeta(value: unknown): value is MeetingMeta {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.title === 'string' && typeof m.startedAt === 'string' && !Number.isNaN(Date.parse(m.startedAt)) && typeof m.state === 'string' && Array.isArray(m.gaps);
}

/** Lê o meta sem lançar: `null` se o arquivo sumiu, está truncado, vazio ou sem os campos básicos. */
export async function readMetaIfUsable(dir: string): Promise<MeetingMeta | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, MEETING_FILES.meta), 'utf8')) as unknown;
    return isUsableMeta(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Entrada de lista para uma reunião cujo meta não dá para ler: título e data vêm do nome da pasta. */
export async function damagedEntry(dir: string): Promise<MeetingMeta & { dir: string }> {
  const { startedAt, title } = parseFolderName(basename(dir));
  const when = startedAt ?? new Date((await stat(dir)).mtimeMs);
  return { dir, id: `damaged:${basename(dir)}`, title, startedAt: toLocalIso(when), state: 'damaged', trigger: 'manual', notesStatus: 'failed', gaps: [] };
}

/**
 * R-52: reconstrói o meta básico (título, início, estado) a partir da pasta e do que existe nela. O arquivo ruim vai para
 * `meta.json.corrompido` (nada é apagado). O estado vira `interrupted` quando não há áudio fechado nem notas (dá para
 * "Recuperar reunião"), senão `done`.
 */
export async function repairMeta(dir: string): Promise<MeetingMeta> {
  const entry = await damagedEntry(dir);
  const notes = (await readMeetingText(dir, 'notes')).trim() !== '';
  const transcript = (await readMeetingText(dir, 'transcript')).includes('**[');
  const hasM4a = await stat(join(dir, MEETING_FILES.audio)).then(() => true, () => false);
  const meta: MeetingMeta = {
    id: randomUUID(),
    title: entry.title,
    startedAt: entry.startedAt,
    state: notes || hasM4a ? 'done' : 'interrupted',
    trigger: 'manual',
    notesStatus: notes ? 'done' : transcript ? 'failed' : 'pending',
    gaps: [],
  };
  await rename(join(dir, MEETING_FILES.meta), join(dir, `${MEETING_FILES.meta}.corrompido`)).catch(() => {});
  await writeMeta(dir, meta);
  return meta;
}
