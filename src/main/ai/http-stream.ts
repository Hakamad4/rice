import { t } from '../i18n';
import { aiError, classifyHttpStatus } from './errors';
import { parseSse, type SseEvent } from './sse';
import { AiError, RUN_TIMEOUT_MS, type AiProvider, type AiRunOptions, type WebSource } from './types';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpRequest = { url: string; headers: Record<string, string>; body?: unknown; method?: 'GET' | 'POST'; /** Tempo máximo da resposta inteira (padrão: RUN_TIMEOUT_MS). Modelos locais precisam de mais. */ timeoutMs?: number };

/** O que um provedor extrai de cada evento SSE. */
export type SseStep = { delta?: string; error?: AiError; done?: boolean; sources?: WebSource[] };

const ERROR_BODY_LIMIT = 4000;

function messageOf(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof json.error === 'string') return json.error;
    if (typeof json.error?.message === 'string') return json.error.message;
    if (typeof json.message === 'string') return json.message;
  } catch {
    // corpo não era JSON
  }
  return body;
}

/** Sinal que aborta pelo cancelamento do usuário ou pelo tempo máximo. */
function limits(signal: AbortSignal | undefined, timeoutMs = RUN_TIMEOUT_MS): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, timedOut: () => timeout.aborted };
}

/** Faz a requisição e devolve a resposta; erros HTTP viram `AiError` amigável, sem a chave. */
export async function request(provider: AiProvider, fetchImpl: FetchLike, req: HttpRequest, secret: string, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
  const lim = limits(signal, req.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(req.url, {
      method: req.method ?? 'POST',
      headers: { ...(req.body === undefined ? {} : { 'content-type': 'application/json' }), ...req.headers },
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
      signal: lim.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
    if (lim.timedOut()) throw aiError(provider, 'other', t('ai.err.timeout'));
    throw aiError(provider, 'network', (err as Error).message, [secret]);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT);
    throw aiError(provider, classifyHttpStatus(res.status, body), messageOf(body) || `HTTP ${res.status}`, [secret]);
  }
  return res;
}

export async function getJson(provider: AiProvider, fetchImpl: FetchLike, req: HttpRequest, secret: string): Promise<unknown> {
  const res = await request(provider, fetchImpl, { ...req, method: 'GET' }, secret);
  return res.json();
}

/** Executa uma requisição de streaming SSE: emite o texto de cada evento e devolve o texto inteiro. */
export async function* streamText(
  provider: AiProvider,
  fetchImpl: FetchLike,
  req: HttpRequest,
  secret: string,
  step: (event: SseEvent) => SseStep,
  { signal, onSources }: Pick<AiRunOptions, 'signal'> & { onSources?: (sources: WebSource[]) => void },
): AsyncGenerator<string, string, void> {
  const res = await request(provider, fetchImpl, req, secret, signal);
  if (!res.body) throw aiError(provider, 'other', t('ai.err.no-body'));
  let full = '';
  try {
    for await (const event of parseSse(res.body as unknown as AsyncIterable<Uint8Array>)) {
      const out = step(event);
      if (out.error) throw out.error;
      if (out.sources?.length) onSources?.(out.sources);
      if (out.delta) {
        full += out.delta;
        yield out.delta;
      }
      if (out.done) break;
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
    throw aiError(provider, 'network', (err as Error).message, [secret]);
  }
  if (signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
  if (!full.trim()) throw aiError(provider, 'other', t('ai.err.empty-response'));
  return full;
}
