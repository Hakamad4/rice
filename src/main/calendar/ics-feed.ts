/**
 * "Assinar por link (ICS)": a URL privada do calendário (Outlook/Microsoft 365, Google, iCloud, Fastmail…) é lida de tempos em tempos.
 * A URL é um SEGREDO (quem a tem lê o calendário): fica cifrada como as chaves (safeStorage: DPAPI no Windows, Keychain no Mac), nunca vai inteira
 * para o renderer (só o domínio) e nunca é escrita em log nem em mensagem de erro. Só https (webcal:// vira https://), com limite de tamanho e de tempo.
 */
import { t } from '../i18n';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenCrypto } from '../ai/secrets';
import { icsEvents } from './ics';
import type { CalEvent } from './google-events';

export const ICS_REFRESH_MS = 10 * 60_000;
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_TIMEOUT_MS = 20_000;
const FILE = 'ics-url.bin';
/** Janela lida: o que começou há até 12 h (ainda em andamento) e os próximos 14 dias. */
const PAST_MS = 12 * 3_600_000;
const AHEAD_MS = 14 * 24 * 3_600_000;

export type UrlCheck = { ok: true; url: string; host: string } | { ok: false; message: string };

/** Valida e normaliza o link: só https (webcal:// e webcals:// viram https://), sem usuário/senha, sem espaços, tamanho razoável. */
export function normalizeIcsUrl(input: unknown): UrlCheck {
  let raw = String(input ?? '').trim();
  if (!raw) return { ok: false, message: t('ics.err.empty') };
  if (raw.length > 2048 || /[\s\u0000-\u001f\u007f"'<>\\]/.test(raw)) return { ok: false, message: t('ics.err.invalid') };
  raw = raw.replace(/^webcals?:\/\//i, 'https://');
  if (/^http:\/\//i.test(raw) || !/^https:\/\//i.test(raw)) return { ok: false, message: t('ics.err.protocol') };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, message: t('ics.err.invalid') };
  }
  if (u.username || u.password || !u.hostname.includes('.')) return { ok: false, message: t('ics.err.invalid') };
  return { ok: true, url: u.href, host: u.hostname };
}

/** Resposta mínima do fetch (o de verdade e o falso dos testes). */
export type IcsResponse = { ok: boolean; status: number; url?: string; headers?: { get(name: string): string | null }; body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null; text(): Promise<string> };
export type IcsFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'follow' }) => Promise<IcsResponse>;

export class IcsError extends Error {}

/** Lê o corpo respeitando o limite de tamanho (sem carregar na memória um arquivo gigante). */
async function readLimited(res: IcsResponse): Promise<string> {
  const declared = Number(res.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > ICS_MAX_BYTES) throw new IcsError(t('ics.err.big'));
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text) > ICS_MAX_BYTES) throw new IcsError(t('ics.err.big'));
    return text;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value!.byteLength;
    if (size > ICS_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new IcsError(t('ics.err.big'));
    }
    chunks.push(Buffer.from(value!));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type IcsDeps = {
  dir: string;
  crypto: TokenCrypto;
  fetch: IcsFetch;
  now?: () => number;
  /** Modo 100% local: a leitura é bloqueada (devolve a mensagem) e nada é consultado. */
  blocked?: () => string | null;
  localZone?: string;
};

export type IcsStatus = { configured: boolean; /** Só o domínio: o link inteiro nunca sai do main. */ host?: string; count: number; lastAt?: string; error?: string; blocked?: string };

export class IcsSubscription {
  private cached: { url: string; host: string } | null | undefined;
  private state: { count: number; lastAt?: string; error?: string } = { count: 0 };
  /** Geração: trocar ou remover o link invalida leituras em andamento. */
  private gen = 0;

  constructor(private readonly deps: IcsDeps) {}

  private now = () => (this.deps.now ?? Date.now)();

  private async load(): Promise<{ url: string; host: string } | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const o = JSON.parse(this.deps.crypto.decrypt(await readFile(join(this.deps.dir, FILE)))) as { url?: unknown };
      const check = normalizeIcsUrl(o.url);
      this.cached = check.ok ? { url: check.url, host: check.host } : null;
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  async status(): Promise<IcsStatus> {
    const link = await this.load();
    const blocked = this.deps.blocked?.() ?? undefined;
    return { configured: Boolean(link), ...(link ? { host: link.host } : {}), count: this.state.count, ...(this.state.lastAt ? { lastAt: this.state.lastAt } : {}), ...(this.state.error ? { error: this.state.error } : {}), ...(blocked ? { blocked } : {}) };
  }

  /** Lê o calendário agora. Erros viram mensagem curta SEM a URL; em erro o chamador mantém a lista anterior. */
  async fetchEvents(): Promise<CalEvent[]> {
    const link = await this.load();
    if (!link) return [];
    const blocked = this.deps.blocked?.();
    if (blocked) throw new IcsError(blocked);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICS_TIMEOUT_MS);
    try {
      let res: IcsResponse;
      try {
        res = await this.deps.fetch(link.url, { headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' }, signal: controller.signal, redirect: 'follow' });
      } catch {
        throw new IcsError(t('ics.err.network', { host: link.host }));
      }
      if (res.url && !/^https:\/\//i.test(res.url)) throw new IcsError(t('ics.err.protocol')); // um redirecionamento para http
      if (!res.ok) throw new IcsError(t('ics.err.status', { status: res.status, host: link.host }));
      const text = await readLimited(res);
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new IcsError(t('ics.err.not-ics', { host: link.host }));
      const now = this.now();
      return icsEvents(text, { from: now - PAST_MS, to: now + AHEAD_MS }, this.deps.localZone);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Lê e guarda o resultado no estado (contagem, hora, erro); devolve os eventos novos ou null se falhou/foi invalidado. */
  async refresh(): Promise<CalEvent[] | null> {
    const gen = this.gen;
    try {
      const events = await this.fetchEvents();
      if (gen !== this.gen) return null;
      this.state = { count: events.length, lastAt: new Date(this.now()).toISOString() };
      return events;
    } catch (err) {
      if (gen !== this.gen) return null;
      this.state = { ...this.state, error: err instanceof IcsError ? err.message : t('ics.err.generic') };
      return null;
    }
  }

  /** Valida o link, lê uma vez (para o usuário saber já se funciona) e só então guarda. */
  async save(raw: unknown): Promise<{ ok: true; count: number; events: CalEvent[] } | { ok: false; message: string }> {
    const check = normalizeIcsUrl(raw);
    if (!check.ok) return check;
    const blocked = this.deps.blocked?.();
    if (blocked) return { ok: false, message: blocked };
    const previous = this.cached;
    this.cached = { url: check.url, host: check.host };
    let events: CalEvent[];
    try {
      events = await this.fetchEvents();
    } catch (err) {
      this.cached = previous; // não guarda um link que não funciona
      return { ok: false, message: err instanceof IcsError ? err.message : t('ics.err.generic') };
    }
    try {
      await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
      await writeFile(join(this.deps.dir, FILE), this.deps.crypto.encrypt(JSON.stringify({ url: check.url })), { mode: 0o600 });
    } catch {
      this.cached = previous;
      return { ok: false, message: t('ics.err.keychain') };
    }
    this.gen++;
    this.state = { count: events.length, lastAt: new Date(this.now()).toISOString() };
    return { ok: true, count: events.length, events };
  }

  async remove(): Promise<void> {
    this.gen++;
    this.cached = null;
    this.state = { count: 0 };
    await rm(join(this.deps.dir, FILE), { force: true });
  }
}
