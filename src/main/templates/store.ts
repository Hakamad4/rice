import { t } from '../i18n';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteTemplate, NoteTemplateInput } from '../../shared/types';
import { writeAtomic } from '../store/meeting-files';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, USER_TEMPLATE_ICON } from './builtin';
import { validateTemplate } from './schema';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const templatesDir = (root: string): string => join(root, '.rice', 'templates');

const builtinById = (id: string) => BUILTIN_TEMPLATES.find((t) => t.id === id);

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === code;
}

export type TemplateList = { templates: NoteTemplate[]; warnings: string[] };

/**
 * Templates do usuário e overrides de embutidos (arquivo com o id de um embutido → `builtin: true, customized: true`).
 * Arquivo inválido é ignorado com aviso (um override inválido deixa valer o embutido); nunca lança por conteúdo.
 */
export async function loadUserTemplates(root: string): Promise<TemplateList> {
  const dir = templatesDir(root);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
  } catch (err) {
    if (isErrno(err, 'ENOENT') || isErrno(err, 'ENOTDIR')) return { templates: [], warnings: [] };
    throw err;
  }
  const templates: NoteTemplate[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const id = name.slice(0, -'.json'.length);
    try {
      if (!ID_RE.test(id)) throw new Error(t('warn.template-bad-filename'));
      const checked = validateTemplate(JSON.parse(await readFile(join(dir, name), 'utf8')));
      if (!checked.ok) throw new Error(checked.message);
      const { id: _ignored, ...content } = checked.value;
      const base = builtinById(id);
      templates.push(base ? { ...content, id, icon: base.icon, builtin: true, customized: true } : { ...content, id, icon: USER_TEMPLATE_ICON, builtin: false });
    } catch (err) {
      warnings.push(t('warn.template-ignored', { name, reason: (err as Error).message }));
    }
  }
  return { templates, warnings };
}

const byTitle = (a: NoteTemplate, b: NoteTemplate) => a.title.localeCompare(b.title, 'pt-BR');

/** Embutidos (na ordem definida, com o override do usuário no lugar quando houver) seguidos dos do usuário (por título). */
export async function listTemplates(root: string): Promise<TemplateList> {
  const user = await loadUserTemplates(root);
  const overrides = new Map(user.templates.filter((t) => t.builtin).map((t) => [t.id, t]));
  return {
    templates: [...BUILTIN_TEMPLATES.map((t) => overrides.get(t.id) ?? t), ...user.templates.filter((t) => !t.builtin).sort(byTitle)],
    warnings: user.warnings,
  };
}

export async function getTemplate(root: string, id: string): Promise<NoteTemplate | null> {
  if (!ID_RE.test(id)) return null;
  const found = (await loadUserTemplates(root)).templates.find((t) => t.id === id);
  return found ?? builtinById(id) ?? null;
}

/** Template pedido, ou o padrão embutido quando `id` não existe mais (apagado, arquivo inválido). */
export async function resolveTemplate(root: string, id?: string): Promise<NoteTemplate> {
  return (id ? await getTemplate(root, id) : null) ?? (await getTemplate(root, DEFAULT_TEMPLATE_ID))!;
}

/** Cria (sem `id`) ou atualiza um template do usuário. Salvar com o id de um embutido grava um override dele. */
export async function saveTemplate(root: string, input: NoteTemplateInput): Promise<NoteTemplate> {
  const checked = validateTemplate(input);
  if (!checked.ok) throw new Error(checked.message);
  const id = checked.value.id ?? randomUUID();
  if (!ID_RE.test(id)) throw new Error(t('err.template-id'));
  const { id: _omit, ...content } = checked.value;
  const dir = templatesDir(root);
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, `${id}.json`), `${JSON.stringify({ id, ...content }, null, 2)}\n`);
  const base = builtinById(id);
  return base ? { ...content, id, icon: base.icon, builtin: true, customized: true } : { ...content, id, icon: USER_TEMPLATE_ICON, builtin: false };
}

export async function deleteTemplate(root: string, id: string): Promise<void> {
  if (builtinById(id)) throw new Error(t('err.template-builtin-delete'));
  if (!ID_RE.test(id)) throw new Error(t('err.template-id'));
  await rm(join(templatesDir(root), `${id}.json`), { force: true });
}

/** Volta um embutido ao padrão apagando o override do usuário (idempotente). */
export async function restoreBuiltinTemplate(root: string, id: string): Promise<NoteTemplate> {
  const builtin = builtinById(id);
  if (!builtin) throw new Error(t('err.template-restore-only-builtin'));
  await rm(join(templatesDir(root), `${id}.json`), { force: true });
  return builtin;
}
