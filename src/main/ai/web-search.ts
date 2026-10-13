import type { AiProvider, WebSource } from './types';

/**
 * Busca na internet no chat ("Buscar na web"), provedor a provedor. Conferido nas CLIs/APIs, sem chutar:
 *  - claude-sub: `--tools WebSearch,WebFetch` (só essas duas ferramentas nativas; nada de Bash, Edit ou Read)
 *  - chatgpt-sub: `-c web_search="live"` (o `--search` do `codex` é a mesma opção, mas só existe fora do `exec`), sandbox read-only, sem shell
 *  - claude-api: server tool `web_search`; openai-api: tool `web_search` da Responses API; gemini-api: `google_search` (grounding)
 *  - opencode-sub e agy-sub: indisponíveis. O opencode só libera a busca pelas permissões do agente, que o Rice nega por completo
 *    (a ferramenta `websearch` roda fora do sistema de pedidos), e o agy é um agente com ~60 ferramentas sem como liberar só a busca.
 */
const SUPPORTED: readonly AiProvider[] = ['claude-sub', 'chatgpt-sub', 'claude-api', 'openai-api', 'gemini-api'];

export const webSearchSupported = (provider: AiProvider): boolean => SUPPORTED.includes(provider);

const MAX_SOURCES = 6;
const MAX_TITLE = 140;

/** Só https, sem credenciais embutidas, sem espaços; devolve a URL normalizada ou null. */
export function safeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || /\s/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Texto de título seguro para mostrar (uma linha, sem caracteres de controle). */
const cleanTitle = (raw: unknown): string =>
  typeof raw === 'string'
    ? raw
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE)
    : '';

/** Links em Markdown `[título](https://…)` do texto da resposta; serve quando o provedor não manda as fontes estruturadas (Codex). */
export function linksInText(text: string): WebSource[] {
  const found: WebSource[] = [];
  for (const m of text.matchAll(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g)) found.push({ title: m[1]!, url: m[2]! });
  return found;
}

function dedupeKey(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.href.replace(/\/$/, '');
}

/**
 * Normaliza as fontes: só https, sem repetir (mesmo endereço sem o `#fragmento`), título limpo (cai no domínio),
 * as que a resposta cita (pelo endereço) primeiro e no máximo {@link MAX_SOURCES}.
 */
export function cleanSources(raw: readonly WebSource[], answer = ''): WebSource[] {
  const seen = new Set<string>();
  const out: Array<WebSource & { cited: boolean }> = [];
  for (const s of raw) {
    const url = safeHttpsUrl(s?.url);
    if (!url) continue;
    const key = dedupeKey(url);
    const title = cleanTitle(s.title);
    // mesma página (sem #fragmento, utm_*, "/" final) ou mesmo título no mesmo site: uma linha só
    const same = title && title !== domainOf(url) ? `${domainOf(url)}|${title.toLowerCase()}` : '';
    if (seen.has(key) || (same && seen.has(same))) continue;
    seen.add(key);
    if (same) seen.add(same);
    out.push({ url, title: title || domainOf(url), cited: answer.includes(key) || answer.includes(s.url) });
  }
  return [...out.filter((s) => s.cited), ...out.filter((s) => !s.cited)].slice(0, MAX_SOURCES).map(({ url, title }) => ({ url, title }));
}

/** Fontes lidas do histórico em disco: formato antigo (sem o campo) ou lixo viram lista vazia; o resto passa pelo mesmo filtro https. */
export function storedSources(raw: unknown): WebSource[] {
  if (!Array.isArray(raw)) return [];
  return cleanSources(raw.filter((s): s is WebSource => typeof s === 'object' && s !== null && typeof (s as WebSource).url === 'string'));
}
