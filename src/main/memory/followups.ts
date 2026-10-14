import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEETING_FILES, readMeetingText, writeAtomic, writeNotes } from '../store/meeting-files';
import { daysUntil, isoDate, parseDue } from './due';
import { isMe, normName, SELF } from './identity';
import { memoryDir, type MemoryStore } from './store';
import { isFollowup, type Fact } from './types';

export type Group = 'overdue' | 'today' | 'week' | 'later' | 'nodue' | 'done';
export const GROUPS: readonly Group[] = ['overdue', 'today', 'week', 'later', 'nodue', 'done'];
export type Filter = 'mine' | 'others' | 'all';

/** Em qual grupo da página a pendência cai. "Esta semana" = os próximos 7 dias; mais longe, "Depois". */
export function groupOf(f: Fact, now: Date): Group {
  if (f.status === 'done') return 'done';
  if (!f.due) return 'nodue';
  const d = daysUntil(f.due, now);
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later';
}

export function listFollowups(store: MemoryStore, filter: Filter, now: Date): Record<Group, Fact[]> {
  const out = Object.fromEntries(GROUPS.map((g) => [g, [] as Fact[]])) as Record<Group, Fact[]>;
  for (const f of store.all()) {
    if (!isFollowup(f)) continue;
    if (filter === 'mine' && !f.mine) continue;
    if (filter === 'others' && f.mine) continue;
    out[groupOf(f, now)].push(f);
  }
  const byDue = (a: Fact, b: Fact) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.updatedAt.localeCompare(a.updatedAt);
  for (const g of GROUPS) out[g].sort(g === 'done' ? (a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') : byDue);
  return out;
}

/** Minhas pendências vencidas (o contador da barra lateral). */
export function overdueMine(store: MemoryStore, now: Date): number {
  return store.all().filter((f) => isFollowup(f) && f.status === 'open' && f.mine && f.due !== undefined && daysUntil(f.due, now) < 0).length;
}

export type ManualInput = { text: string; due?: unknown; dir?: string; title?: string; date?: string; who?: string; mine?: boolean };

export async function addManual(store: MemoryStore, input: ManualInput, now: Date): Promise<Fact | null> {
  const text = String(input.text ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (text.length < 2) return null;
  const mine = input.mine !== false;
  const due = parseDue(input.due, now);
  const f: Fact = {
    id: store.newId(), kind: 'commitment', who: mine ? SELF : String(input.who ?? '').replace(/[<>\n]/g, ' ').trim().slice(0, 80) || SELF, about: '', text, ...(due ? { due } : {}), confidence: 1,
    source: input.dir ? { dir: input.dir, title: input.title ?? '', date: input.date ?? now.toISOString() } : { dir: '', title: '', date: now.toISOString() }, status: 'open', updatedAt: now.toISOString(), mine, manual: true,
  };
  await store.put(f);
  return f;
}

// ---- sincronia com as notas (`- [ ]` em "Próximas ações") ----
const TASK = /^(\s*[-*]\s+)\[([ xX])\](\s+)(.*)$/;
const NOISE = new Set(('para com uma que dos das nos nas por mais como mas foi sao tem ser ela ele isso esta este esse essa sobre entre the and for with from that this will have has was were are um de do da em no na se ao os as ou e a o').split(' '));

/** Texto de uma tarefa sem marcação, responsável no fim ("— Carlos") nem acento: só as palavras que contam. */
export function taskWords(text: string): string[] {
  const clean = text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/[*_`]/g, ' ').replace(/\s[—–-]\s[^—–-]{1,40}$/, ' ');
  return [...new Set(normName(clean).split(' ').filter((w) => w.length >= 3 && !NOISE.has(w)).map((w) => (w.length >= 5 ? w.slice(0, 4) : w)))]; // radical de 4 letras: monta/montar, envio/enviar, conduz/conduzir
}

/** Parecidas o bastante para serem a mesma coisa: 2+ palavras em comum e 70% das da menor. */
export function similar(a: string, b: string): boolean {
  const A = taskWords(a);
  const B = taskWords(b);
  if (A.length === 0 || B.length === 0) return false;
  const shared = A.filter((w) => B.includes(w)).length;
  return shared >= Math.min(2, A.length, B.length) && shared / Math.min(A.length, B.length) >= 0.7;
}

/** Marca/desmarca, nas notas, a tarefa que corresponde ao texto. Devolve o texto novo e se mudou. */
export function toggleTaskLine(notes: string, factText: string, done: boolean): { text: string; changed: boolean } {
  const lines = notes.split('\n');
  let best = -1;
  let bestShared = 0;
  lines.forEach((line, i) => {
    const m = TASK.exec(line);
    if (!m || !similar(m[4]!, factText)) return;
    const shared = taskWords(m[4]!).filter((w) => taskWords(factText).includes(w)).length;
    if (shared > bestShared) {
      best = i;
      bestShared = shared;
    }
  });
  if (best < 0) return { text: notes, changed: false };
  const m = TASK.exec(lines[best]!)!;
  const was = m[2] !== ' ';
  if (was === done) return { text: notes, changed: false };
  lines[best] = `${m[1]}[${done ? 'x' : ' '}]${m[3]}${m[4]}`;
  return { text: lines.join('\n'), changed: true };
}

/** Pendência marcada/desmarcada na página: reflete nas notas da reunião de origem. Sem correspondência, não mexe em nada. */
export async function syncToNotes(fact: Fact, done: boolean): Promise<boolean> {
  if (!fact.source.dir) return false;
  try {
    const notes = await readMeetingText(fact.source.dir, 'notes');
    if (!notes) return false;
    const r = toggleTaskLine(notes, fact.text, done);
    if (!r.changed) return false;
    await writeNotes(fact.source.dir, r.text);
    return true;
  } catch {
    return false;
  }
}

/** Notas editadas (o usuário marcou um `- [x]`): o que mudou para as pendências daquela reunião. */
export function diffFromNotes(notes: string, facts: readonly Fact[]): Array<{ id: string; done: boolean }> {
  const tasks = notes.split('\n').flatMap((l) => {
    const m = TASK.exec(l);
    return m ? [{ text: m[4]!, done: m[2] !== ' ' }] : [];
  });
  const out: Array<{ id: string; done: boolean }> = [];
  for (const f of facts) {
    if (!isFollowup(f)) continue;
    const t = tasks.filter((x) => similar(x.text, f.text)).sort((a, b) => taskWords(b.text).filter((w) => taskWords(f.text).includes(w)).length - taskWords(a.text).filter((w) => taskWords(f.text).includes(w)).length)[0];
    if (!t) continue;
    if (t.done && f.status === 'open') out.push({ id: f.id, done: true });
    // reabrir só o que foi fechado à mão/por estas notas; o que uma reunião seguinte fechou fica como está
    else if (!t.done && f.status === 'done' && (!f.doneBy || 'manual' in f.doneBy)) out.push({ id: f.id, done: false });
  }
  return out;
}

export async function setDone(store: MemoryStore, id: string, done: boolean, now: Date, opts: { syncNotes?: boolean } = {}): Promise<Fact | null> {
  const f = store.get(id);
  if (!f || !isFollowup(f)) return null;
  const stamp = now.toISOString();
  let next: Fact;
  if (done) next = { ...f, status: 'done', doneBy: { manual: true }, doneAt: stamp, updatedAt: stamp };
  else {
    const { doneBy: _b, doneAt: _a, ...rest } = f;
    next = { ...rest, status: 'open', updatedAt: stamp };
  }
  await store.put(next);
  if (opts.syncNotes !== false) await syncToNotes(next, done);
  return next;
}

export async function setDue(store: MemoryStore, id: string, due: unknown, now: Date): Promise<Fact | null> {
  const f = store.get(id);
  if (!f || !isFollowup(f)) return null;
  const parsed = due === null || due === '' ? null : parseDue(due, now);
  if (due !== null && due !== '' && !parsed) return null;
  const { due: _old, ...rest } = f;
  const next: Fact = { ...rest, ...(parsed ? { due: parsed } : {}), updatedAt: now.toISOString() };
  await store.put(next);
  return next;
}

// ---- cobrança ----
export type NotifyState = { notified: Record<string, string> };
const statePath = (root: string) => join(memoryDir(root), 'followups-state.json');

export async function readNotifyState(root: string): Promise<NotifyState> {
  try {
    const o = JSON.parse(await readFile(statePath(root), 'utf8')) as Partial<NotifyState>;
    return { notified: typeof o.notified === 'object' && o.notified !== null ? (o.notified as Record<string, string>) : {} };
  } catch {
    return { notified: {} };
  }
}

export async function writeNotifyState(root: string, state: NotifyState): Promise<void> {
  await mkdir(memoryDir(root), { recursive: true, mode: 0o700 });
  await writeAtomic(statePath(root), JSON.stringify(state));
}

export type NotifyPlan = { ids: string[]; allToday: boolean; first: Fact };

/**
 * O que avisar agora: minhas pendências abertas que vencem hoje (ou já venceram sem aviso), uma vez cada, a partir das 9h.
 * Antes das 9h, ou sem nada novo: null. Quem chama grava `state.notified[id] = hoje` depois de mostrar.
 */
export function planNotifications(store: MemoryStore, state: NotifyState, now: Date, hour = 9): NotifyPlan | null {
  if (now.getHours() < hour) return null;
  const due = store.all().filter((f) => isFollowup(f) && f.mine && f.status === 'open' && f.due !== undefined && daysUntil(f.due, now) <= 0 && state.notified[f.id] === undefined).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  if (due.length === 0) return null;
  return { ids: due.map((f) => f.id), allToday: due.every((f) => f.due === isoDate(now)), first: due[0]! };
}

// ---- Lembretes do macOS (opcional, a pedido do usuário) ----
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');

/** AppleScript que cria os lembretes na lista padrão do app Lembretes. Só texto e prazo; nada de e-mail ou caminho. */
export function remindersScript(items: ReadonlyArray<{ title: string; due?: string }>): string {
  const lines = items.map((it) => {
    const m = it.due ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.due) : null;
    const props = `name:"${esc(it.title.slice(0, 200))}"`;
    if (!m) return `  make new reminder with properties {${props}}`;
    return `  set d to current date\n  set year of d to ${Number(m[1])}\n  set month of d to 1\n  set day of d to ${Number(m[3])}\n  set month of d to ${Number(m[2])}\n  set time of d to 9 * hours\n  make new reminder with properties {${props}, due date:d}`;
  });
  return `tell application "Reminders"\n${lines.join('\n')}\nend tell`;
}

export type Runner = (file: string, args: string[], opts: { timeout: number }) => Promise<void>;
const defaultRun: Runner = (file, args, opts) => new Promise((resolve, reject) => execFile(file, args, opts, (err) => (err ? reject(err) : resolve())));

export async function sendToReminders(items: ReadonlyArray<{ title: string; due?: string }>, run: Runner = defaultRun): Promise<boolean> {
  if (items.length === 0) return false;
  try {
    await run('osascript', ['-e', remindersScript(items.slice(0, 50))], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

export { isMe, MEETING_FILES };
