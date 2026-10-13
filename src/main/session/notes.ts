import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AiError } from '../ai/types';
import { ClaudeError } from '../claude/runner';
import { t } from '../i18n';
import { applySpeakerNames } from '../../shared/speakers';
import { buildExtractPrompt, buildNotesPrompt, buildNotesSystemPrompt, extractSystemPrompt, otherNotesHeading, userMark, type AnnotationItem } from '../claude/prompts';
import type { AiRunner } from '../ai/types';
import type { MeetingMeta, NotesStatus, NoteTemplate, TranscriptionLanguage } from '../../shared/types';
import type { UiLanguage } from '../i18n';
import { digestText, emitProgress, extractParts, longNotesConfig, splitTranscript } from './long-notes';
import { attachmentsContext } from '../attachments/store';
import { sanitizeShotMarkers, shotsForNotes } from '../screenshots/notes-context';
import { readAnnotations } from '../store/annotations';
import { archiveNotes } from '../store/notes-versions';
import { MEETING_FILES, readMeetingText, readMeta, updateMeta, writeNotes } from '../store/meeting-files';
import { BUILTIN_TEMPLATES, localizeTemplate } from '../templates/builtin';

/** Resolve o template de uma reunião (id do meta); precisa sempre devolver um template válido. */
export type TemplateResolver = (templateId: string | undefined) => Promise<NoteTemplate>;

const defaultResolver: TemplateResolver = async () => BUILTIN_TEMPLATES[0]!;

/** Idioma das notas: o falado na reunião (para o prompt) e o dos títulos das seções dos templates embutidos. */
export type NotesLanguage = { language: TranscriptionLanguage; headings: UiLanguage };
export type LanguageResolver = (meta: Pick<MeetingMeta, 'language'>) => Promise<NotesLanguage> | NotesLanguage;

/** Sem configuração: o idioma da reunião (padrão pt); `auto` mantém os títulos em português. */
const defaultLanguage: LanguageResolver = (meta) => {
  const language = meta.language ?? 'pt';
  return { language, headings: language === 'en' ? 'en' : 'pt-BR' };
};

/**
 * Garantia de que nada do que o usuário escreveu some: toda anotação sem o marcador `<!--u:N-->` no resultado
 * (a IA esqueceu ou ignorou) entra, como foi digitada, na seção final "Outros pontos".
 */
export function keepAnnotations(notes: string, items: readonly AnnotationItem[], language: TranscriptionLanguage): string {
  const missing = items.filter((a) => !new RegExp(`<!--u:${a.n}-->`).test(notes));
  if (missing.length === 0) return notes;
  const heading = otherNotesHeading(language);
  const lines = missing.map((a) => `- ${userMark(a.n, a.text)}`).join('\n');
  const body = notes.trimEnd();
  const existing = new RegExp(`^#{1,3}\\s*${heading}\\s*$`, 'im').exec(body);
  if (existing) {
    // o resto da seção "Outros pontos" vai até o próximo título (ou o fim)
    const after = body.slice(existing.index + existing[0].length);
    const next = /\n#{1,3}\s/.exec(after);
    const cut = existing.index + existing[0].length + (next ? next.index : after.length);
    return `${body.slice(0, cut).trimEnd()}\n${lines}\n${body.slice(cut)}`.trimEnd() + '\n';
  }
  return `${body}\n\n## ${heading}\n\n${lines}\n`;
}

/** Vocabulário da reunião (grafias corretas de nomes e siglas) para o prompt das notas. */
export type VocabularyResolver = (meta: MeetingMeta) => Promise<string[]> | string[];

const inFlight = new Map<string, Promise<void>>();

/** Relê o meta logo antes de gravar para alterar só notesStatus. */
async function setNotesStatus(dir: string, notesStatus: NotesStatus): Promise<void> {
  await updateMeta(dir, (meta) => ({ ...meta, notesStatus }));
}

/**
 * `previous`: template das notas que já existem (na regeneração o meta já aponta para o novo).
 * As notas que existiam antes viram uma versão em `notas-versoes/` só DEPOIS que as novas foram gravadas (falha não deixa versão à toa).
 */
async function run(dir: string, runner: Pick<AiRunner, 'run'>, resolve: TemplateResolver, languageOf: LanguageResolver, vocabularyOf?: VocabularyResolver, previous?: { templateId?: string }): Promise<void> {
  const meta = await readMeta(dir);
  const { language, headings } = await languageOf(meta);
  const template = localizeTemplate(await resolve(meta.templateId), headings);
  const oldNotes = await readMeetingText(dir, 'notes');
  const oldStamp = oldNotes ? await stat(join(dir, MEETING_FILES.notes)).then((s) => s.mtime.toISOString(), () => undefined) : undefined;
  const oldTemplateId = previous ? previous.templateId : meta.templateId; // na regeneração o meta já aponta para o template novo
  const archiveOld = async (): Promise<void> => {
    if (!oldNotes.trim()) return;
    const oldTemplate = localizeTemplate(await resolve(oldTemplateId), headings);
    await archiveNotes(dir, { content: oldNotes, templateId: oldTemplateId ?? oldTemplate.id, templateName: oldTemplate.title, ...(oldStamp ? { createdAt: oldStamp } : {}) });
  };
  await setNotesStatus(dir, 'pending');
  const transcript = applySpeakerNames(await readMeetingText(dir, 'transcript'), meta.speakers);
  const annotationItems = (await readAnnotations(dir)).map(({ n, text, clock }): AnnotationItem => ({ n, text, ...(clock ? { clock } : {}) }));
  const vocabulary = vocabularyOf ? await vocabularyOf(meta) : [];
  emitProgress({ dir, phase: 'write' });
  async function generate(): Promise<void> {
    // reunião longa: extrai por parte (~15 min) e escreve as notas a partir das extrações
    let body = transcript;
    const long = transcript.length > longNotesConfig().directMaxChars;
    if (long) {
      const parts = splitTranscript(transcript);
      const digest = await extractParts(dir, longNotesConfig().lightRunner ?? runner, parts, language, {
        system: extractSystemPrompt(language),
        prompt: (part, total) => buildExtractPrompt({ title: meta.title, vocabulary }, part, total, language),
      });
      body = digestText(digest);
      emitProgress({ dir, phase: 'write' });
    }
    const shots = await shotsForNotes(dir);
    const prompt = buildNotesPrompt(
      { ...(shots.length ? { screenshots: shots } : {}), title: meta.title, startedAt: meta.startedAt, transcript: body, annotations: await readMeetingText(dir, 'annotations'), annotationItems, vocabulary, ...(long ? { digest: true } : {}), attachments: await attachmentsContext(dir) },
      template,
      language,
    );
    const gen = runner.run({ system: buildNotesSystemPrompt(template, transcript.length, language), prompt });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    const text = step.value.trim();
    if (!text) throw new AiError('other', t('ai.err.empty-notes')); // resposta vazia/cortada: conta como falha (e como transitória)
    const next = keepAnnotations(sanitizeShotMarkers(text, new Set(shots.map((x) => x.id))) + '\n', annotationItems, language);
    await writeNotes(dir, next);
    if (oldNotes !== next) await archiveOld().catch(() => {}); // o histórico nunca derruba a geração
  }
  try {
    // uma nova tentativa automática para falha transitória (rede, tempo esgotado, resposta vazia); nunca para autenticação ou limite
    for (let attempt = 0; ; attempt++) {
      try {
        await generate();
        break;
      } catch (err) {
        if (attempt > 0 || !isTransientAiError(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, longNotesConfig().retryDelayMs));
      }
    }
    await setNotesStatus(dir, 'done');
  } catch (err) {
    await setNotesStatus(dir, 'failed').catch(() => {});
    throw err;
  } finally {
    emitProgress({ dir, phase: 'done' });
  }
}

/** Falha que vale uma nova tentativa: rede, tempo esgotado ou resposta vazia. Autenticação, limite de uso e cancelamento nunca repetem. */
export function isTransientAiError(err: unknown): boolean {
  if (err instanceof AiError) return err.kind === 'network' || err.kind === 'other';
  if (err instanceof ClaudeError) return err.kind === 'failed';
  return false;
}

/** Chamadas concorrentes para a mesma reunião compartilham a execução em andamento. */
export function generateNotes(dir: string, runner: Pick<AiRunner, 'run'>, resolve: TemplateResolver = defaultResolver, languageOf: LanguageResolver = defaultLanguage, vocabularyOf?: VocabularyResolver): Promise<void> {
  const existing = inFlight.get(dir);
  if (existing) return existing;
  const p: Promise<void> = run(dir, runner, resolve, languageOf, vocabularyOf).finally(() => {
    if (inFlight.get(dir) === p) inFlight.delete(dir);
  });
  inFlight.set(dir, p);
  return p;
}

/**
 * Regera o resumo com outro template: grava o template no meta, guarda o notas.md atual como versão (em notas-versoes/)
 * e gera de novo. Se a geração falhar, o notas.md antigo continua valendo (e o estado de antes é restaurado).
 */
export function regenerateNotes(
  dir: string,
  runner: Pick<AiRunner, 'run'>,
  templateId: string,
  resolve: TemplateResolver = defaultResolver,
  /** `queueAfterCurrent`: com uma geração em andamento, roda uma nova depois dela (transcrição mudou) em vez de reaproveitá-la. */
  options: { queueAfterCurrent?: boolean; languageOf?: LanguageResolver; vocabularyOf?: VocabularyResolver } = {},
): Promise<void> {
  const existing = inFlight.get(dir);
  if (existing && !options.queueAfterCurrent) return existing;
  const p: Promise<void> = (async () => {
    if (existing) await existing.catch(() => {});
    const before = await readMeta(dir);
    const hadNotes = (await readMeetingText(dir, 'notes')) !== '';
    await updateMeta(dir, (meta) => ({ ...meta, templateId }));
    try {
      await run(dir, runner, resolve, options.languageOf ?? defaultLanguage, options.vocabularyOf, { ...(before.templateId ? { templateId: before.templateId } : {}) });
    } catch (err) {
      if (hadNotes) {
        await updateMeta(dir, ({ templateId: _new, ...meta }) => ({
          ...meta,
          notesStatus: before.notesStatus,
          ...(before.templateId ? { templateId: before.templateId } : {}),
        })).catch(() => {});
      }
      throw err;
    }
  })().finally(() => {
    if (inFlight.get(dir) === p) inFlight.delete(dir);
  });
  inFlight.set(dir, p);
  return p;
}
