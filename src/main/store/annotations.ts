import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatClock, toLocalIso } from '../../shared/naming';
import { MEETING_FILES, readMeetingText, writeAnnotations, writeAtomic } from './meeting-files';

/**
 * Uma linha digitada pelo usuário. `at` (horário local, como na transcrição) só existe quando a linha foi
 * escrita durante a gravação: é a âncora para a IA achar o trecho certo. O `anotacoes.md` continua sendo o texto puro.
 */
export type Annotation = { n: number; text: string; at?: string; clock?: string };

type Stored = { text: string; at?: string };

const linesOf = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);

async function readSidecar(dir: string): Promise<Stored[]> {
  try {
    const raw = JSON.parse(await readFile(join(dir, MEETING_FILES.annotationsLog), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((o): Stored[] => (o && typeof o.text === 'string' ? [{ text: o.text, ...(typeof o.at === 'string' ? { at: o.at } : {}) }] : []));
  } catch {
    return [];
  }
}

/**
 * Grava o texto e o horário de cada linha. Linhas que já existiam (iguais ou só editadas) mantêm o horário em que
 * nasceram; as novas recebem `now` se estiver gravando (`recording`), senão ficam sem horário.
 */
export async function saveAnnotations(dir: string, text: string, now: Date, recording: boolean): Promise<void> {
  const previous = await readSidecar(dir);
  const lines = linesOf(text);
  const free = [...previous];
  const slot: (Stored | undefined)[] = lines.map(() => undefined);
  lines.forEach((line, i) => {
    const k = free.findIndex((p) => p.text === line);
    if (k >= 0) slot[i] = free.splice(k, 1)[0];
  });
  lines.forEach((_, i) => {
    if (!slot[i] && free.length > 0) slot[i] = free.shift(); // linha editada: herda o horário da que ela era
  });
  const stored = lines.map((line, i): Stored => {
    const at = slot[i]?.at ?? (recording ? toLocalIso(now) : undefined);
    return { text: line, ...(at ? { at } : {}) };
  });
  await writeAnnotations(dir, text);
  await writeAtomic(join(dir, MEETING_FILES.annotationsLog), `${JSON.stringify(stored, null, 2)}\n`);
}

/** As anotações numeradas (a partir de 1) com o horário do sidecar, quando houver. */
export async function readAnnotations(dir: string): Promise<Annotation[]> {
  const lines = linesOf(await readMeetingText(dir, 'annotations'));
  const stored = await readSidecar(dir);
  const free = [...stored];
  return lines.map((text, i) => {
    const k = free.findIndex((p) => p.text === text);
    const hit = k >= 0 ? free.splice(k, 1)[0] : undefined;
    return { n: i + 1, text, ...(hit?.at ? { at: hit.at, clock: formatClock(new Date(hit.at)) } : {}) };
  });
}
