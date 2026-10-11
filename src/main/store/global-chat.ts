import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toLocalIso } from '../../shared/naming';

/** Reunião citada numa resposta (n é o número que a IA usa em [n]). */
export type Citation = { n: number; dir: string; title: string; date: string };

export type GlobalScope = { kind: 'all' } | { kind: 'folder'; folderId: string };

export type GlobalTurn = { at: string; question: string; answer: string; scope: GlobalScope; citations: Citation[]; terms: string[] };

export const globalChatFile = (root: string): string => join(root, '.rice', 'chat-global.jsonl');

const isCitation = (c: unknown): c is Citation => {
  const o = c as Record<string, unknown>;
  return typeof o?.n === 'number' && typeof o.dir === 'string' && typeof o.title === 'string' && typeof o.date === 'string';
};

function parseTurn(o: Record<string, unknown>): GlobalTurn | null {
  if (typeof o.question !== 'string' || typeof o.answer !== 'string') return null;
  const scope = o.scope as Record<string, unknown> | undefined;
  return {
    at: typeof o.at === 'string' ? o.at : '',
    question: o.question,
    answer: o.answer,
    scope: scope?.kind === 'folder' && typeof scope.folderId === 'string' ? { kind: 'folder', folderId: scope.folderId } : { kind: 'all' },
    citations: Array.isArray(o.citations) ? o.citations.filter(isCitation) : [],
    terms: Array.isArray(o.terms) ? o.terms.filter((x): x is string => typeof x === 'string') : [],
  };
}

async function readLines(root: string): Promise<Record<string, unknown>[]> {
  let raw: string;
  try {
    raw = await readFile(globalChatFile(root), 'utf8');
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as unknown;
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch {
      // linha malformada: ignora
    }
  }
  return out;
}

/** As trocas da conversa atual: tudo depois da última marca de "nova conversa" (o resto fica no arquivo). */
export async function readGlobalConversation(root: string): Promise<GlobalTurn[]> {
  const turns: GlobalTurn[] = [];
  for (const o of await readLines(root)) {
    if (o.type === 'new') turns.length = 0;
    else {
      const turn = parseTurn(o);
      if (turn) turns.push(turn);
    }
  }
  return turns;
}

async function append(root: string, record: unknown): Promise<void> {
  await mkdir(join(root, '.rice'), { recursive: true });
  await appendFile(globalChatFile(root), `${JSON.stringify(record)}\n`);
}

export async function appendGlobalTurn(root: string, turn: Omit<GlobalTurn, 'at'>, at: Date = new Date()): Promise<void> {
  await append(root, { type: 'turn', at: toLocalIso(at), ...turn });
}

/** "Nova conversa": a próxima pergunta começa do zero. Sem nada na conversa atual, não grava nada. */
export async function startNewGlobalConversation(root: string, at: Date = new Date()): Promise<void> {
  if ((await readGlobalConversation(root)).length === 0) return;
  await append(root, { type: 'new', at: toLocalIso(at) });
}
