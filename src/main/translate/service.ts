import type { Segment } from '../../shared/types';
import { AiError, type AiRunner } from '../ai/types';
import { isLocalMode } from '../privacy/local-mode';
import { formatSegmentLine } from '../store/meeting-files';
import { offlineReady, type OfflineTranslator, type TranslateLang } from './offline';
import { appendTranslation, type TranslateVia } from './store';

/** Quantos trechos anteriores seguem junto como contexto (coerência de nomes e termos). */
export const CONTEXT_SEGMENTS = 3;
/** Trechos juntos numa chamada só quando a fila acumulou (provedor lento, ex.: CLI). */
export const MAX_BATCH = 4;
/** Fila por reunião: acima disso os mais antigos são descartados (ao vivo, o atraso só atrapalha). */
export const MAX_QUEUE = 24;
/** Depois de uma falha da IA, vai direto ao offline por este tempo (não paga o timeout de novo a cada trecho). */
export const AI_COOLDOWN_MS = 30_000;
/** Cada chamada à IA tem este teto: passou, conta como falha e cai para o offline. */
export const AI_TIMEOUT_MS = 20_000;

export type TranslateNotice = 'offline-needed' | 'ai-failed' | 'local-mode-no-engine' | 'ai-unavailable' | 'local-mode-ai-only';
export type TranslateResult = { dir: string; key: string; lang: TranslateLang; text: string; via: TranslateVia; ms: number };

export type AiAvailability = { runner: AiRunner; provider: string; local: boolean } | null;

export type TranslateDeps = {
  /** Runner do provedor ativo (modelo leve) ou null se não há IA configurada. `local`: o provedor é o Modelo local (nada sai). */
  ai: () => Promise<AiAvailability>;
  offline: OfflineTranslator;
  /** Falso (chave OFFLINE_TRANSLATION desligada): sem etapa offline e sem oferta de download nos avisos. Padrão: verdadeiro. */
  offlineEnabled?: boolean;
  /** Quando a reunião começou (para montar a chave da linha). */
  startedAt: (dir: string) => Promise<Date>;
  onResult: (result: TranslateResult) => void;
  onNotice: (dir: string, notice: TranslateNotice) => void;
  now?: () => number;
  localMode?: () => boolean;
  /** Tolerância a falhas no disco: a tradução continua na tela. */
  onError?: (err: unknown) => void;
};

type Item = { key: string; text: string; closedAt: number };
type Job = { lang: TranslateLang; from: TranslateLang; queue: Item[]; context: string[]; running: boolean };

const LANG_NAME: Record<TranslateLang, string> = { pt: 'Brazilian Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian' };

export const translateSystem = (lang: TranslateLang): string =>
  `You are a live interpreter for a meeting transcript. Translate the utterances you are given into ${LANG_NAME[lang]}. Keep names, numbers and technical terms. If an utterance is already in ${LANG_NAME[lang]}, repeat it unchanged. Never explain, never add notes. Output only the translation.`;

export function buildPrompt(items: readonly Item[], context: readonly string[]): string {
  const ctx = context.length > 0 ? `Earlier utterances (context only, do not translate):\n${context.map((c) => `- ${c}`).join('\n')}\n\n` : '';
  if (items.length === 1) return `${ctx}Translate this utterance:\n${items[0]!.text}`;
  return `${ctx}Translate each numbered utterance. Answer with exactly ${items.length} lines, each "N. translation", same numbers, nothing else.\n${items.map((it, i) => `${i + 1}. ${it.text}`).join('\n')}`;
}

/** Lê a resposta em lote ("1. ...", "2. ..."); null se não vier no formato (aí cada trecho é traduzido sozinho). */
export function parseBatch(output: string, count: number): string[] | null {
  const out: string[] = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)[.)]\s*(.*)$/.exec(line);
    if (m) {
      if (Number(m[1]) !== out.length + 1) return null;
      out.push(m[2]!.trim());
    } else if (line.trim() && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
    else if (line.trim()) return null;
  }
  return out.length === count && out.every(Boolean) ? out : null;
}

const clean = (s: string): string => s.trim().replace(/^["“]|["”]$/g, '').trim();

async function collect(gen: AsyncGenerator<string, string, void>): Promise<string> {
  for (;;) {
    const step = await gen.next();
    if (step.done) return step.value;
  }
}

/**
 * Tradução ao vivo. Só CONSOME trechos finais (`onSegment`); não toca no áudio nem na transcrição. Desligada = nada na RAM
 * (o motor offline é descarregado) e nenhum custo. Ordem do motor: IA configurada -> (falhou/sem IA) offline baixado -> aviso.
 */
export class TranslateService {
  private readonly jobs = new Map<string, Job>();
  private readonly noticed = new Set<string>();
  private aiDownUntil = 0;
  private readonly now: () => number;

  constructor(private readonly deps: TranslateDeps) {
    this.now = deps.now ?? Date.now;
  }

  isOn(dir: string): boolean {
    return this.jobs.has(dir);
  }
  language(dir: string): TranslateLang | null {
    return this.jobs.get(dir)?.lang ?? null;
  }

  /** Liga (ou troca o idioma de destino de) uma reunião. Trocar o idioma esvazia a fila: o que está na tela não muda. */
  start(dir: string, lang: TranslateLang, from: TranslateLang = 'pt'): void {
    const job = this.jobs.get(dir);
    if (job) {
      job.from = from;
      if (job.lang !== lang) {
        job.lang = lang;
        job.queue = [];
        job.context = [];
      }
      return;
    }
    this.jobs.set(dir, { lang, from, queue: [], context: [], running: false });
    this.noticed.delete(dir);
  }

  /** Desliga: esvazia a fila e, sem mais nenhuma reunião traduzindo, solta o motor offline da RAM. */
  stop(dir: string): void {
    this.jobs.delete(dir);
    if (this.jobs.size === 0) void this.deps.offline.unload().catch(() => {});
  }

  stopAll(): void {
    this.jobs.clear();
    void this.deps.offline.unload().catch(() => {});
  }

  /** Assinatura do evento `segment` da sessão (trecho FINAL). */
  async onSegment(dir: string, segment: Segment): Promise<void> {
    const job = this.jobs.get(dir);
    if (!job) return;
    const text = segment.text.trim();
    if (!text) return;
    const closedAt = this.now();
    let key: string;
    try {
      key = formatSegmentLine(await this.deps.startedAt(dir), segment).trim();
    } catch (err) {
      this.deps.onError?.(err);
      return;
    }
    if (this.jobs.get(dir) !== job) return;
    job.queue.push({ key, text, closedAt });
    while (job.queue.length > MAX_QUEUE) job.queue.shift();
    void this.pump(dir, job);
  }

  private async pump(dir: string, job: Job): Promise<void> {
    if (job.running) return;
    job.running = true;
    try {
      while (job.queue.length > 0 && this.jobs.get(dir) === job) {
        const batch = job.queue.splice(0, MAX_BATCH);
        const lang = job.lang;
        const results = await this.translate(dir, batch, job.context, lang, job.from);
        if (this.jobs.get(dir) !== job || job.lang !== lang) continue;
        for (let i = 0; i < batch.length; i++) {
          const r = results?.[i];
          if (!r) continue;
          const item = batch[i]!;
          const result: TranslateResult = { dir, key: item.key, lang, text: r.text, via: r.via, ms: this.now() - item.closedAt };
          appendTranslation(dir, { key: item.key, lang, text: r.text, via: r.via }).catch((err) => this.deps.onError?.(err));
          this.deps.onResult(result);
        }
        job.context.push(...batch.map((b) => b.text));
        job.context = job.context.slice(-CONTEXT_SEGMENTS);
      }
    } finally {
      job.running = false;
    }
  }

  /** null = não foi possível traduzir (aviso já emitido). */
  private async translate(dir: string, batch: Item[], context: readonly string[], lang: TranslateLang, from: TranslateLang): Promise<Array<{ text: string; via: TranslateVia }> | null> {
    const localMode = (this.deps.localMode ?? isLocalMode)();
    const offlineOn = this.deps.offlineEnabled !== false;
    const off = this.deps.offline.status();
    const offlineUsable = offlineOn && (off.state === 'installed' || off.state === 'ready' || off.state === 'loading') && offlineReady(off, from, lang);
    // idioma baixado: traduz offline (sem gastar a IA e sem rede); se o motor falhar, a IA assume
    if (offlineUsable) {
      const viaOffline = await this.viaOffline(batch, context, lang, from);
      if (viaOffline) return viaOffline;
    }
    let aiFailed = false;
    if (this.now() >= this.aiDownUntil) {
      const ai = await this.deps.ai().catch(() => null);
      // Modo 100% local: só IA local; qualquer outra nem é chamada
      if (ai && (!localMode || ai.local)) {
        try {
          return (await this.viaAi(ai.runner, dir, batch, context, lang)).map((text) => ({ text, via: 'ai' as const }));
        } catch (err) {
          if (err instanceof AiError && err.kind === 'cancelled') return null;
          aiFailed = true;
          this.aiDownUntil = this.now() + AI_COOLDOWN_MS;
        }
      }
    } else aiFailed = true;
    if (!offlineOn) {
      // só a IA configurada traduz: no Modo 100% local isso quer dizer IA local
      this.notice(dir, localMode && !aiFailed ? 'local-mode-ai-only' : 'ai-unavailable');
      return null;
    }
    this.notice(dir, localMode && !aiFailed ? 'local-mode-no-engine' : aiFailed ? 'ai-failed' : 'offline-needed');
    return null;
  }

  private async viaOffline(batch: Item[], context: readonly string[], lang: TranslateLang, from: TranslateLang): Promise<Array<{ text: string; via: TranslateVia }> | null> {
    try {
      const texts: string[] = [];
      for (const it of batch) texts.push(clean(await this.deps.offline.translate(it.text, { from, to: lang, context })));
      return texts.map((text) => ({ text, via: 'offline' as const }));
    } catch (err) {
      this.deps.onError?.(err);
      return null;
    }
  }

  private async viaAi(runner: AiRunner, dir: string, batch: Item[], context: readonly string[], lang: TranslateLang): Promise<string[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
    const call = async (items: Item[]) => {
      const out = await collect(runner.run({ system: translateSystem(lang), prompt: buildPrompt(items, context), signal: ctl.signal, egress: { kind: 'translate', dir } }));
      if (!out.trim()) throw new AiError('other', 'empty');
      return out;
    };
    try {
      if (batch.length === 1) return [clean(await call(batch))];
      const parsed = parseBatch(await call(batch), batch.length);
      if (parsed) return parsed.map(clean);
      const single: string[] = [];
      for (const it of batch) single.push(clean(await call([it])));
      return single;
    } catch (err) {
      if (ctl.signal.aborted) throw new AiError('network', 'timeout');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private notice(dir: string, notice: TranslateNotice): void {
    const k = `${dir}\n${notice}`;
    if (this.noticed.has(k)) return;
    this.noticed.add(k);
    this.deps.onNotice(dir, notice);
  }
}
