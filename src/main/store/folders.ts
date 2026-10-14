import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isInsideRoot } from '../app/paths';
import type { Folder, FolderRetention } from '../../shared/types';
import { t } from '../i18n';
import { listMeetingDirs, readMeta, updateMeta, writeAtomic } from './meeting-files';

const MAX_NAME = 60;
/** Níveis de pastas: a pasta da raiz é o nível 1. */
export const MAX_DEPTH = 4;

const childrenOf = (folders: Folder[], parentId: string | undefined): Folder[] => folders.filter((f) => f.parentId === parentId);

/** Quantos níveis há de `id` até a raiz (a pasta da raiz = 1). */
export function depthOf(folders: Folder[], id: string): number {
  let depth = 0;
  for (let cur: Folder | undefined = folders.find((f) => f.id === id); cur && depth <= folders.length; cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined) depth++;
  return depth;
}

/** Níveis da subárvore que começa em `id` (uma pasta sem filhas = 1). */
export function heightOf(folders: Folder[], id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  return 1 + Math.max(0, ...childrenOf(folders, id).map((c) => heightOf(folders, c.id, seen)));
}

/** `id` e todas as pastas dentro dele. */
export function descendantIds(folders: Folder[], id: string): string[] {
  const out: string[] = [];
  const walk = (cur: string) => {
    for (const child of childrenOf(folders, cur)) if (!out.includes(child.id)) (out.push(child.id), walk(child.id));
  };
  walk(id);
  return out;
}

/** Caminho legível: "Clientes / Acme". */
export function folderPaths(folders: Folder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const f of folders) {
    const names: string[] = [];
    for (let cur: Folder | undefined = f; cur && names.length <= MAX_DEPTH; cur = cur.parentId ? byId.get(cur.parentId) : undefined) names.unshift(cur.name);
    paths.set(f.id, names.join(' / '));
  }
  return paths;
}

/** Arquivo editado à mão ou antigo: pai que não existe, ciclo ou nível demais viram pasta da raiz (nunca perde pasta). */
function sanitizeTree(folders: Folder[]): Folder[] {
  const ids = new Set(folders.map((f) => f.id));
  const fixed = folders.map((f) => (f.parentId && !ids.has(f.parentId) ? withoutParent(f) : f));
  return fixed.map((f) => {
    if (!f.parentId) return f;
    const seen = new Set([f.id]);
    let cur: Folder | undefined = f;
    let depth = 1;
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) return withoutParent(f);
      seen.add(cur.parentId);
      cur = fixed.find((x) => x.id === cur!.parentId);
      depth++;
    }
    return depth > MAX_DEPTH ? withoutParent(f) : f;
  });
}

function withoutParent(f: Folder): Folder {
  const { parentId: _gone, ...rest } = f;
  return rest;
}

const AUDIO_DAYS = [0, 7, 30, 90];
const MEETING_MONTHS = [0, 6, 12];
/** Regra de guarda lida com tolerância: só os valores oferecidos na tela; qualquer outra coisa é ignorada. */
export function parseRetention(raw: unknown): FolderRetention | undefined {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const audioDays = AUDIO_DAYS.includes(o.audioDays as number) ? (o.audioDays as FolderRetention['audioDays']) : undefined;
  const meetingMonths = MEETING_MONTHS.includes(o.meetingMonths as number) ? (o.meetingMonths as FolderRetention['meetingMonths']) : undefined;
  return audioDays === undefined && meetingMonths === undefined ? undefined : { ...(audioDays !== undefined ? { audioDays } : {}), ...(meetingMonths !== undefined ? { meetingMonths } : {}) };
}

export const foldersFile = (root: string): string => join(root, '.rice', 'folders.json');

/** Pastas, da primeira à última. Arquivo ausente ou ilegível = nenhuma pasta (nunca lança por conteúdo). */
export async function readFolders(root: string): Promise<Folder[]> {
  try {
    const raw = JSON.parse(await readFile(foldersFile(root), 'utf8')) as { folders?: unknown };
    if (!Array.isArray(raw.folders)) return [];
    const folders: Folder[] = [];
    for (const f of raw.folders) {
      const o = f as Record<string, unknown>;
      if (typeof o?.id === 'string' && typeof o.name === 'string') {
        folders.push({
          id: o.id,
          name: o.name,
          createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
          order: typeof o.order === 'number' ? o.order : folders.length,
          ...(typeof o.parentId === 'string' && o.parentId ? { parentId: o.parentId } : {}),
          ...(o.sensitive === true ? { sensitive: true } : {}),
          ...(parseRetention(o.retention) ? { retention: parseRetention(o.retention)! } : {}),
        });
      }
    }
    return sanitizeTree(folders).sort((a, b) => a.order - b.order);
  } catch {
    return [];
  }
}

const queues = new Map<string, Promise<unknown>>();

/** Read-modify-write de folders.json: relê do disco e serializa por arquivo (como o `updateMeta`), com escrita atômica. */
async function mutate<T>(root: string, change: (folders: Folder[]) => { folders: Folder[]; result: T }): Promise<T> {
  const path = foldersFile(root);
  const run = (queues.get(path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const { folders, result } = change(await readFolders(root));
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, `${JSON.stringify({ folders }, null, 2)}\n`);
    return result;
  });
  const tail = run.catch(() => undefined);
  queues.set(path, tail);
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path);
  });
  return run;
}

/** Nome normalizado (espaços colapsados). Vazio, longo demais ou repetido entre as irmãs (sem diferenciar maiúsculas) dá erro já traduzido. */
function checkName(raw: unknown, others: Folder[]): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error(t('folder.err.empty'));
  if (name.length > MAX_NAME) throw new Error(t('folder.err.too-long', { max: MAX_NAME }));
  if (others.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new Error(t('folder.err.duplicate'));
  return name;
}

export async function createFolder(root: string, rawName: unknown, parentId?: unknown, now: () => Date = () => new Date()): Promise<Folder> {
  return mutate(root, (folders) => {
    const parent = typeof parentId === 'string' && parentId ? parentId : undefined;
    if (parent) {
      if (!folders.some((f) => f.id === parent)) throw new Error(t('folder.err.not-found'));
      if (depthOf(folders, parent) + 1 > MAX_DEPTH) throw new Error(t('folder.err.depth', { max: MAX_DEPTH }));
    }
    const siblings = childrenOf(folders, parent);
    const folder: Folder = {
      id: randomUUID(),
      name: checkName(rawName, siblings),
      createdAt: now().toISOString(),
      order: siblings.reduce((m, f) => Math.max(m, f.order), -1) + 1,
      ...(parent ? { parentId: parent } : {}),
    };
    return { folders: [...folders, folder], result: folder };
  });
}

export async function renameFolder(root: string, id: string, rawName: unknown): Promise<Folder> {
  return mutate(root, (folders) => {
    const found = folders.find((f) => f.id === id);
    if (!found) throw new Error(t('folder.err.not-found'));
    const renamed = { ...found, name: checkName(rawName, childrenOf(folders, found.parentId).filter((f) => f.id !== id)) };
    return { folders: folders.map((f) => (f.id === id ? renamed : f)), result: renamed };
  });
}

/** Reordena entre irmãs: `ids` precisa ser exatamente o conjunto de pastas que têm a mesma pasta-mãe, na nova ordem. */
export async function reorderFolders(root: string, ids: unknown): Promise<Folder[]> {
  return mutate(root, (folders) => {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    const first = folders.find((f) => f.id === list[0]);
    const siblings = first ? childrenOf(folders, first.parentId) : [];
    const known = new Set(siblings.map((f) => f.id));
    if (!first || list.length !== siblings.length || new Set(list).size !== list.length || !list.every((id) => known.has(id))) throw new Error(t('folder.err.reorder'));
    const order = new Map(list.map((id, i) => [id, i]));
    const next = folders.map((f) => (order.has(f.id) ? { ...f, order: order.get(f.id)! } : f));
    return { folders: next, result: next };
  });
}

/** Move a pasta para dentro de outra (ou para a raiz, com `null`), no fim das irmãs. Recusa ciclo, nível demais e nome repetido entre as novas irmãs. */
export async function moveFolder(root: string, id: string, parentId: unknown): Promise<Folder> {
  return mutate(root, (folders) => {
    const found = folders.find((f) => f.id === id);
    if (!found) throw new Error(t('folder.err.not-found'));
    const parent = typeof parentId === 'string' && parentId ? parentId : undefined;
    if (parentId !== null && parentId !== undefined && !parent) throw new Error(t('folder.err.not-found'));
    if (parent) {
      if (!folders.some((f) => f.id === parent)) throw new Error(t('folder.err.not-found'));
      if (parent === id || descendantIds(folders, id).includes(parent)) throw new Error(t('folder.err.cycle'));
      if (depthOf(folders, parent) + heightOf(folders, id) > MAX_DEPTH) throw new Error(t('folder.err.depth', { max: MAX_DEPTH }));
    }
    if (found.parentId === parent) return { folders, result: found };
    const siblings = childrenOf(folders, parent);
    checkName(found.name, siblings);
    const { parentId: _old, ...rest } = found;
    const moved: Folder = { ...rest, order: siblings.reduce((m, f) => Math.max(m, f.order), -1) + 1, ...(parent ? { parentId: parent } : {}) };
    return { folders: folders.map((f) => (f.id === id ? moved : f)), result: moved };
  });
}

/** "Pasta sensível" e regras de guarda de uma pasta. `retention: null` volta a herdar tudo; `sensitive: false` desliga (as subpastas continuam herdando da mãe). */
export async function setFolderPrivacy(root: string, id: string, patch: { sensitive?: unknown; retention?: unknown }): Promise<Folder> {
  return mutate(root, (folders) => {
    const found = folders.find((f) => f.id === id);
    if (!found) throw new Error(t('folder.err.not-found'));
    const { sensitive: _s, retention: _r, ...base } = found;
    const sensitive = patch.sensitive === undefined ? found.sensitive === true : patch.sensitive === true;
    const retention = patch.retention === undefined ? found.retention : patch.retention === null ? undefined : parseRetention(patch.retention);
    const next: Folder = { ...base, ...(sensitive ? { sensitive: true } : {}), ...(retention ? { retention } : {}) };
    return { folders: folders.map((f) => (f.id === id ? next : f)), result: next };
  });
}

export async function folderExists(root: string, id: string): Promise<boolean> {
  return (await readFolders(root)).some((f) => f.id === id);
}

/** Nome livre entre as irmãs: "Acme" → "Acme (2)". */
function freeName(name: string, siblings: Folder[]): string {
  const taken = new Set(siblings.map((f) => f.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`.slice(-MAX_NAME);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Apaga a pasta. As subpastas e as reuniões dela sobem para a pasta-mãe (ou para a raiz / "sem pasta"); nenhuma reunião é apagada
 * e as pastas físicas não se movem. Subpasta com nome igual ao de uma irmã nova ganha " (2)".
 */
export async function deleteFolder(root: string, id: string): Promise<void> {
  let parentId: string | undefined;
  await mutate(root, (folders) => {
    const gone = folders.find((f) => f.id === id);
    if (!gone) throw new Error(t('folder.err.not-found'));
    parentId = gone.parentId;
    const rest = folders.filter((f) => f.id !== id);
    const siblings = childrenOf(rest, gone.parentId);
    // no lugar da pasta apagada entram as filhas, na ordem delas
    const sequence = [...siblings.filter((f) => f.order < gone.order), ...childrenOf(rest, id).sort((a, b) => a.order - b.order), ...siblings.filter((f) => f.order >= gone.order)];
    const placed = new Map<string, { name: string; order: number }>();
    const used: Folder[] = [...siblings]; // as irmãs que já existem + as filhas que vão subindo
    sequence.forEach((f, order) => {
      const name = f.parentId === id ? freeName(f.name, used) : f.name;
      placed.set(f.id, { name, order });
      used.push({ ...f, name });
    });
    const next = rest.map((f) => {
      const p = placed.get(f.id);
      if (!p) return f;
      const { parentId: _old, ...base } = f;
      return { ...base, ...p, ...(gone.parentId ? { parentId: gone.parentId } : {}) };
    });
    return { folders: next, result: undefined };
  });
  for (const dir of await listMeetingDirs(root)) {
    const meta = await readMeta(dir).catch(() => null);
    if (meta?.folderId !== id) continue;
    await updateMeta(dir, ({ folderId: _gone, ...rest }) => ({ ...rest, ...(parentId ? { folderId: parentId } : {}) }));
  }
}

/** Põe a reunião numa pasta (ou tira, com `null`). Valida o `dir` contra a raiz e o id contra a lista. */
export async function setMeetingFolder(root: string, rawDir: unknown, folderId: unknown): Promise<void> {
  const dir = resolve(String(rawDir ?? ''));
  if (!rawDir || dir === resolve(root) || !isInsideRoot(root, dir)) throw new Error(t('err.outside-root'));
  if (folderId !== null && (typeof folderId !== 'string' || !(await folderExists(root, folderId)))) throw new Error(t('folder.err.not-found'));
  await updateMeta(dir, ({ folderId: _old, ...meta }) => ({ ...meta, ...(typeof folderId === 'string' ? { folderId } : {}) }));
}
