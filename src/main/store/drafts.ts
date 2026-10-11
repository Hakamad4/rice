import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toLocalIso } from '../../shared/naming';
import { t } from '../i18n';
import { readConfig, writeConfig, type WarRoomConfig } from '../warroom/store';
import { listMeetingDirs, MEETING_FILES, readMeta, updateMeta } from './meeting-files';

/** Só estes arquivos podem existir num rascunho vazio: o meta, a transcrição com só o cabeçalho e a config da War room (sem conteúdo). */
const CONFIG_ONLY = new Set([MEETING_FILES.meta, MEETING_FILES.transcript, 'warroom.json', '.DS_Store']);
const LANGS = ['pt-BR', 'en'] as const;

/** A config da War room não tem conteúdo do usuário: nenhum achado, nenhuma fonte, nenhum contador e nada ligado. (O tipo "War room" sozinho não conta.) */
const configIsEmpty = (cfg: WarRoomConfig) => cfg.facts.length === 0 && !cfg.ideas.on && !cfg.sources.web && !cfg.sources.mcp && cfg.sources.folder === null && cfg.ideasCycles === 0 && cfg.investigationCycles === 0 && cfg.extraCycles === 0;

/**
 * Rascunho vazio: nunca gravado, nunca renomeado (título padrão em qualquer idioma), sem agenda, sem anotações,
 * sem notas, sem chat, sem anexos e sem achados. Qualquer dúvida ou erro de leitura = NÃO é vazio (nunca apaga o que pode ter conteúdo).
 */
export async function isEmptyDraft(dir: string): Promise<boolean> {
  try {
    const meta = await readMeta(dir);
    if (meta.state !== 'draft' || meta.calendarEventId || (meta.sessions && meta.sessions.length) || (meta.gaps && meta.gaps.length)) return false;
    if (!LANGS.some((lang) => meta.title === t('meeting.default-title', undefined, lang))) return false;
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isDirectory() || !CONFIG_ONLY.has(entry.name))) return false;
    const transcript = (await readFile(join(dir, MEETING_FILES.transcript), 'utf8')).trim();
    if (!LANGS.some((lang) => transcript === t('file.transcript-heading', { title: meta.title }, lang).trim())) return false;
    return configIsEmpty(await readConfig(dir));
  } catch {
    return false;
  }
}

/** O rascunho vazio mais recente da raiz, se houver (reaproveitado em vez de criar mais uma pasta). */
export async function findEmptyDraft(root: string): Promise<string | null> {
  const candidates = await Promise.all((await listMeetingDirs(root)).map(async (dir) => ({ dir, meta: await readMeta(dir).catch(() => null) })));
  const drafts = candidates.filter((c) => c.meta && c.meta.state === 'draft').sort((a, b) => Date.parse(b.meta!.startedAt) - Date.parse(a.meta!.startedAt));
  for (const draft of drafts) if (await isEmptyDraft(draft.dir)) return draft.dir;
  return null;
}

/** Reaproveita o rascunho: nova hora de início, pasta pedida (ou nenhuma) e, para a War room, o tipo convertido. */
export async function reuseDraft(dir: string, options: { startedAt: Date; folderId?: string; kind?: 'meeting' | 'warroom' }): Promise<void> {
  await updateMeta(dir, (meta) => {
    const { folderId: _old, ...rest } = meta;
    return { ...rest, startedAt: toLocalIso(options.startedAt), ...(options.folderId ? { folderId: options.folderId } : {}) };
  });
  if (options.kind === 'warroom') await writeConfig(dir, { ...(await readConfig(dir)), kind: 'warroom' });
}

/** Ao sair do rascunho: se continua vazio, vai para a Lixeira (`trash`, recuperável). Devolve se apagou. */
export async function discardEmptyDraft(dir: string, trash: (dir: string) => Promise<void>): Promise<boolean> {
  if (!(await isEmptyDraft(dir))) return false;
  await trash(dir);
  return true;
}
