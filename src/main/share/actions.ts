import { stripUserMarks } from '../../shared/notes-marks';
import { applySpeakerNames } from '../../shared/speakers';
import { buildFollowUpPrompt, followUpSystemPrompt } from '../claude/follow-up';
import { AiError, type AiRunner } from '../ai/types';
import { t, type UiLanguage } from '../i18n';
import type { MeetingMeta, TranscriptionLanguage } from '../../shared/types';
import { buildMailto, cleanRecipients, MAILTO_LIMIT, parseDraft } from './mailto';
import { markdownToHtml } from './markdown-html';
import { buildPrintHtml } from './print-html';
import { exportFileName, pdfFileName, renderPdf, type PdfWindow } from './pdf';


export type ShareDeps = {
  /** Valida o `dir` contra a raiz das reuniões (lança se estiver fora). */
  checkedDir: (dir: unknown) => Promise<string>;
  readMeta: (dir: string) => Promise<MeetingMeta>;
  readText: (dir: string, file: 'notes' | 'transcript') => Promise<string>;
  clipboard: { write(data: { text: string; html?: string }): void | Promise<void> };
  runner: AiRunner;
  /** Idioma da reunião (para o e-mail) e idioma dos títulos (para o PDF). */
  languageOf: (meta: MeetingMeta) => Promise<{ language: TranscriptionLanguage; headings: UiLanguage }>;
  /** E-mails dos participantes da agenda, sem o do usuário. */
  participants: (meta: MeetingMeta) => Promise<string[]>;
  /** E-mails do próprio usuário, que nunca vão como destinatário. */
  selfEmails: () => Promise<string[]>;
  openExternal: (url: string) => Promise<void>;
  /** Pasta de destino atual (a última usada ou Downloads), já com `~` para mostrar, e o caminho livre para um nome de arquivo (sufixo " (2)" se já existir). */
  exportFolder: () => Promise<{ display: string }>;
  exportTarget: (fileName: string) => Promise<string>;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  createPdfWindow: () => PdfWindow;
};

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const fail = (err: unknown): { ok: false; message: string } => ({ ok: false, message: (err as Error).message });

async function notesOf(deps: ShareDeps, rawDir: unknown): Promise<{ dir: string; meta: MeetingMeta; notes: string }> {
  const dir = await deps.checkedDir(rawDir);
  const notes = stripUserMarks(await deps.readText(dir, 'notes')).trim(); // sem os marcadores `<!--u:N-->` das anotações do usuário
  if (!notes) throw new Error(t('err.share-no-notes'));
  return { dir, meta: await deps.readMeta(dir), notes };
}

/** Copia as notas: Markdown puro, ou texto + HTML formatado (cola formatado em Slack, Gmail, Notion e Docs). */
export async function copyNotes(deps: ShareDeps, rawDir: unknown, mode: 'rich' | 'markdown'): Promise<Result> {
  try {
    const { notes } = await notesOf(deps, rawDir);
    await deps.clipboard.write(mode === 'rich' ? { text: notes, html: markdownToHtml(notes) } : { text: notes });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export type EmailDraft = { subject: string; body: string; to: string[]; mailtoLimit: number };

/** A IA escreve assunto e corpo no idioma da reunião; os destinatários vêm dos participantes da agenda (sem o usuário). */
export async function draftEmail(deps: ShareDeps, rawDir: unknown, signal: AbortSignal): Promise<Result<EmailDraft>> {
  try {
    const { dir, meta, notes } = await notesOf(deps, rawDir);
    const { language } = await deps.languageOf(meta);
    const run = deps.runner.run({ system: followUpSystemPrompt(language), prompt: buildFollowUpPrompt({ title: meta.title, startedAt: meta.startedAt, notes }, language), signal, egress: { kind: 'email-draft', dir } });
    let text: string;
    for (;;) {
      const step = await run.next();
      if (step.done) {
        text = step.value;
        break;
      }
    }
    const { subject, body } = parseDraft(text, meta.title);
    if (!body) throw new Error(t('err.share-email', { message: '—' }));
    const to = cleanRecipients(await deps.participants(meta), await deps.selfEmails());
    return { ok: true, subject, body, to, mailtoLimit: MAILTO_LIMIT };
  } catch (err) {
    return { ok: false, message: err instanceof AiError ? err.message : t('err.share-email', { message: (err as Error).message }) };
  }
}

/** Abre o Mail com o rascunho. O `mailto:` é montado aqui, a partir de texto: o renderer nunca escolhe a URL. */
export async function openMail(deps: ShareDeps, raw: unknown): Promise<Result> {
  try {
    const o = (raw ?? {}) as { to?: unknown; subject?: unknown; body?: unknown };
    const to = Array.isArray(o.to) ? o.to.map(String) : typeof o.to === 'string' ? o.to.split(/[,;\s]+/) : [];
    const { url, tooLong } = buildMailto({ to, subject: String(o.subject ?? ''), body: String(o.body ?? ''), exclude: await deps.selfEmails() });
    if (tooLong) throw new Error(t('share.email.too-long'));
    await deps.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message || t('err.share-mail-open') };
  }
}

/** O que o diálogo de PDF mostra: a pasta de destino (com `~`) e o nome sugerido (título da reunião + .pdf, sanitizado). */
export async function exportInfo(deps: ShareDeps, rawDir: unknown): Promise<Result<{ folder: string; fileName: string }>> {
  try {
    const dir = await deps.checkedDir(rawDir);
    const meta = await deps.readMeta(dir);
    return { ok: true, folder: (await deps.exportFolder()).display, fileName: pdfFileName(meta.title) };
  } catch (err) {
    return fail(err);
  }
}

export type PdfOptions = { transcript?: unknown; fileName?: unknown };

/** Exporta o PDF (notas e, se pedido, a transcrição) direto na pasta escolhida, sem outro diálogo de salvar, sem sobrescrever. */
export async function exportPdf(deps: ShareDeps, rawDir: unknown, options: PdfOptions): Promise<Result<{ path: string }>> {
  try {
    const dir = await deps.checkedDir(rawDir);
    const meta = await deps.readMeta(dir);
    const path = await deps.exportTarget(exportFileName(options?.fileName, meta.title));
    const { headings } = await deps.languageOf(meta);
    const html = buildPrintHtml({
      title: meta.title,
      startedAt: meta.startedAt,
      participants: cleanRecipients(await deps.participants(meta), await deps.selfEmails()),
      notes: stripUserMarks(await deps.readText(dir, 'notes')),
      ...(options?.transcript === true ? { transcript: applySpeakerNames(await deps.readText(dir, 'transcript'), meta.speakers) } : {}), // "Pessoa N" aparece com o nome dado
      language: headings,
    });
    await deps.writeFile(path, await renderPdf(html, deps.createPdfWindow));
    return { ok: true, path };
  } catch (err) {
    return fail(err);
  }
}
