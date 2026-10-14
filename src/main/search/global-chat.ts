import { t } from '../i18n';
import type { Folder } from '../../shared/types';
import { buildGlobalPrompt, globalChatSystemPrompt, globalContextLabels, type GlobalLang } from '../claude/global-chat';
import { runChat } from '../ai/chat-run';
import { AiError, type AiRunner, type WebSource } from '../ai/types';
import { appendGlobalTurn, readGlobalConversation, type Citation, type GlobalScope } from '../store/global-chat';
import type { SearchIndex } from './index';
import { buildContext, retrieve } from './retrieve';

export const MAX_QUESTION_LENGTH = 2000;

export type GlobalChatDeps = {
  root: () => Promise<string>;
  folders: (root: string) => Promise<Folder[]>;
  index: SearchIndex;
  runner: AiRunner;
  /** Idioma das instruções (o do app); a resposta segue o idioma da pergunta. */
  language: () => Promise<GlobalLang>;
  /** Texto fixo (já traduzido) para "não achei reuniões para isso". */
  noMeetings: (lang: GlobalLang) => string;
  /** Aviso (já traduzido) no começo da resposta quando nenhuma reunião menciona o que foi perguntado. */
  fallbackNotice?: (lang: GlobalLang) => string;
  /** Texto para "nenhuma reunião nesse período". */
  noMeetingsInPeriod?: (lang: GlobalLang) => string;
  /** Opção do usuário "Permitir ferramentas e MCPs no chat" (desligada por padrão). */
  useTools?: () => Promise<boolean>;
  /** "Buscar na web" pedido para esta pergunta (já conferido contra o provedor ativo; lança se não suportar). */
  web?: () => Promise<boolean>;
  /** Memória entre reuniões relevante para a pergunta (fatos das pessoas/empresas citadas); '' = nada. */
  memory?: (question: string) => Promise<{ text: string; dirs: readonly string[] }>;
  /** Orçamento de caracteres do contexto (modelo local: depende do `num_ctx`); sem isso vale o padrão. */
  contextBudget?: () => Promise<number | undefined>;
  now?: () => Date;
};

export type GlobalAnswer =
  | { ok: true; answer: string; citations: Citation[]; terms: string[]; sources: WebSource[] }
  | { ok: false; kind: string; message: string };

/** O escopo vem do renderer: só `all` ou uma pasta que existe; qualquer outra coisa vale `all`. */
export function checkScope(raw: unknown, folders: Folder[]): GlobalScope {
  const o = raw as { kind?: unknown; folderId?: unknown } | null;
  if (o?.kind === 'folder' && typeof o.folderId === 'string' && folders.some((f) => f.id === o.folderId)) return { kind: 'folder', folderId: o.folderId };
  return { kind: 'all' };
}

const formatDate = (iso: string) => iso.slice(0, 10);

/** Pergunta sobre várias reuniões: recupera as relevantes no índice, monta o contexto, transmite a resposta e grava a troca. */
export async function askAcrossMeetings(deps: GlobalChatDeps, rawQuestion: unknown, rawScope: unknown, signal: AbortSignal, onDelta: (text: string) => void): Promise<GlobalAnswer> {
  try {
    const question = typeof rawQuestion === 'string' ? rawQuestion.trim().slice(0, MAX_QUESTION_LENGTH) : '';
    if (!question) return { ok: false, kind: 'other', message: t('err.empty-question') };
    const root = await deps.root();
    const lang = await deps.language();
    const folders = await deps.folders(root);
    const scope = checkScope(rawScope, folders);
    await deps.index.refresh(root);
    const found = retrieve(deps.index, question, { folders, scopeFolderId: scope.kind === 'folder' ? scope.folderId : null, now: deps.now?.() ?? new Date() });
    const citations: Citation[] = found.meetings.map((m) => ({ n: m.n, dir: m.entry.dir, title: m.entry.title, date: m.entry.startedAt }));
    const web = (await deps.web?.()) === true;
    const mem = (await deps.memory?.(question).catch(() => null)) ?? { text: '', dirs: [] as readonly string[] };
    const memory = mem.text;
    let sources: WebSource[] = [];
    let answer: string;
    if (found.meetings.length === 0 && !memory) {
      answer = found.emptyPeriod && deps.noMeetingsInPeriod ? deps.noMeetingsInPeriod(lang) : deps.noMeetings(lang);
      onDelta(answer);
    } else {
      // palavras que nenhuma reunião menciona: as recentes entram como contexto e o aviso abre a resposta (nunca uma recusa seca)
      const notice = found.fallback && deps.fallbackNotice ? `${deps.fallbackNotice(lang)}\n\n` : '';
      if (notice) onDelta(notice);
      const history = await readGlobalConversation(root);
      const budget = await deps.contextBudget?.();
      const context = buildContext(found.meetings, found.terms, globalContextLabels(lang), formatDate, ...(budget ? [budget] : []));
      answer = await runChat(deps.runner, { system: globalChatSystemPrompt(lang), prompt: buildGlobalPrompt(context, history, question, lang, '', memory), signal, egress: { kind: 'chat', dirs: [...new Set([...found.meetings.map((m) => m.entry.dir), ...mem.dirs])] } }, { useTools: (await deps.useTools?.()) === true, language: lang === 'en' ? 'en' : 'pt-BR', onDelta, prefix: notice, ...(web ? { web: true, onSources: (list: WebSource[]) => (sources = list) } : {}) });
    }
    await appendGlobalTurn(root, { question, answer, scope, citations, terms: found.terms, ...(sources.length > 0 ? { sources } : {}) }, deps.now?.());
    return { ok: true, answer, citations, terms: found.terms, sources };
  } catch (err) {
    return { ok: false, kind: err instanceof AiError ? err.kind : 'other', message: (err as Error).message };
  }
}
