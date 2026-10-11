import { describe, expect, test, vi } from 'vitest';
import { createClaudeApiRunner, listClaudeModels } from '../../src/main/ai/claude-api';
import { createGeminiApiRunner, listGeminiModels } from '../../src/main/ai/gemini-api';
import type { FetchLike } from '../../src/main/ai/http-stream';
import { createOpenAiApiRunner, listOpenAiModels } from '../../src/main/ai/openai-api';
import { AiError, type AiRunner } from '../../src/main/ai/types';

const enc = new TextEncoder();

/** Resposta SSE em pedaços (cortando no meio, como a rede faz). */
function sse(text: string, status = 200): Response {
  const mid = Math.floor(text.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text.slice(0, mid)));
      c.enqueue(enc.encode(text.slice(mid)));
      c.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function drain(runner: AiRunner, signal?: AbortSignal) {
  const deltas: string[] = [];
  const gen = runner.run({ system: 'SYS', prompt: 'PROMPT', signal });
  for (;;) {
    const step = await gen.next();
    if (step.done) return { deltas, full: step.value };
    deltas.push(step.value);
  }
}
const failure = async (runner: AiRunner, signal?: AbortSignal) => (await drain(runner, signal).catch((e) => e)) as AiError;

const CLAUDE_KEY = 'sk-ant-api03-SEGREDO-do-claude-123456';
const OPENAI_KEY = 'sk-proj-SEGREDO-da-openai-1234567';
const GEMINI_KEY = 'AIzaSySEGREDO-do-gemini-1234567';

const claudeStream = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1"}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: ping\ndata: {"type":"ping"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Olá, "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"mundo"}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join('');

describe('Claude API', () => {
  test('faz streaming e manda chave só no cabeçalho, com o formato da Messages API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse(claudeStream));
    const runner = createClaudeApiRunner({ getKey: () => CLAUDE_KEY, fetch: fetchMock as FetchLike });
    const { deltas, full } = await drain(runner);
    expect(deltas).toEqual(['Olá, ', 'mundo']);
    expect(full).toBe('Olá, mundo');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(url).not.toContain(CLAUDE_KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(CLAUDE_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', stream: true, system: 'SYS', messages: [{ role: 'user', content: 'PROMPT' }] });
    expect(JSON.stringify(body)).not.toContain(CLAUDE_KEY);
  });

  test('usa o modelo escolhido', async () => {
    const fetchMock = vi.fn(async () => sse(claudeStream));
    await drain(createClaudeApiRunner({ getKey: () => CLAUDE_KEY, model: 'claude-opus-5-5', fetch: fetchMock as unknown as FetchLike }));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe('claude-opus-5-5');
  });

  test('401 → auth e 429 → rate-limit, em pt-BR, sem vazar a chave', async () => {
    const mk = (status: number, message: string) =>
      createClaudeApiRunner({ getKey: () => CLAUDE_KEY, fetch: (async () => json({ type: 'error', error: { type: 'x', message: `${message} ${CLAUDE_KEY}` } }, status)) as FetchLike });
    const auth = await failure(mk(401, 'invalid x-api-key'));
    expect(auth).toBeInstanceOf(AiError);
    expect(auth.kind).toBe('auth');
    expect(auth.message).toMatch(/chave de API do Claude foi recusada/);
    const limited = await failure(mk(429, 'rate limited'));
    expect(limited.kind).toBe('rate-limit');
    expect(limited.message).toMatch(/Limite de uso do Claude/);
    const other = await failure(mk(500, 'internal'));
    expect(other.kind).toBe('other');
    expect(other.message).not.toContain(CLAUDE_KEY);
    expect(other.message).toContain('***');
  });

  test('erro no meio do stream e sem chave', async () => {
    const midError = claudeStream.split('event: message_stop')[0] + 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    expect((await failure(createClaudeApiRunner({ getKey: () => CLAUDE_KEY, fetch: (async () => sse(midError)) as FetchLike }))).kind).toBe('rate-limit');
    expect((await failure(createClaudeApiRunner({ getKey: () => null }))).kind).toBe('auth');
  });

  test('falha de rede → network; cancelamento → cancelled; resposta vazia → other', async () => {
    expect((await failure(createClaudeApiRunner({ getKey: () => CLAUDE_KEY, fetch: (async () => { throw new TypeError('fetch failed'); }) as FetchLike }))).kind).toBe('network');
    const ac = new AbortController();
    ac.abort();
    expect((await failure(createClaudeApiRunner({ getKey: () => CLAUDE_KEY, fetch: (async () => sse(claudeStream)) as FetchLike }), ac.signal)).kind).toBe('cancelled');
    expect((await failure(createClaudeApiRunner({ getKey: () => CLAUDE_KEY, fetch: (async () => sse('event: message_stop\ndata: {"type":"message_stop"}\n\n')) as FetchLike }))).kind).toBe('other');
  });

  test('lista modelos', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] }));
    expect(await listClaudeModels(CLAUDE_KEY, fetchMock as unknown as FetchLike)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['x-api-key']).toBe(CLAUDE_KEY);
  });
});

const openaiStream = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"r1"}}\n\n',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Oi "}\n\n',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ChatGPT"}\n\n',
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1"}}\n\n',
].join('');

describe('OpenAI Responses API', () => {
  test('streaming, Bearer só no cabeçalho, store:false e system em instructions', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse(openaiStream));
    const { deltas, full } = await drain(createOpenAiApiRunner({ getKey: () => OPENAI_KEY, fetch: fetchMock as FetchLike }));
    expect(deltas).toEqual(['Oi ', 'ChatGPT']);
    expect(full).toBe('Oi ChatGPT');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: true, store: false, instructions: 'SYS', input: 'PROMPT' });
    expect(init.body as string).not.toContain(OPENAI_KEY);
  });

  test('401/429 amigáveis e erros do stream', async () => {
    const mk = (status: number) => createOpenAiApiRunner({ getKey: () => OPENAI_KEY, fetch: (async () => json({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }, status)) as FetchLike });
    const auth = await failure(mk(401));
    expect(auth.kind).toBe('auth');
    expect(auth.message).not.toContain(OPENAI_KEY);
    expect((await failure(mk(429))).kind).toBe('rate-limit');
    const failed = 'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"insufficient_quota","message":"quota"}}}\n\n';
    expect((await failure(createOpenAiApiRunner({ getKey: () => OPENAI_KEY, fetch: (async () => sse(failed)) as FetchLike }))).kind).toBe('rate-limit');
    const errEvent = 'event: error\ndata: {"type":"error","code":"invalid_api_key","message":"nope"}\n\n';
    expect((await failure(createOpenAiApiRunner({ getKey: () => OPENAI_KEY, fetch: (async () => sse(errEvent)) as FetchLike }))).kind).toBe('auth');
  });

  test('lista só modelos de texto', async () => {
    const data = ['gpt-5', 'gpt-5-mini', 'o4-mini', 'text-embedding-3-large', 'gpt-4o-audio-preview', 'whisper-1', 'dall-e-3', 'gpt-image-1'].map((id) => ({ id }));
    expect(await listOpenAiModels(OPENAI_KEY, (async () => json({ data })) as FetchLike)).toEqual(['gpt-5', 'gpt-5-mini', 'o4-mini']);
  });
});

const geminiStream = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Olá "}],"role":"model"}}]}\r\n\r\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"pensando","thought":true},{"text":"Gemini"}],"role":"model"},"finishReason":"STOP"}]}\r\n\r\n',
].join('');

describe('Gemini API', () => {
  test('a chave vai no cabeçalho x-goog-api-key e nunca na URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse(geminiStream));
    const { deltas, full } = await drain(createGeminiApiRunner({ getKey: () => GEMINI_KEY, model: 'gemini-2.5-pro', fetch: fetchMock as FetchLike }));
    expect(deltas).toEqual(['Olá ', 'Gemini']); // ignora "thought"
    expect(full).toBe('Olá Gemini');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    expect(url).not.toContain(GEMINI_KEY);
    expect(url).not.toContain('key=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(GEMINI_KEY);
    expect(JSON.parse(init.body as string)).toMatchObject({ systemInstruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: 'PROMPT' }] }] });
  });

  test('recusa nome de modelo que escaparia do caminho da URL', async () => {
    const fetchMock = vi.fn();
    const err = await failure(createGeminiApiRunner({ getKey: () => GEMINI_KEY, model: '../../evil?x=', fetch: fetchMock as unknown as FetchLike }));
    expect(err.kind).toBe('other');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('401/400 de chave inválida → auth, 429 → rate-limit, sem vazar a chave', async () => {
    const mk = (status: number, message: string) => createGeminiApiRunner({ getKey: () => GEMINI_KEY, fetch: (async () => json({ error: { code: status, message: `${message} ${GEMINI_KEY}`, status: 'X' } }, status)) as FetchLike });
    const bad = await failure(mk(400, 'API key not valid. Please pass a valid API key.'));
    expect(bad.kind).toBe('auth');
    expect(bad.message).not.toContain(GEMINI_KEY);
    expect((await failure(mk(401, 'unauth'))).kind).toBe('auth');
    expect((await failure(mk(429, 'quota'))).kind).toBe('rate-limit');
    const inStream = 'data: {"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}\n\n';
    expect((await failure(createGeminiApiRunner({ getKey: () => GEMINI_KEY, fetch: (async () => sse(inStream)) as FetchLike }))).kind).toBe('rate-limit');
  });

  test('lista modelos que geram conteúdo, sem o prefixo models/', async () => {
    const models = [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    ];
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json({ models }));
    expect(await listGeminiModels(GEMINI_KEY, fetchMock as FetchLike)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(fetchMock.mock.calls[0]![0]).not.toContain(GEMINI_KEY);
  });
});
