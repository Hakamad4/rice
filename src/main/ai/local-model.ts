import { totalmem } from 'node:os';
import { t } from '../i18n';
import { aiError } from './errors';
import { request, streamText, type FetchLike, type SseStep } from './http-stream';
import { AiError, type AiRunner } from './types';

/**
 * Modelo local: Ollama (`/api/chat`, NDJSON) ou qualquer servidor compatível com OpenAI em localhost (LM Studio, llama.cpp server,
 * MLX: `/v1/chat/completions`, SSE). SÓ localhost: é isso que garante que "local" é local de verdade (e o Modo 100% local).
 */
export type LocalKind = 'ollama' | 'openai';

/**
 * Os servidores locais que o Rice conhece, com a porta padrão conferida na documentação oficial de cada um:
 * Ollama 11434 (docs.ollama.com/api), LM Studio 1234 (exemplos do OpenAI-compat), llama-server 9931 (README atual do llama.cpp;
 * versões antigas usavam 8080), mlx_lm.server 8080 (SERVER.md do mlx-lm) e Jan 1337 (Local API Server). "Outro" = qualquer servidor
 * compatível com OpenAI em localhost, com o endereço livre (continua só localhost).
 */
export const LOCAL_SERVERS = [
  { id: 'ollama', name: 'Ollama', port: 11434, kind: 'ollama' },
  { id: 'lmstudio', name: 'LM Studio', port: 1234, kind: 'openai' },
  { id: 'llamacpp', name: 'llama.cpp', port: 9931, kind: 'openai' },
  { id: 'mlx', name: 'MLX', port: 8080, kind: 'openai' },
  { id: 'jan', name: 'Jan', port: 1337, kind: 'openai' },
] as const;
export type LocalServerId = (typeof LOCAL_SERVERS)[number]['id'] | 'auto' | 'other';
export const LOCAL_SERVER_IDS: readonly string[] = ['auto', ...LOCAL_SERVERS.map((s) => s.id), 'other'];
export const isLocalServerId = (v: unknown): v is LocalServerId => typeof v === 'string' && LOCAL_SERVER_IDS.includes(v);
/** Portas que a detecção automática testa, em paralelo (a 8080 é também a do llama-server antigo; já está na lista pelo MLX). */
export const DETECT_PORTS: readonly number[] = LOCAL_SERVERS.map((s) => s.port);
export const defaultUrlOf = (id: LocalServerId): string | null => {
  const server = LOCAL_SERVERS.find((s) => s.id === id);
  return server ? `http://127.0.0.1:${server.port}` : null;
};
/** Nome do servidor pela porta (a 8080 é do MLX e do llama-server antigo: o nome diz os dois). */
export function serverNameOf(url: string): string {
  const port = Number(new URL(url).port || 0);
  if (port === 8080) return 'MLX / llama.cpp';
  return LOCAL_SERVERS.find((s) => s.port === port)?.name ?? t('ai.local.server-generic');
}
export const NUM_CTX_OPTIONS = [8192, 16384, 32768] as const;
export const DEFAULT_NUM_CTX = 16384;
/** Modelos locais são lentos (Mac de 8-16 GB): bem mais que os 10 min das APIs. */
export const LOCAL_TIMEOUT_MS = 30 * 60_000;
const PROBE_TIMEOUT_MS = 1500;

export type LocalModel = { id: string; /** bytes, quando o servidor informa */ size?: number };
export type LocalServer = { kind: LocalKind; url: string; models: LocalModel[]; /** Nome amigável ('LM Studio'). */ name: string };
export type LocalConfig = { url?: string; numCtx?: number; /** Qual servidor: 'auto' (detecta; padrão), um conhecido ou 'other'. */ server?: LocalServerId };

export const isNumCtx = (n: unknown): n is (typeof NUM_CTX_OPTIONS)[number] => NUM_CTX_OPTIONS.includes(n as 8192);

/** Hosts aceitos: o próprio computador. Nada de 0.0.0.0, IP da rede ou nome de domínio. */
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
export const isLocalHost = (hostname: string): boolean => LOCAL_HOSTNAMES.has(hostname.toLowerCase());

/** Endereço do servidor (só a origem). Qualquer host que não seja localhost é recusado, com mensagem clara. */
export function parseLocalUrl(raw: string): string {
  const text = String(raw ?? '').trim();
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new AiError('other', t('ai.local.bad-url'));
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new AiError('other', t('ai.local.bad-url'));
  if (!isLocalHost(u.hostname)) throw new AiError('other', t('ai.local.not-local'));
  return u.origin;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,119}$/;
export const isLocalModelName = (id: string): boolean => MODEL_ID.test(id);

type Reply = { status: number; json: unknown | null };
/** GET curto: devolve o status e o JSON (se houver). null = ninguém respondeu (nada escutando na porta, tempo esgotado). */
async function get(fetchImpl: FetchLike, url: string): Promise<Reply | null> {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: {}, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    let json: unknown | null = null;
    if (res.ok) json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return null;
  }
}

type ProbeOptions = {
  /** true (detecção automática): só vale quem devolve uma lista de modelos válida (não confunde com um servidor qualquer na porta). false: qualquer resposta HTTP basta (servidor que não lista modelos). */
  strict?: boolean;
  /** Tipo de API esperado (do seletor de servidor); sem ele tenta Ollama e depois OpenAI. */
  kind?: LocalKind;
};

/** Consulta o servidor: `/api/tags` (Ollama) e/ou `/v1/models` (compatível com OpenAI). null = não respondeu. Só localhost. */
export async function probeLocalServer(rawUrl: string, fetchImpl: FetchLike, options: ProbeOptions = {}): Promise<LocalServer | null> {
  const url = parseLocalUrl(rawUrl);
  const name = serverNameOf(url);
  if (options.kind !== 'openai') {
    const tags = (await get(fetchImpl, `${url}/api/tags`))?.json as { models?: Array<{ name?: unknown; model?: unknown; size?: unknown }> } | null | undefined;
    if (tags && Array.isArray(tags.models)) {
      const models = tags.models.flatMap((m) => {
        const id = typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : '';
        const size = num(m.size);
        return isLocalModelName(id) ? [{ id, ...(size ? { size } : {}) }] : [];
      });
      return { kind: 'ollama', url, models, name: 'Ollama' };
    }
    if (options.kind === 'ollama') return null;
  }
  const reply = await get(fetchImpl, `${url}/v1/models`);
  const list = reply?.json as { data?: Array<{ id?: unknown }> } | null | undefined;
  if (list && Array.isArray(list.data)) {
    return { kind: 'openai', url, name, models: list.data.flatMap((m) => (typeof m.id === 'string' && isLocalModelName(m.id) ? [{ id: m.id }] : [])) };
  }
  // alguém respondeu, mas sem lista de modelos (alguns servidores só têm o chat): vale quando o usuário escolheu esse servidor
  if (reply && !options.strict) return { kind: 'openai', url, name, models: [] };
  return null;
}

/** Testa TODAS as portas padrão (Ollama, LM Studio, llama.cpp, MLX, Jan), em paralelo e com tempo curto; devolve os que responderam, na ordem da lista. */
export async function detectLocalServers(fetchImpl: FetchLike): Promise<LocalServer[]> {
  const found = await Promise.all(DETECT_PORTS.map((port) => probeLocalServer(`http://127.0.0.1:${port}`, fetchImpl, { strict: true })));
  return found.filter((s): s is LocalServer => s !== null);
}

/**
 * Servidor a usar. Endereço digitado: esse (qualquer servidor compatível). Servidor escolhido no seletor: a porta padrão dele.
 * "Automático" (padrão): o primeiro que responder nas portas conhecidas. "Outro" sem endereço: nenhum.
 */
export async function resolveLocalServer(config: LocalConfig, fetchImpl: FetchLike): Promise<LocalServer | null> {
  const choice = config.server ?? 'auto';
  const known = LOCAL_SERVERS.find((s) => s.id === choice);
  if (config.url?.trim()) {
    const found = await probeLocalServer(config.url, fetchImpl, { strict: false, ...(known ? { kind: known.kind } : {}) });
    return found && known ? { ...found, name: known.name } : found;
  }
  if (known) {
    const found = await probeLocalServer(defaultUrlOf(known.id)!, fetchImpl, { strict: false, kind: known.kind });
    return found ? { ...found, name: known.name } : null;
  }
  if (choice === 'other') return null;
  return (await detectLocalServers(fetchImpl))[0] ?? null;
}

const EMBEDDING_NAME = /embed|(^|[-_:/])(bge|minilm|e5|gte)([-_:.]|$)|nomic|mxbai|rerank|arctic-embed/i;
/** Modelos de embedding/rerank não geram texto: nunca entram na escolha automática. */
export const isTextModel = (id: string): boolean => !EMBEDDING_NAME.test(id);
/** O modelo pode ocupar até este tanto da RAM total do Mac (o resto fica para o sistema, o app e o contexto). */
export const RAM_FRACTION = 0.6;

/**
 * Modelo principal em "Automático": o MAIOR modelo de texto que cabe na RAM (tamanho ≤ 60% da memória total), porque modelo
 * maior escreve notas melhores. Se nenhum cabe, o menor de texto; sem tamanhos (servidores compatíveis com OpenAI), o primeiro.
 */
export function largestFittingModel(models: readonly LocalModel[], totalRamBytes: number): string | undefined {
  const text = models.filter((m) => isTextModel(m.id));
  const sized = text.filter((m) => m.size !== undefined);
  if (sized.length === 0) return text[0]?.id;
  const fitting = sized.filter((m) => (m.size ?? 0) <= totalRamBytes * RAM_FRACTION).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return (fitting[0] ?? sized.sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0])?.id;
}

/** "qwen3:8b" -> "Qwen3 8B"; "llama3.2:3b" -> "Llama3.2 3B"; "hf.co/user/model:Q4_K_M" -> "Model Q4_K_M". */
export function friendlyModelName(id: string): string {
  const [rawBase = '', tag = ''] = id.split(':');
  const base = (rawBase.split('/').pop() ?? rawBase).replace(/[-_]+/g, ' ').trim();
  const name = base.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  const size = /^\d+(\.\d+)?b$/i.test(tag) ? tag.toUpperCase() : tag && tag !== 'latest' ? tag : '';
  return size ? `${name} ${size}` : name;
}

/** Modelo "pequeno" primeiro: o menor tamanho informado pelo servidor (sem tamanho, o primeiro da lista). */
export function smallestLocalModel(models: readonly LocalModel[]): string | undefined {
  const sized = models.filter((m) => m.size !== undefined).sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  return (sized[0] ?? models[0])?.id;
}

const VISION_NAME = /llava|vision|(^|[-_:/])vl([-_:.]|$)|qwen[\d.]*-?vl|minicpm-v|moondream|bakllava|gemma3|pixtral|mllama/i;
const visionCache = new Map<string, boolean>();

/** O modelo aceita imagens? Ollama diz em `/api/show` (`capabilities` com `vision`); nos demais vale o nome (llava, qwen2.5vl…). */
export async function isVisionModel(server: Pick<LocalServer, 'kind' | 'url'>, model: string, fetchImpl: FetchLike): Promise<boolean> {
  const key = `${server.url}|${model}`;
  const hit = visionCache.get(key);
  if (hit !== undefined) return hit;
  let vision = VISION_NAME.test(model);
  if (server.kind === 'ollama') {
    try {
      const res = await fetchImpl(`${server.url}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (res.ok) {
        const caps = ((await res.json()) as { capabilities?: unknown }).capabilities;
        if (Array.isArray(caps)) vision = caps.includes('vision');
      }
    } catch {
      // sem resposta: fica o palpite pelo nome
    }
  }
  visionCache.set(key, vision);
  return vision;
}
export const clearLocalCaches = (): void => visionCache.clear();

/** Raciocínio (`<think>…</think>`) de modelos como o Qwen3 não entra na resposta; funciona mesmo cortado entre pedaços. */
export function createThinkFilter(): { feed(chunk: string): string; flush(): string } {
  let inside = false;
  let pending = '';
  const OPEN = '<think>';
  const CLOSE = '</think>';
  return {
    feed(chunk) {
      pending += chunk;
      let out = '';
      for (;;) {
        const tag = inside ? CLOSE : OPEN;
        const at = pending.indexOf(tag);
        if (at >= 0) {
          if (!inside) out += pending.slice(0, at);
          pending = pending.slice(at + tag.length);
          inside = !inside;
          continue;
        }
        // guarda o que pode ser o começo de uma marca cortada ao meio
        let keep = 0;
        for (let n = Math.min(tag.length - 1, pending.length); n > 0; n--) {
          if (tag.startsWith(pending.slice(-n))) {
            keep = n;
            break;
          }
        }
        if (!inside) out += pending.slice(0, pending.length - keep);
        pending = pending.slice(pending.length - keep);
        return out;
      }
    },
    flush() {
      const rest = inside ? '' : pending;
      pending = '';
      return rest;
    },
  };
}

/** Texto do erro do servidor → mensagem amigável (modelo que não existe, falta de memória). */
function friendlyServerError(message: string, model: string): AiError {
  if (/not found|no such model|unknown model|does not exist/i.test(message) && /model/i.test(message)) return new AiError('other', t('ai.local.model-missing', { model }));
  if (/memory|out of memory|oom|insufficient/i.test(message)) return new AiError('other', t('ai.local.memory', { model }));
  return aiError('local-model', 'other', message);
}

type RunnerConfig = { getConfig: () => Promise<LocalConfig> | LocalConfig; model?: string; fetch?: FetchLike; /** RAM total do Mac (bytes) para a escolha automática; padrão: `os.totalmem()`. */ totalRam?: () => number };

export function createLocalRunner(config: RunnerConfig): AiRunner {
  const fetchImpl: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  return {
    async *run({ system, prompt, signal, images }) {
      const cfg = await config.getConfig();
      const server = await resolveLocalServer(cfg, fetchImpl); // recusa host que não seja localhost antes de qualquer envio
      if (!server) throw aiError('local-model', 'network');
      // modelo escolhido > o maior que cabe na RAM > (servidor compatível que não lista modelos) o que ele já carregou
      const model = config.model || largestFittingModel(server.models, (config.totalRam ?? totalmem)()) || '';
      if (!model && server.kind === 'ollama') throw new AiError('other', t('ai.local.no-model-installed'));
      const useImages = images && images.length > 0 && (await isVisionModel(server, model, fetchImpl)) ? images : [];
      const numCtx = isNumCtx(cfg.numCtx) ? cfg.numCtx : DEFAULT_NUM_CTX;
      try {
        if (server.kind === 'ollama') return yield* streamOllama({ fetchImpl, url: server.url, model, system, prompt, signal, images: useImages, numCtx });
        return yield* streamOpenAiCompat({ fetchImpl, url: server.url, model, system, prompt, signal, images: useImages });
      } catch (err) {
        if (err instanceof AiError && err.kind !== 'cancelled' && err.kind !== 'network') throw friendlyServerError(err.message, model);
        throw err;
      }
    },
  };
}

type StreamArgs = { fetchImpl: FetchLike; url: string; model: string; system: string; prompt: string; signal?: AbortSignal | undefined; images: Array<{ mime: string; data: string }> };

/** `/api/chat` com `stream: true`: uma linha JSON por pedaço (`message.content`), a última com `done: true`. Erros: `{ "error": "…" }`. */
async function* streamOllama(a: StreamArgs & { numCtx: number }): AsyncGenerator<string, string, void> {
  const res = await request('local-model', a.fetchImpl, {
    url: `${a.url}/api/chat`,
    headers: {},
    timeoutMs: LOCAL_TIMEOUT_MS,
    body: {
      model: a.model,
      stream: true,
      options: { num_ctx: a.numCtx },
      messages: [
        { role: 'system', content: a.system },
        { role: 'user', content: a.prompt, ...(a.images.length > 0 ? { images: a.images.map((i) => i.data) } : {}) },
      ],
    },
  }, '', a.signal);
  if (!res.body) throw aiError('local-model', 'other', t('ai.err.no-body'));
  const filter = createThinkFilter();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  const handle = (line: string): { text: string; done: boolean } => {
    if (!line.trim()) return { text: '', done: false };
    let o: { error?: unknown; message?: { content?: unknown }; done?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      return { text: '', done: false };
    }
    if (typeof o.error === 'string') throw friendlyServerError(o.error, a.model);
    const content = typeof o.message?.content === 'string' ? o.message.content : '';
    return { text: filter.feed(content), done: o.done === true };
  };
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const out = handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (out.text) {
          full += out.text;
          yield out.text;
        }
        if (out.done) buffer = '';
      }
    }
    const last = handle(buffer);
    const tail = last.text + filter.flush();
    if (tail) {
      full += tail;
      yield tail;
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (a.signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
    throw aiError('local-model', 'network', (err as Error).message);
  }
  if (a.signal?.aborted) throw new AiError('cancelled', t('ai.err.cancelled'));
  if (!full.trim()) throw aiError('local-model', 'other', t('ai.err.empty-response'));
  return full;
}

/** `/v1/chat/completions` com `stream: true` (SSE): `choices[0].delta.content`, termina em `[DONE]`. */
async function* streamOpenAiCompat(a: StreamArgs): AsyncGenerator<string, string, void> {
  const filter = createThinkFilter();
  const step = (event: { event: string; data: string }): SseStep => {
    if (event.data.trim() === '[DONE]') return { done: true };
    let o: { error?: { message?: unknown } | string; choices?: Array<{ delta?: { content?: unknown } }> };
    try {
      o = JSON.parse(event.data);
    } catch {
      return {};
    }
    if (o.error) throw friendlyServerError(typeof o.error === 'string' ? o.error : String(o.error.message ?? ''), a.model);
    const content = o.choices?.[0]?.delta?.content;
    const text = typeof content === 'string' ? filter.feed(content) : '';
    return text ? { delta: text } : {};
  };
  const userContent = a.images.length > 0
    ? [{ type: 'text', text: a.prompt }, ...a.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))]
    : a.prompt;
  return yield* streamText('local-model', a.fetchImpl, {
    url: `${a.url}/v1/chat/completions`,
    headers: {},
    timeoutMs: LOCAL_TIMEOUT_MS,
    body: { ...(a.model ? { model: a.model } : {}), stream: true, messages: [{ role: 'system', content: a.system }, { role: 'user', content: userContent }] },
  }, '', step, { signal: a.signal });
}
