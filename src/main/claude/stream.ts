export type ClaudeEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'tool'; server: string; tool: string; detail?: string }
  | { kind: 'sources'; sources: Array<{ url: string; title: string }> }
  | { kind: 'result'; isError: boolean; text: string };

export type ClaudeErrorKind = 'not-installed' | 'not-logged-in' | 'rate-limited' | 'failed' | 'cancelled';

const NATIVE_TOOLS: Record<string, { server: 'web' | 'file'; field: string }> = {
  WebSearch: { server: 'web', field: 'query' },
  WebFetch: { server: 'web', field: 'url' },
  Read: { server: 'file', field: 'file_path' },
  Grep: { server: 'file', field: 'pattern' },
  Glob: { server: 'file', field: 'pattern' },
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export function parseClaudeLine(line: string): ClaudeEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;

  // início de uma chamada de ferramenta MCP (`mcp__<servidor>__<ferramenta>`); só este evento, para contar cada chamada uma vez
  if (data.type === 'stream_event' && isObject(data.event) && data.event.type === 'content_block_start' && isObject(data.event.content_block)) {
    const block = data.event.content_block;
    const m = block.type === 'tool_use' && typeof block.name === 'string' ? /^mcp__(.+?)__(.+)$/.exec(block.name) : null;
    return m ? { kind: 'tool', server: m[1]!, tool: m[2]! } : null;
  }

  // ferramentas nativas liberadas no War room: o `input` (consulta, URL, arquivo) só vem completo na mensagem do assistente
  if (data.type === 'assistant' && isObject(data.message) && Array.isArray(data.message.content)) {
    for (const block of data.message.content) {
      if (!isObject(block) || block.type !== 'tool_use' || typeof block.name !== 'string' || !isObject(block.input)) continue;
      const kind = NATIVE_TOOLS[block.name];
      if (!kind) continue;
      const raw = block.input[kind.field];
      return { kind: 'tool', server: kind.server, tool: block.name, ...(typeof raw === 'string' ? { detail: raw.slice(0, 300) } : {}) };
    }
  }

  // resultado do WebSearch: "Web search results for query: …\n\nLinks: [{"title":…,"url":…}, …]\n\n<resumo>"
  if (data.type === 'user' && isObject(data.message) && Array.isArray(data.message.content)) {
    for (const block of data.message.content) {
      if (!isObject(block) || block.type !== 'tool_result') continue;
      const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((c) => (isObject(c) && typeof c.text === 'string' ? c.text : '')).join('\n') : '';
      const sources = webSearchLinks(text);
      if (sources.length > 0) return { kind: 'sources', sources };
    }
    return null;
  }

  if (data.type === 'stream_event' && isObject(data.event) && data.event.type === 'content_block_delta') {
    const delta = data.event.delta;
    if (isObject(delta) && delta.type === 'text_delta' && typeof delta.text === 'string') {
      return { kind: 'delta', text: delta.text };
    }
    return null;
  }

  if (data.type === 'result') {
    return { kind: 'result', isError: data.is_error === true, text: typeof data.result === 'string' ? data.result : '' };
  }

  return null;
}

export function classifyClaudeError(message: string): ClaudeErrorKind {
  if (/not logged in|\/login|authentication|invalid api key|oauth/i.test(message)) return 'not-logged-in';
  if (/limit/i.test(message)) return 'rate-limited';
  return 'failed';
}

/** Os links do texto do resultado do WebSearch (JSON logo depois de "Links: "); qualquer outra coisa não gera fontes. */
export function webSearchLinks(text: string): Array<{ url: string; title: string }> {
  if (!text.startsWith('Web search results for query')) return [];
  const start = text.indexOf('Links: [');
  if (start < 0) return [];
  const from = start + 'Links: '.length;
  // o array termina no primeiro "]" que o fecha de verdade; tenta cada "]" até o JSON fechar
  for (let end = text.indexOf(']', from); end >= 0; end = text.indexOf(']', end + 1)) {
    try {
      const list: unknown = JSON.parse(text.slice(from, end + 1));
      if (!Array.isArray(list)) return [];
      return list.flatMap((r) => (isObject(r) && typeof r.url === 'string' ? [{ url: r.url, title: typeof r.title === 'string' ? r.title : '' }] : []));
    } catch {
      // ainda não é o "]" final
    }
  }
  return [];
}
