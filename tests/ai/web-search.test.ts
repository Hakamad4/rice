import { describe, expect, test, vi } from 'vitest';
import { buildClaudeArgs } from '../../src/main/claude/runner';
import { parseClaudeLine, webSearchLinks } from '../../src/main/claude/stream';
import { runChat } from '../../src/main/ai/chat-run';
import { claudeApiStep, createClaudeApiRunner } from '../../src/main/ai/claude-api';
import { buildCodexArgs, CODEX_DENY_FEATURES } from '../../src/main/ai/codex-cli';
import { createGeminiApiRunner, geminiStep } from '../../src/main/ai/gemini-api';
import { createOpenAiApiRunner, openaiStep } from '../../src/main/ai/openai-api';
import { AI_PROVIDERS, type AiRunner, type AiRunOptions, type WebSource } from '../../src/main/ai/types';
import { cleanSources, linksInText, safeHttpsUrl, webSearchSupported } from '../../src/main/ai/web-search';

const enc = new TextEncoder();
const sse = (text: string) => new Response(new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(enc.encode(text)), c.close()) }), { headers: { 'content-type': 'text/event-stream' } });
const body = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));

async function drain(runner: AiRunner, options: Partial<AiRunOptions> = {}) {
  const gen = runner.run({ system: 'S', prompt: 'P', ...options });
  for (;;) {
    const step = await gen.next();
    if (step.done) return step.value;
  }
}

describe('suporte por provedor', () => {
  test('CLIs e APIs com busca restrita ficam disponíveis; OpenCode e Antigravity não', () => {
    expect(AI_PROVIDERS.filter(webSearchSupported)).toEqual(['claude-sub', 'claude-api', 'chatgpt-sub', 'openai-api', 'gemini-api']);
    expect(webSearchSupported('opencode-sub')).toBe(false);
    expect(webSearchSupported('agy-sub')).toBe(false);
  });
});

describe('args dos CLIs com a busca ligada e desligada (nunca shell)', () => {
  test('Claude: só WebSearch e WebFetch, sem Bash/Edit/Write/Read, sem MCP', () => {
    const on = buildClaudeArgs('SYS', undefined, { mcpServers: [], web: true });
    expect(on[on.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    const allowed = on.slice(on.indexOf('--allowedTools') + 1, on.indexOf('--allowedTools') + 3);
    expect(allowed).toEqual(['WebSearch', 'WebFetch']);
    expect(on.join(' ')).not.toMatch(/Bash|Edit|Write|NotebookEdit|Read|Grep|Glob|--add-dir|mcp__/);
    expect(on).toContain('--strict-mcp-config');
    expect(on).toContain('--disable-slash-commands');
    const off = buildClaudeArgs('SYS', undefined, { mcpServers: [] });
    expect(off[off.indexOf('--tools') + 1]).toBe('');
    expect(off).toContain('--safe-mode');
    expect(off).not.toContain('--allowedTools');
  });

  test('Codex: web_search live, sandbox read-only, ignora o config do usuário e sem shell', () => {
    const on = buildCodexArgs('/w', undefined, ['shell_tool', 'unified_exec'], { web: true });
    expect(on).toContain('web_search="live"');
    expect(on[on.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(on).toContain('--ignore-user-config');
    expect(on).toEqual(expect.arrayContaining(['--disable', 'shell_tool', 'unified_exec']));
    expect(on.join(' ')).not.toMatch(/--search|danger|full-auto|--yolo/);
    const off = buildCodexArgs('/w', undefined, ['shell_tool', 'unified_exec']);
    expect(off).not.toContain('web_search="live"');
    expect(CODEX_DENY_FEATURES).toEqual(expect.arrayContaining(['shell_tool', 'unified_exec']));
  });
});

describe('APIs: a ferramenta de busca só entra com a busca ligada', () => {
  const claudeOk = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';

  test('Anthropic: server tool web_search; desligada, sem tools', async () => {
    const fetchMock = vi.fn(async () => sse(claudeOk));
    const runner = createClaudeApiRunner({ getKey: () => 'k', fetch: fetchMock });
    await drain(runner);
    expect(body(fetchMock).tools).toBeUndefined();
    fetchMock.mockClear();
    await drain(runner, { tools: { web: true, mcp: false, onCall: () => {} } });
    expect(body(fetchMock).tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  });

  test('OpenAI: tool web_search da Responses API', async () => {
    const fetchMock = vi.fn(async () => sse('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed"}\n\n'));
    const runner = createOpenAiApiRunner({ getKey: () => 'k', fetch: fetchMock });
    await drain(runner);
    expect(body(fetchMock).tools).toBeUndefined();
    fetchMock.mockClear();
    await drain(runner, { tools: { web: true, mcp: false, onCall: () => {} } });
    expect(body(fetchMock).tools).toEqual([{ type: 'web_search' }]);
  });

  test('Gemini: grounding com google_search', async () => {
    const fetchMock = vi.fn(async () => sse('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n'));
    const runner = createGeminiApiRunner({ getKey: () => 'k', fetch: fetchMock });
    await drain(runner);
    expect(body(fetchMock).tools).toBeUndefined();
    fetchMock.mockClear();
    await drain(runner, { tools: { web: true, mcp: false, onCall: () => {} } });
    expect(body(fetchMock).tools).toEqual([{ google_search: {} }]);
  });

  test('as fontes chegam pelo callback e a chave nunca vai no corpo', async () => {
    const stream = [
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"web_search_tool_result","content":[{"type":"web_search_result","url":"https://nodejs.org/en","title":"Node.js"},{"type":"web_search_result","url":"javascript:alert(1)","title":"x"}]}}\n\n',
      claudeOk,
    ].join('');
    const fetchMock = vi.fn(async () => sse(stream));
    const got: WebSource[] = [];
    await drain(createClaudeApiRunner({ getKey: () => 'SEGREDO', fetch: fetchMock }), { tools: { web: true, mcp: false, onCall: () => {}, onSources: (s) => got.push(...s) } });
    expect(got.map((s) => s.url)).toContain('https://nodejs.org/en');
    expect(JSON.stringify(body(fetchMock))).not.toContain('SEGREDO');
  });
});

describe('extração das fontes', () => {
  test('Anthropic: erro da busca (content é objeto) não gera fontes', () => {
    const ev = { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', content_block: { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } }) };
    expect(claudeApiStep(ev)).toEqual({});
  });
  test('OpenAI: url_citation das anotações', () => {
    const ev = { event: '', data: JSON.stringify({ type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://a.com/x', title: 'A' } }) };
    expect(openaiStep(ev)).toEqual({ sources: [{ url: 'https://a.com/x', title: 'A' }] });
  });
  test('Gemini: groundingChunks.web', () => {
    const ev = { event: '', data: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'oi' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'g1.com' } }, {}] } }] }) };
    expect(geminiStep(ev)).toEqual({ delta: 'oi', sources: [{ url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'g1.com' }] });
  });
  test('Claude CLI: lê "Links: [...]" do resultado do WebSearch e ignora outras ferramentas', () => {
    const text = 'Web search results for query: "x"\n\nLinks: [{"title":"A [1]","url":"https://a.com/p"},{"title":"B","url":"https://b.org"}]\n\nResumo com [colchetes].';
    expect(webSearchLinks(text)).toEqual([{ title: 'A [1]', url: 'https://a.com/p' }, { title: 'B', url: 'https://b.org' }]);
    expect(webSearchLinks('Links: [{"url":"https://a.com"}]')).toEqual([]);
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });
    expect(parseClaudeLine(line)).toMatchObject({ kind: 'sources', sources: [{ url: 'https://a.com/p' }, { url: 'https://b.org' }] });
    expect(parseClaudeLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'conteúdo qualquer' }] } }))).toBeNull();
  });
  test('Codex: links em Markdown da resposta', () => {
    expect(linksInText('Veja [Docs](https://nodejs.org/docs) e [x](http://inseguro.com) e [y](javascript:1).')).toEqual([{ title: 'Docs', url: 'https://nodejs.org/docs' }, ]);
  });
});

describe('cleanSources', () => {
  test('só https, sem repetir, título limpo, citadas primeiro, no máximo 6', () => {
    const raw: WebSource[] = [
      { url: 'http://inseguro.com/a', title: 'http' },
      { url: 'https://user:pw@evil.com/a', title: 'credenciais' },
      { url: 'javascript:alert(1)', title: 'js' },
      { url: 'https://a.com/1#x', title: '  Primeira\n‮ linha ' },
      { url: 'https://a.com/1#y', title: 'repetida' },
      { url: 'https://www.b.com/2', title: '' },
      { url: 'https://c.com/3', title: 'C' },
      ...Array.from({ length: 8 }, (_, i) => ({ url: `https://m${i}.com/p`, title: `M${i}` })),
    ];
    const out = cleanSources(raw, 'a resposta cita https://c.com/3 aqui');
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ url: 'https://c.com/3', title: 'C' });
    expect(out[1]!.title).toBe('Primeira linha');
    expect(out.map((s) => s.url).filter((u) => u.includes('a.com'))).toHaveLength(1);
    expect(out.every((s) => s.url.startsWith('https://') && !s.url.includes('@'))).toBe(true);
    expect(cleanSources([{ url: 'https://www.b.com/2', title: '' }])[0]!.title).toBe('b.com');
    expect(safeHttpsUrl('https://localhost/x')).toBeNull();
    // utm_*, "/" final e mesmo título no mesmo site contam como a mesma fonte
    const dup = cleanSources([
      { url: 'https://inmotionhosting.com/blog/node?utm_source=openai', title: 'Node 26' },
      { url: 'https://inmotionhosting.com/blog/node/', title: 'Node 26' },
      { url: 'https://inmotionhosting.com/other', title: 'node 26' },
      { url: 'https://inmotionhosting.com/q?id=1', title: 'A' },
      { url: 'https://inmotionhosting.com/q?id=2', title: 'B' },
    ]);
    expect(dup.map((d) => d.title)).toEqual(['Node 26', 'A', 'B']);
  });
});

describe('runChat com busca', () => {
  const lang = 'pt-BR' as const;
  function spy() {
    const seen: AiRunOptions[] = [];
    const runner: AiRunner = {
      async *run(o) {
        seen.push(o);
        o.tools?.onSources?.([{ url: 'https://nodejs.org', title: 'Node' }]);
        yield 'Veja https://nodejs.org';
        return 'Veja https://nodejs.org';
      },
    };
    return { runner, seen };
  }

  test('desligada: o runner nem recebe `tools` (nada muda)', async () => {
    const { runner, seen } = spy();
    const onSources = vi.fn();
    await runChat(runner, { system: 's', prompt: 'p' }, { useTools: false, language: lang, onDelta: () => {}, onSources });
    expect(seen[0]!.tools).toBeUndefined();
    expect(onSources).not.toHaveBeenCalled();
  });

  test('ligada: web sem MCP (a busca sozinha não carrega os MCPs do usuário) e fontes entregues no fim', async () => {
    const { runner, seen } = spy();
    const onSources = vi.fn();
    await runChat(runner, { system: 's', prompt: 'p' }, { useTools: false, web: true, language: lang, onDelta: () => {}, onSources });
    expect(seen[0]!.tools).toMatchObject({ web: true, mcp: false });
    expect(seen[0]!.tools!.folder).toBeUndefined();
    expect(onSources).toHaveBeenCalledWith([{ url: 'https://nodejs.org/', title: 'Node' }]);
  });

  test('ligada com MCP do chat: os dois valem; sem fontes estruturadas usa os links do texto', async () => {
    const runner: AiRunner = { async *run() { yield 'x'; return 'Fonte: [Docs](https://nodejs.org/docs)'; } };
    const onSources = vi.fn();
    await runChat(runner, { system: 's', prompt: 'p' }, { useTools: true, web: true, language: lang, onDelta: () => {}, onSources });
    expect(onSources).toHaveBeenCalledWith([{ url: 'https://nodejs.org/docs', title: 'Docs' }]);
  });

  test('o system da pergunta com busca pede fontes pelo nome (sem URLs); sem busca o system não muda', async () => {
    const { runner, seen } = spy();
    await runChat(runner, { system: 'SYS', prompt: 'p' }, { useTools: false, web: true, language: lang, onDelta: () => {} });
    await runChat(runner, { system: 'SYS', prompt: 'p' }, { useTools: false, language: lang, onDelta: () => {} });
    expect(seen[0]!.system).toMatch(/^SYS\n\n.*busca na web.*URLs/s);
    expect(seen[1]!.system).toBe('SYS');
  });
});
