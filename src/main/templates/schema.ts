import { t } from '../i18n';
import type { NoteTemplateInput, NoteTemplateSection } from '../../shared/types';

export const TEMPLATE_LIMITS = { title: 80, description: 500, heading: 80, minSections: 1, maxSections: 12 } as const;

export type Validation = { ok: true; value: NoteTemplateInput } | { ok: false; message: string };

const oneLine = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Valida e normaliza (espaços colapsados nos campos de uma linha). Nunca lança. */
export function validateTemplate(raw: unknown): Validation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, message: t('tpl.err.object') };
  const o = raw as Record<string, unknown>;
  const title = oneLine(o.title);
  if (title.length < 1 || title.length > TEMPLATE_LIMITS.title) return { ok: false, message: t('tpl.err.title', { max: TEMPLATE_LIMITS.title }) };
  if (o.description !== undefined && typeof o.description !== 'string') return { ok: false, message: t('tpl.err.description-type') };
  const description = oneLine(o.description);
  if (description.length > TEMPLATE_LIMITS.description) return { ok: false, message: t('tpl.err.description-long', { max: TEMPLATE_LIMITS.description }) };
  // `symbol` (emoji) é legado: arquivos antigos podem trazer, mas é ignorado
  if (!Array.isArray(o.sections) || o.sections.length < TEMPLATE_LIMITS.minSections || o.sections.length > TEMPLATE_LIMITS.maxSections) {
    return { ok: false, message: t('tpl.err.sections', { min: TEMPLATE_LIMITS.minSections, max: TEMPLATE_LIMITS.maxSections }) };
  }
  const sections: NoteTemplateSection[] = [];
  for (const [i, s] of o.sections.entries()) {
    const sec = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    const heading = oneLine(sec.heading);
    if (heading.length < 1 || heading.length > TEMPLATE_LIMITS.heading) return { ok: false, message: t('tpl.err.section-heading', { n: i + 1, max: TEMPLATE_LIMITS.heading }) };
    if (sec.description !== undefined && typeof sec.description !== 'string') return { ok: false, message: t('tpl.err.section-description-type', { n: i + 1 }) };
    const sectionDescription = oneLine(sec.description);
    if (sectionDescription.length > TEMPLATE_LIMITS.description) return { ok: false, message: t('tpl.err.section-description-long', { n: i + 1, max: TEMPLATE_LIMITS.description }) };
    sections.push({ heading, description: sectionDescription });
  }
  return { ok: true, value: { ...(typeof o.id === 'string' ? { id: o.id } : {}), title, description, sections } };
}
