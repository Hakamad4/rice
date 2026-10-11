import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MEETING_FILES, readMeetingText, readMeta, updateMeta, writeAtomic, writeNotes } from './meeting-files';

/** Uma versão antiga das notas: o arquivo fica em `<reunião>/notas-versoes/` e `notas.md` continua sendo a atual. */
export type NotesVersion = { file: string; templateId: string; templateName: string; createdAt: string; model?: string };

export const VERSIONS_DIR = 'notas-versoes';
export const MAX_VERSIONS = 20;
const INDEX = 'index.json';
const LEGACY_TEMPLATE = 'anterior';

const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60) || 'sem-template';
const fileName = (createdAt: string, templateId: string): string => `${createdAt.replace(/[:]/g, '-')}-${safeId(templateId)}.md`;

async function readIndex(dir: string): Promise<NotesVersion[]> {
  try {
    const raw = JSON.parse(await readFile(join(dir, VERSIONS_DIR, INDEX), 'utf8'));
    return Array.isArray(raw) ? raw.filter((v): v is NotesVersion => typeof v?.file === 'string' && typeof v?.createdAt === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(dir: string, versions: NotesVersion[]): Promise<void> {
  await mkdir(join(dir, VERSIONS_DIR), { recursive: true });
  await writeAtomic(join(dir, VERSIONS_DIR, INDEX), `${JSON.stringify(versions, null, 2)}\n`);
}

/** Mais nova primeiro; passa de `MAX_VERSIONS` apaga as mais antigas (arquivo e entrada). */
async function save(dir: string, versions: NotesVersion[]): Promise<NotesVersion[]> {
  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of sorted.slice(MAX_VERSIONS)) await rm(join(dir, VERSIONS_DIR, old.file), { force: true });
  const kept = sorted.slice(0, MAX_VERSIONS);
  await writeIndex(dir, kept);
  return kept;
}

/** O `notas-anterior.md` de antes do histórico vira uma versão (uma vez; o arquivo antigo sai da pasta). */
async function migrateLegacy(dir: string): Promise<void> {
  const legacy = join(dir, MEETING_FILES.previousNotes);
  let info;
  try {
    info = await stat(legacy);
  } catch {
    return;
  }
  const content = await readFile(legacy, 'utf8');
  if (content.trim()) await archiveNotes(dir, { content, templateId: LEGACY_TEMPLATE, templateName: '', createdAt: info.mtime.toISOString() });
  await rm(legacy, { force: true });
}

/** Guarda `content` como uma versão. Ignora texto vazio e o que já é idêntico à versão mais recente. */
export async function archiveNotes(dir: string, input: { content: string; templateId: string; templateName: string; createdAt?: string; model?: string }): Promise<void> {
  if (!input.content.trim()) return;
  const versions = await readIndex(dir);
  const latest = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest && (await readFile(join(dir, VERSIONS_DIR, latest.file), 'utf8').catch(() => null)) === input.content) return;
  const createdAt = input.createdAt ?? new Date().toISOString();
  let file = fileName(createdAt, input.templateId);
  for (let n = 2; versions.some((v) => v.file === file); n++) file = fileName(createdAt, `${input.templateId}-${n}`);
  await mkdir(join(dir, VERSIONS_DIR), { recursive: true });
  await writeAtomic(join(dir, VERSIONS_DIR, file), input.content);
  await save(dir, [...versions, { file, templateId: input.templateId, templateName: input.templateName, createdAt, ...(input.model ? { model: input.model } : {}) }]);
}

/** Versões guardadas, da mais nova à mais antiga (migrando o `notas-anterior.md` se ainda existir). */
export async function listVersions(dir: string): Promise<NotesVersion[]> {
  await migrateLegacy(dir);
  return (await readIndex(dir)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function find(dir: string, file: string): Promise<NotesVersion> {
  const version = (await listVersions(dir)).find((v) => v.file === file); // o nome vem do índice: nunca um caminho escolhido pelo renderer
  if (!version) throw new Error('version not found');
  return version;
}

export async function readVersion(dir: string, file: string): Promise<{ version: NotesVersion; content: string }> {
  const version = await find(dir, file);
  return { version, content: await readFile(join(dir, VERSIONS_DIR, version.file), 'utf8') };
}

/**
 * Restaura uma versão: ela vira o `notas.md` (e o template da reunião volta ao dela) e as notas atuais são guardadas como versão.
 * A versão restaurada sai da lista (agora é a atual).
 */
export async function restoreVersion(dir: string, file: string, currentTemplateName: (templateId: string | undefined) => Promise<string>): Promise<void> {
  const { version, content } = await readVersion(dir, file);
  const meta = await readMeta(dir);
  const current = await readMeetingText(dir, 'notes');
  const currentStamp = await stat(join(dir, MEETING_FILES.notes)).then((s) => s.mtime.toISOString(), () => undefined);
  await archiveNotes(dir, { content: current, templateId: meta.templateId ?? 'sem-template', templateName: await currentTemplateName(meta.templateId), ...(currentStamp ? { createdAt: currentStamp } : {}) });
  await writeNotes(dir, content);
  if (version.templateId !== LEGACY_TEMPLATE) await updateMeta(dir, (m) => ({ ...m, templateId: version.templateId }));
  await rm(join(dir, VERSIONS_DIR, version.file), { force: true });
  await writeIndex(dir, (await readIndex(dir)).filter((v) => v.file !== version.file));
}

