import { t } from '../i18n';

export type NubChatLine = { who: string; text: string };

export type NubAskResult = { ok: true; answer: string } | { ok: false; message: string; kind?: string };

export type NubIpcDeps<E> = {
  /** O evento veio da própria janelinha do nub? */
  fromNub: (event: E) => boolean;
  /** Pasta da gravação em andamento; `null` se não houver. O nub nunca informa o `dir`. */
  activeDir: () => string | null;
  expand: () => boolean;
  collapse: () => void;
  /** Título e últimas linhas da transcrição da reunião. */
  context: (dir: string) => Promise<{ title: string; lines: NubChatLine[] }>;
  ask: (dir: string, question: string, signal: AbortSignal, onDelta: (text: string) => void) => Promise<NubAskResult>;
  sendToNub: (channel: string, payload: unknown) => void;
  /** Avisa o app principal de uma pergunta feita pelo nub (grava no chat.md já foi feito por `ask`). */
  notifyMain: (turn: { dir: string; question: string; answer: string }) => void;
};

const REFUSED = () => ({ ok: false as const, message: t('err.no-recording') });
const FOREIGN = () => ({ ok: false as const, message: t('err.foreign-origin') });

/** Handlers dos IPCs de chat do nub; todos recusam quando a origem não é o nub ou não há sessão ativa. */
export function createNubIpc<E>(deps: NubIpcDeps<E>) {
  let controller: AbortController | null = null;

  return {
    async expand(event: E) {
      if (!deps.fromNub(event)) return FOREIGN();
      const dir = deps.activeDir();
      if (!dir || !deps.expand()) return REFUSED();
      return { ok: true as const, ...(await deps.context(dir).catch(() => ({ title: t('meeting.default-title'), lines: [] }))) };
    },
    collapse(event: E) {
      if (deps.fromNub(event)) deps.collapse();
    },
    async ask(event: E, question: unknown): Promise<NubAskResult> {
      if (!deps.fromNub(event)) return FOREIGN();
      const dir = deps.activeDir();
      const text = typeof question === 'string' ? question.trim() : '';
      if (!dir) return REFUSED();
      if (!text) return { ok: false, message: t('err.empty-question') };
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      try {
        const result = await deps.ask(dir, text, mine.signal, (delta) => deps.sendToNub('nub:delta', delta));
        if (result.ok) deps.notifyMain({ dir, question: text, answer: result.answer });
        return result;
      } finally {
        if (controller === mine) controller = null;
      }
    },
    cancel(event: E) {
      if (deps.fromNub(event)) controller?.abort();
    },
  };
}

/** Últimas `limit` linhas "**[HH:MM:SS] Quem:** texto" da transcrição em markdown. */
export function lastTranscriptLines(markdown: string, limit = 30): NubChatLine[] {
  const lines: NubChatLine[] = [];
  for (const raw of markdown.split('\n')) {
    const m = /^\*\*\[[\d:]+\] ([^:]+):\*\* (.+)$/.exec(raw.trim());
    if (m) lines.push({ who: m[1]!, text: m[2]! });
  }
  return lines.slice(-limit);
}
