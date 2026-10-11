import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../i18n';
import { writeAtomic } from '../store/meeting-files';

/** Template de ideias: o que a IA deve sugerir no modo ideia (instrução do usuário) e, opcionalmente, as categorias de saída. */
export type IdeaTemplate = { id: string; title: string; description: string; icon: string; instruction: string; categories: string[]; builtin: boolean; customized?: boolean };
export type IdeaTemplateInput = { id?: string; title: unknown; description?: unknown; instruction: unknown; categories?: unknown };

export const DEFAULT_IDEA_TEMPLATE_ID = 'general';
export const IDEA_LIMITS = { title: 80, description: 200, instruction: 1200, categories: 6, category: 24 } as const;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const USER_IDEA_ICON = 'lightbulb';

type Text = { title: string; description: string; instruction: string; categories: string[] };
const BUILTIN: { id: string; icon: string; pt: Text; en: Text }[] = [
  { id: 'general', icon: 'lightbulb',
    pt: { title: 'Geral', description: 'Ideias, perguntas e riscos sobre o que foi dito.', instruction: 'Sugira ideias, perguntas e riscos específicos do que foi dito.', categories: [] },
    en: { title: 'General', description: 'Ideas, questions and risks about what was said.', instruction: 'Suggest ideas, questions and risks specific to what was said.', categories: [] } },
  { id: 'brainstorm', icon: 'sparkles',
    pt: { title: 'Brainstorm', description: 'Ideias novas e combinações entre o que foi dito.', instruction: 'Gere ideias novas e combinações inesperadas entre os pontos citados; evite o óbvio e o que já foi proposto.', categories: ['Ideia', 'Combinação'] },
    en: { title: 'Brainstorm', description: 'New ideas and combinations of what was said.', instruction: 'Generate new ideas and unexpected combinations of the points mentioned; avoid the obvious and what was already proposed.', categories: ['Idea', 'Combination'] } },
  { id: 'questions', icon: 'search',
    pt: { title: 'Perguntas para fazer agora', description: 'As próximas perguntas para aprofundar o ponto em discussão.', instruction: 'Sugira as próximas perguntas que aprofundam ou esclarecem o ponto em discussão agora.', categories: ['Aprofundar', 'Esclarecer'] },
    en: { title: 'Questions to ask now', description: 'The next questions to go deeper on the current topic.', instruction: 'Suggest the next questions that deepen or clarify the point being discussed right now.', categories: ['Go deeper', 'Clarify'] } },
  { id: 'risks', icon: 'shield',
    pt: { title: 'Riscos e objeções', description: 'Riscos, objeções e pontos cegos do que foi dito.', instruction: 'Aponte riscos, objeções e pontos cegos do que está sendo proposto ou decidido.', categories: ['Risco', 'Objeção'] },
    en: { title: 'Risks and objections', description: 'Risks, objections and blind spots in what was said.', instruction: 'Point out risks, objections and blind spots in what is being proposed or decided.', categories: ['Risk', 'Objection'] } },
  { id: 'sales', icon: 'briefcase',
    pt: { title: 'Vendas', description: 'Objeções do cliente, sinais de compra e o próximo passo.', instruction: 'Identifique objeções do cliente, sinais de compra e sugira o próximo passo da negociação.', categories: ['Objeção', 'Sinal de compra', 'Próximo passo'] },
    en: { title: 'Sales', description: 'Customer objections, buying signals and the next step.', instruction: 'Identify customer objections and buying signals, and suggest the next step of the negotiation.', categories: ['Objection', 'Buying signal', 'Next step'] } },
  { id: 'interview', icon: 'user-check',
    pt: { title: 'Entrevista', description: 'Próximas perguntas e sinais a verificar.', instruction: 'Sugira as próximas perguntas da entrevista e sinais a verificar nas respostas dadas.', categories: ['Pergunta', 'Sinal'] },
    en: { title: 'Interview', description: 'Next questions and signals to check.', instruction: 'Suggest the next interview questions and signals to verify in the answers given.', categories: ['Question', 'Signal'] } },
  { id: 'technical', icon: 'settings',
    pt: { title: 'Técnico', description: 'Alternativas de solução, armadilhas e o que testar.', instruction: 'Sugira alternativas de solução, armadilhas conhecidas e o que vale testar.', categories: ['Alternativa', 'Armadilha', 'Testar'] },
    en: { title: 'Technical', description: 'Solution alternatives, pitfalls and what to test.', instruction: 'Suggest solution alternatives, known pitfalls and what is worth testing.', categories: ['Alternative', 'Pitfall', 'Test'] } },
];

const toTemplate = (b: (typeof BUILTIN)[number], lang: 'pt-BR' | 'en'): IdeaTemplate => ({ id: b.id, icon: b.icon, builtin: true, ...(lang === 'en' ? b.en : b.pt), categories: [...(lang === 'en' ? b.en : b.pt).categories] });
export const BUILTIN_IDEA_TEMPLATES: IdeaTemplate[] = BUILTIN.map((b) => toTemplate(b, 'pt-BR'));
const builtinById = (id: string) => BUILTIN.find((b) => b.id === id);

export const ideaTemplatesDir = (root: string): string => join(root, '.rice', 'idea-templates');
const oneLine = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export type IdeaValidation = { ok: true; value: { id?: string; title: string; description: string; instruction: string; categories: string[] } } | { ok: false; message: string };

/** Valida e normaliza (campos de uma linha colapsados; categorias únicas). Nunca lança. */
export function validateIdeaTemplate(raw: unknown): IdeaValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, message: t('itpl.err.object') };
  const o = raw as Record<string, unknown>;
  const title = oneLine(o.title);
  if (title.length < 1 || title.length > IDEA_LIMITS.title) return { ok: false, message: t('itpl.err.title', { max: IDEA_LIMITS.title }) };
  const description = oneLine(o.description);
  if (description.length > IDEA_LIMITS.description) return { ok: false, message: t('itpl.err.description', { max: IDEA_LIMITS.description }) };
  const instruction = typeof o.instruction === 'string' ? o.instruction.replace(/\r\n?/g, '\n').trim() : '';
  if (instruction.length < 1 || instruction.length > IDEA_LIMITS.instruction) return { ok: false, message: t('itpl.err.instruction', { max: IDEA_LIMITS.instruction }) };
  const list = Array.isArray(o.categories) ? o.categories : [];
  const categories: string[] = [];
  for (const c of list) {
    const name = oneLine(c);
    if (!name) continue;
    if (name.length > IDEA_LIMITS.category) return { ok: false, message: t('itpl.err.category', { max: IDEA_LIMITS.category }) };
    if (!categories.some((x) => x.toLowerCase() === name.toLowerCase())) categories.push(name);
  }
  if (categories.length > IDEA_LIMITS.categories) return { ok: false, message: t('itpl.err.categories', { max: IDEA_LIMITS.categories }) };
  return { ok: true, value: { ...(typeof o.id === 'string' ? { id: o.id } : {}), title, description, instruction, categories } };
}

export function localizeIdeaTemplate(template: IdeaTemplate, lang: 'pt-BR' | 'en'): IdeaTemplate {
  const base = builtinById(template.id);
  if (lang !== 'en' || !base || !template.builtin || template.customized) return template;
  return toTemplate(base, 'en');
}

export type IdeaTemplateList = { templates: IdeaTemplate[]; warnings: string[] };

async function loadUser(root: string): Promise<IdeaTemplateList> {
  const dir = ideaTemplatesDir(root);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
  } catch {
    return { templates: [], warnings: [] };
  }
  const templates: IdeaTemplate[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const id = name.slice(0, -'.json'.length);
    try {
      if (!ID_RE.test(id)) throw new Error(t('warn.template-bad-filename'));
      const checked = validateIdeaTemplate(JSON.parse(await readFile(join(dir, name), 'utf8')));
      if (!checked.ok) throw new Error(checked.message);
      const { id: _ignored, ...content } = checked.value;
      const base = builtinById(id);
      templates.push(base ? { ...content, id, icon: base.icon, builtin: true, customized: true } : { ...content, id, icon: USER_IDEA_ICON, builtin: false });
    } catch (err) {
      warnings.push(t('warn.template-ignored', { name, reason: (err as Error).message }));
    }
  }
  return { templates, warnings };
}

/** Embutidos (com o override do usuário no lugar) seguidos dos do usuário (por título). */
export async function listIdeaTemplates(root: string): Promise<IdeaTemplateList> {
  const user = await loadUser(root);
  const overrides = new Map(user.templates.filter((x) => x.builtin).map((x) => [x.id, x]));
  return { templates: [...BUILTIN_IDEA_TEMPLATES.map((x) => overrides.get(x.id) ?? x), ...user.templates.filter((x) => !x.builtin).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))], warnings: user.warnings };
}

/** O template pedido, ou o Geral quando não existe mais (apagado, arquivo inválido). */
export async function resolveIdeaTemplate(root: string, id?: string): Promise<IdeaTemplate> {
  const all = (await listIdeaTemplates(root)).templates;
  return all.find((x) => x.id === id) ?? all.find((x) => x.id === DEFAULT_IDEA_TEMPLATE_ID)!;
}

export async function saveIdeaTemplate(root: string, input: IdeaTemplateInput): Promise<IdeaTemplate> {
  const checked = validateIdeaTemplate(input);
  if (!checked.ok) throw new Error(checked.message);
  const id = checked.value.id ?? randomUUID();
  if (!ID_RE.test(id)) throw new Error(t('err.template-id'));
  const { id: _omit, ...content } = checked.value;
  await mkdir(ideaTemplatesDir(root), { recursive: true });
  await writeAtomic(join(ideaTemplatesDir(root), `${id}.json`), `${JSON.stringify({ id, ...content }, null, 2)}\n`);
  const base = builtinById(id);
  return base ? { ...content, id, icon: base.icon, builtin: true, customized: true } : { ...content, id, icon: USER_IDEA_ICON, builtin: false };
}

export async function deleteIdeaTemplate(root: string, id: string): Promise<void> {
  if (builtinById(id)) throw new Error(t('err.template-builtin-delete'));
  if (!ID_RE.test(id)) throw new Error(t('err.template-id'));
  await rm(join(ideaTemplatesDir(root), `${id}.json`), { force: true });
}

/** Volta um embutido ao padrão apagando o override do usuário (idempotente). */
export async function restoreBuiltinIdeaTemplate(root: string, id: string): Promise<IdeaTemplate> {
  const base = builtinById(id);
  if (!base) throw new Error(t('err.template-restore-only-builtin'));
  await rm(join(ideaTemplatesDir(root), `${id}.json`), { force: true });
  return toTemplate(base, 'pt-BR');
}
