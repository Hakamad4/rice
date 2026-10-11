import { execFile } from 'node:child_process';
import { restrictMode } from '../platform/fs';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { t } from '../i18n';
import { writeAtomic } from '../store/meeting-files';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_TEXT_CHARS = 20_000;
const MAX_ALL_TEXT_CHARS = 60_000;
export const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'other';
export type Attachment = {
  file: string;
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind;
  addedAt: string;
  /** Posição na gravação (ms), se foi anexado gravando. */
  atMs?: number;
  /** Há texto extraído (sidecar em `anexos/.texto/`). */
  hasText?: boolean;
  /** PDF sem texto aproveitável ou sem `pdftotext` no sistema. */
  note?: 'pdf-unsupported';
};

export const attachmentsDir = (meetingDir: string) => join(meetingDir, 'anexos');
const indexPath = (meetingDir: string) => join(attachmentsDir(meetingDir), 'index.json');
const textPath = (meetingDir: string, file: string) => join(attachmentsDir(meetingDir), '.texto', `${file}.txt`);

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic' };
const TEXT_TYPES: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json', '.log': 'text/plain' };

export function kindOf(name: string): { kind: AttachmentKind; type: string } {
  const ext = extname(name).toLowerCase();
  if (IMAGE_TYPES[ext]) return { kind: 'image', type: IMAGE_TYPES[ext]! };
  if (ext === '.pdf') return { kind: 'pdf', type: 'application/pdf' };
  if (TEXT_TYPES[ext]) return { kind: 'text', type: TEXT_TYPES[ext]! };
  return { kind: 'other', type: 'application/octet-stream' };
}

/** Só o nome do arquivo, sem caminho nem caracteres que dão problema em disco; nunca vazio nem oculto. */
export function sanitizeName(raw: string): string {
  const base = basename(String(raw ?? '').replace(/\\/g, '/'));
  let clean = base.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  const ext = extname(clean);
  if (clean.length > 120) clean = clean.slice(0, 120 - ext.length) + ext;
  return clean || 'arquivo';
}

/** Sem sobrescrever: "foto.png" → "foto (2).png" → "foto (3).png". */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const chains = new Map<string, Promise<unknown>>();
/** Serializa as mudanças do index por reunião (vários arquivos soltos de uma vez). */
function serial<T>(meetingDir: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(meetingDir) ?? Promise.resolve()).catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  chains.set(meetingDir, tail);
  void tail.then(() => {
    if (chains.get(meetingDir) === tail) chains.delete(meetingDir);
  });
  return run;
}

export async function listAttachments(meetingDir: string): Promise<Attachment[]> {
  try {
    const raw = JSON.parse(await readFile(indexPath(meetingDir), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x): Attachment[] => {
      const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      if (typeof o.file !== 'string' || o.file !== basename(o.file) || o.file.startsWith('.')) return []; // o index nunca aponta para fora de anexos/
      const k = kindOf(o.file);
      return [{
        file: o.file,
        name: typeof o.name === 'string' ? o.name : o.file,
        size: Number(o.size) || 0,
        type: typeof o.type === 'string' ? o.type : k.type,
        kind: k.kind,
        addedAt: typeof o.addedAt === 'string' ? o.addedAt : '',
        ...(typeof o.atMs === 'number' ? { atMs: o.atMs } : {}),
        ...(o.hasText === true ? { hasText: true } : {}),
        ...(o.note === 'pdf-unsupported' ? { note: 'pdf-unsupported' as const } : {}),
      }];
    });
  } catch {
    return [];
  }
}

const saveIndex = (meetingDir: string, items: Attachment[]) => writeAtomic(indexPath(meetingDir), JSON.stringify(items, null, 2));

/** Texto de PDF via `pdftotext` do sistema, se existir (sem biblioteca nova no projeto). */
function pdfText(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('pdftotext', ['-layout', '-q', path, '-'], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

async function extract(path: string, kind: AttachmentKind, size: number): Promise<{ text: string | null; note?: 'pdf-unsupported' }> {
  if (kind === 'text') return size > MAX_TEXT_FILE_BYTES ? { text: null } : { text: (await readFile(path, 'utf8')).replace(/\u0000/g, '') };
  if (kind === 'pdf') {
    const text = await pdfText(path);
    return text && text.trim().length > 20 ? { text } : { text: null, note: 'pdf-unsupported' };
  }
  return { text: null };
}

export type AddOptions = { atMs?: number; now?: () => Date };

async function register(meetingDir: string, finalName: string, displayName: string, size: number, options: AddOptions): Promise<Attachment> {
  const { kind, type } = kindOf(finalName);
  const path = join(attachmentsDir(meetingDir), finalName);
  const got = await extract(path, kind, size).catch(() => ({ text: null as string | null }));
  if (got.text) {
    await mkdir(join(attachmentsDir(meetingDir), '.texto'), { recursive: true });
    await writeFile(textPath(meetingDir, finalName), got.text.slice(0, 500_000), { mode: 0o600 });
  }
  const item: Attachment = {
    file: finalName, name: displayName, size, type, kind, addedAt: (options.now?.() ?? new Date()).toISOString(),
    ...(typeof options.atMs === 'number' ? { atMs: options.atMs } : {}),
    ...(got.text ? { hasText: true } : {}),
    ...('note' in got && got.note ? { note: got.note } : {}),
  };
  const items = await listAttachments(meetingDir);
  await saveIndex(meetingDir, [...items, item]);
  return item;
}

function checkRoom(items: Attachment[], size: number): void {
  if (size > MAX_FILE_BYTES) throw new Error(t('attach.err.too-big', { mb: String(MAX_FILE_BYTES / 1024 / 1024) }));
  if (items.reduce((n, a) => n + a.size, 0) + size > MAX_TOTAL_BYTES) throw new Error(t('attach.err.total', { mb: String(MAX_TOTAL_BYTES / 1024 / 1024) }));
}

/** Copia um arquivo escolhido pelo usuário para `anexos/` (links simbólicos e pastas são recusados; nunca sobrescreve). */
export function addFromPath(meetingDir: string, srcPath: string, options: AddOptions = {}): Promise<Attachment> {
  return serial(meetingDir, async () => {
    if (typeof srcPath !== 'string' || !srcPath.startsWith('/')) throw new Error(t('attach.err.invalid'));
    const st = await lstat(srcPath).catch(() => null);
    if (!st || st.isSymbolicLink() || !st.isFile()) throw new Error(t('attach.err.not-file'));
    const items = await listAttachments(meetingDir);
    checkRoom(items, st.size);
    await mkdir(attachmentsDir(meetingDir), { recursive: true, mode: 0o700 });
    const name = uniqueName(sanitizeName(basename(srcPath)), new Set(items.map((a) => a.file)));
    const dest = join(attachmentsDir(meetingDir), name);
    await copyFile(srcPath, dest, constants.COPYFILE_EXCL);
    await restrictMode(dest, 0o600);
    return register(meetingDir, name, basename(srcPath), st.size, options);
  });
}

/** Bytes vindos da página (imagem colada): o renderer nunca escreve no disco, quem grava é o main. */
export function addFromData(meetingDir: string, rawName: string, data: Buffer, options: AddOptions = {}): Promise<Attachment> {
  return serial(meetingDir, async () => {
    const items = await listAttachments(meetingDir);
    checkRoom(items, data.length);
    await mkdir(attachmentsDir(meetingDir), { recursive: true, mode: 0o700 });
    const name = uniqueName(sanitizeName(rawName), new Set(items.map((a) => a.file)));
    await writeFile(join(attachmentsDir(meetingDir), name), data, { mode: 0o600, flag: 'wx' });
    return register(meetingDir, name, sanitizeName(rawName), data.length, options);
  });
}

/** Remove do index e manda o arquivo para a Lixeira (`trash` injetável). */
export function removeAttachment(meetingDir: string, file: string, trash: (path: string) => Promise<void>): Promise<void> {
  return serial(meetingDir, async () => {
    const items = await listAttachments(meetingDir);
    const item = items.find((a) => a.file === file);
    if (!item) throw new Error(t('attach.err.missing'));
    await trash(join(attachmentsDir(meetingDir), item.file)).catch(() => undefined);
    await rm(textPath(meetingDir, item.file), { force: true });
    await saveIndex(meetingDir, items.filter((a) => a.file !== file));
  });
}

/** Caminho absoluto de um anexo do index (nunca de fora de `anexos/`). */
export async function attachmentPath(meetingDir: string, file: string): Promise<string> {
  const item = (await listAttachments(meetingDir)).find((a) => a.file === file);
  if (!item) throw new Error(t('attach.err.missing'));
  return join(attachmentsDir(meetingDir), item.file);
}

async function sidecar(meetingDir: string, file: string): Promise<string> {
  try {
    return await readFile(textPath(meetingDir, file), 'utf8');
  } catch {
    return '';
  }
}

/** Texto extraído dos anexos como "Material anexado" (conteúdo de terceiros): limite por arquivo e total. */
export async function attachmentsContext(meetingDir: string): Promise<string> {
  const parts: string[] = [];
  let used = 0;
  for (const a of await listAttachments(meetingDir)) {
    if (!a.hasText || used >= MAX_ALL_TEXT_CHARS) continue;
    const text = (await sidecar(meetingDir, a.file)).replace(/<\/?material_anexado[^>]*>/gi, '').trim().slice(0, Math.min(MAX_FILE_TEXT_CHARS, MAX_ALL_TEXT_CHARS - used));
    if (!text) continue;
    used += text.length;
    parts.push(`### ${a.name.replace(/[\r\n]+/g, ' ')}\n${text}`);
  }
  return parts.join('\n\n');
}

/** Texto para a busca: nomes e conteúdo extraído. */
export async function attachmentsSearchText(meetingDir: string): Promise<string> {
  const items = await listAttachments(meetingDir);
  const texts = await Promise.all(items.map(async (a) => `${a.name}\n${a.hasText ? (await sidecar(meetingDir, a.file)).slice(0, 100_000) : ''}`));
  return texts.join('\n');
}

/** Imagens (png/jpeg/webp/gif) em base64 para as APIs que aceitam; poucas e pequenas. */
export async function attachmentImages(meetingDir: string): Promise<Array<{ mime: string; data: string }>> {
  const images = (await listAttachments(meetingDir)).filter((a) => a.kind === 'image' && a.type !== 'image/heic' && a.size <= MAX_IMAGE_BYTES).slice(-MAX_IMAGES);
  const out: Array<{ mime: string; data: string }> = [];
  for (const a of images) {
    try {
      out.push({ mime: a.type, data: (await readFile(join(attachmentsDir(meetingDir), a.file))).toString('base64') });
    } catch {
      // arquivo sumiu: ignora
    }
  }
  return out;
}
