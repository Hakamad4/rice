import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { localBudget } from '../../src/main/ai/context-budget';
import { createRunnerFor, installedLocalModels, isModelFor, lightModelFor, resolveAiSettings, type RunnerDeps } from '../../src/main/ai/factory';
import type { FetchLike } from '../../src/main/ai/http-stream';
import { clearLocalCaches, createLocalRunner, defaultUrlOf, DETECT_PORTS, LOCAL_SERVERS, resolveLocalServer, serverNameOf, createThinkFilter, DEFAULT_NUM_CTX, detectLocalServers, friendlyModelName, isVisionModel, largestFittingModel, parseLocalUrl, probeLocalServer, smallestLocalModel } from '../../src/main/ai/local-model';
import { aiStatus, invalidateAiStatus, listModels, testProvider } from '../../src/main/ai/service';
import { AI_PROVIDERS, AiError, type AiRunner } from '../../src/main/ai/types';
import { webSearchSupported } from '../../src/main/ai/web-search';
import { splitTranscript } from '../../src/main/session/long-notes';

const enc = new TextEncoder();
const body = (parts: string[]) => new ReadableStream<Uint8Array>({ start: (c) => (parts.forEach((p) => c.enqueue(enc.encode(p))), c.close()) });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const GB = 1_000_000_000;
const TAGS = { models: [{ name: 'qwen3:8b', size: 5_200_000_000 }, { name: 'llama3.2:3b', size: 2_000_000_000 }] };
const nd = (...lines: object[]) => lines.map((l) => `${JSON.stringify(l)}\n`);

/** Servidor falso: Ollama em :11434 (a menos que `ollama: false`) e/ou compatível com OpenAI em :1234. */
function fake(opts: { ollama?: boolean; openai?: boolean; chat?: (url: string, init: RequestInit) => Response; show?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f: FetchLike = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.port === '11434' && opts.ollama !== false) {
      if (u.pathname === '/api/tags') return json(TAGS);
      if (u.pathname === '/api/show') return json(opts.show ?? { capabilities: ['completion'] });
      if (u.pathname === '/api/chat') return opts.chat!(url, init);
    }
    if (u.port === '1234' && opts.openai) {
      if (u.pathname === '/v1/models') return json({ data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'llava-1.6' }] });
      if (u.pathname === '/v1/chat/completions') return opts.chat!(url, init);
    }
    throw new TypeError('fetch failed');
  });
  return { f, calls };
}
async function drain(runner: AiRunner, options: Partial<Parameters<AiRunner['run']>[0]> = {}) {
  const deltas: string[] = [];
  const gen = runner.run({ system: 'SYS', prompt: 'PROMPT', ...options });
  for (;;) {
    const step = await gen.next();
    if (step.done) return { deltas, full: step.value };
    deltas.push(step.value);
  }
}
afterEach(() => {
  clearLocalCaches();
  invalidateAiStatus();
});

describe('só localhost', () => {
  test('aceita 127.0.0.1, localhost e ::1 (com ou sem porta e esquema) e devolve só a origem', () => {
    expect(parseLocalUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(parseLocalUrl('localhost:1234')).toBe('http://localhost:1234');
    expect(parseLocalUrl('http://[::1]:8080/v1/chat?x=1')).toBe('http://[::1]:8080');
    expect(parseLocalUrl(' HTTP://LocalHost ')).toBe('http://localhost');
  });

  test('recusa qualquer outro host, com a mensagem clara (nome de domínio, IP da rede, 0.0.0.0, truques de subdomínio)', () => {
    for (const bad of ['https://api.openai.com', 'http://192.168.0.10:11434', 'http://10.0.0.5', 'http://0.0.0.0:11434', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://evil.com/127.0.0.1', 'http://127.0.0.2', 'http://[::ffff:8.8.8.8]', 'http://meu-servidor.local:11434']) {
      expect(() => parseLocalUrl(bad), bad).toThrow(/próprio computador/);
    }
  });

  test('lixo, esquema estranho e credenciais embutidas viram "endereço inválido"', () => {
    for (const bad of ['', 'ftp://127.0.0.1', 'file:///etc/passwd', 'http://user:pw@127.0.0.1', 'javascript:alert(1)']) expect(() => parseLocalUrl(bad), bad).toThrow(/Endereço inválido/);
  });

  test('o runner recusa um endereço não local ANTES de qualquer requisição (configuração adulterada)', async () => {
    const { f, calls } = fake();
    const runner = createLocalRunner({ getConfig: () => ({ url: 'https://api.openai.com' }), fetch: f });
    await expect(drain(runner)).rejects.toThrow(/próprio computador/);
    expect(calls).toEqual([]);
    await expect(probeLocalServer('http://example.com', f)).rejects.toBeInstanceOf(AiError);
    expect(calls).toEqual([]);
  });
});

describe('detecção dos servidores', () => {
  test('acha o Ollama (:11434) e o servidor compatível com OpenAI (:1234), com modelos e tamanhos', async () => {
    const { f } = fake({ openai: true });
    const found = await detectLocalServers(f);
    expect(found.map((s) => s.kind)).toEqual(['ollama', 'openai']);
    expect(found[0]).toMatchObject({ url: 'http://127.0.0.1:11434', models: [{ id: 'qwen3:8b', size: 5_200_000_000 }, { id: 'llama3.2:3b', size: 2_000_000_000 }] });
    expect(found[1]!.models.map((m) => m.id)).toEqual(['qwen2.5-7b-instruct', 'llava-1.6']);
  });

  test('só um deles, ou nenhum: o que não responde fica de fora, sem lançar', async () => {
    expect((await detectLocalServers(fake({ ollama: false, openai: true }).f)).map((s) => s.kind)).toEqual(['openai']);
    expect(await detectLocalServers(fake({ ollama: false }).f)).toEqual([]);
  });

  test('endereço editável: sonda o que o usuário configurou (e nada além disso)', async () => {
    const { f, calls } = fake({ openai: true });
    const server = await probeLocalServer('http://localhost:1234', f);
    expect(server).toMatchObject({ kind: 'openai', url: 'http://localhost:1234' });
    expect(calls.every((c) => new URL(c.url).port === '1234')).toBe(true);
  });

  test('menor modelo: pelo tamanho, senão o primeiro', () => {
    expect(smallestLocalModel([{ id: 'a', size: 9 }, { id: 'b', size: 2 }])).toBe('b');
    expect(smallestLocalModel([{ id: 'x' }, { id: 'y' }])).toBe('x');
    expect(smallestLocalModel([])).toBeUndefined();
  });
});

describe('modelo principal em Automático: o MAIOR de texto que cabe na RAM', () => {
  const m = (id: string, gb?: number) => ({ id, ...(gb !== undefined ? { size: gb * GB } : {}) });
  const LIST = [m('llama3.2:3b', 2), m('qwen3:4b', 2.5), m('qwen3:8b', 5.2), m('qwen3:14b', 9.3), m('qwen3:32b', 20)];

  test('varias listas e RAMs (limite = 60% da memória total)', () => {
    expect(largestFittingModel(LIST, 16 * GB)).toBe('qwen3:14b'); // 9,3 <= 9,6
    expect(largestFittingModel(LIST, 18 * GB)).toBe('qwen3:14b');
    expect(largestFittingModel(LIST, 24 * GB)).toBe('qwen3:14b'); // 14,4: o de 20 GB não cabe
    expect(largestFittingModel(LIST, 36 * GB)).toBe('qwen3:32b'); // 21,6
    expect(largestFittingModel(LIST, 8 * GB)).toBe('qwen3:4b'); // 4,8: o de 5,2 não cabe
    expect(largestFittingModel(LIST, 15 * GB)).toBe('qwen3:8b'); // 9,0: o de 9,3 não cabe
    expect(largestFittingModel([m('qwen3:8b', 5.2), m('llama3.2:3b', 2)], 8 * GB)).toBe('llama3.2:3b');
  });

  test('nenhum cabe: o menor de texto; um só modelo: ele mesmo', () => {
    expect(largestFittingModel(LIST, 2 * GB)).toBe('llama3.2:3b');
    expect(largestFittingModel([m('qwen3:8b', 5.2)], 4 * GB)).toBe('qwen3:8b');
  });

  test('embeddings e rerank nunca entram, mesmo sendo os maiores ou os únicos com tamanho', () => {
    const list = [m('nomic-embed-text:latest', 0.27), m('bge-m3:latest', 1.2), m('mxbai-embed-large', 0.67), m('qwen3-embedding:8b', 4.7), m('llama3.2:3b', 2)];
    expect(largestFittingModel(list, 16 * GB)).toBe('llama3.2:3b');
    expect(largestFittingModel([m('nomic-embed-text', 0.27), m('bge-m3', 1.2)], 16 * GB)).toBeUndefined();
    expect(largestFittingModel([], 16 * GB)).toBeUndefined();
  });

  test('servidor sem tamanhos (compatível com OpenAI): o primeiro modelo de texto', () => {
    expect(largestFittingModel([m('text-embedding-nomic'), m('qwen2.5-7b-instruct'), m('llava-1.6')], 16 * GB)).toBe('qwen2.5-7b-instruct');
  });

  test('o "leve" continua sendo o menor (e o principal escolhe outro)', () => {
    expect(smallestLocalModel(LIST)).toBe('llama3.2:3b');
    expect(largestFittingModel(LIST, 16 * GB)).not.toBe(smallestLocalModel(LIST));
  });

  test('nome amigável para o rótulo "Automático: …"', () => {
    expect(friendlyModelName('qwen3:8b')).toBe('Qwen3 8B');
    expect(friendlyModelName('llama3.2:3b')).toBe('Llama3.2 3B');
    expect(friendlyModelName('gemma3:latest')).toBe('Gemma3');
    expect(friendlyModelName('hf.co/Org/Some-Model-GGUF:Q4_K_M')).toBe('Some Model GGUF Q4_K_M');
    expect(friendlyModelName('qwen2.5-7b-instruct')).toBe('Qwen2.5 7b Instruct');
  });

  test('o runner sem modelo escolhido usa o maior que cabe; com RAM menor, outro; escolha explícita sempre vale', async () => {
    const tags = { models: [{ name: 'llama3.2:3b', size: 2 * GB }, { name: 'qwen3:8b', size: 5.2 * GB }, { name: 'nomic-embed-text', size: 0.3 * GB }] };
    const chat = () => new Response(body(nd({ message: { content: 'ok' }, done: true })));
    const modelSent = async (ram: number, model?: string) => {
      const calls: string[] = [];
      const f: FetchLike = async (url, init) => {
        if (url.endsWith('/api/tags')) return json(tags);
        if (url.endsWith('/api/chat')) calls.push(JSON.parse(String(init.body)).model);
        return url.endsWith('/api/chat') ? chat() : json({});
      };
      await drain(createLocalRunner({ getConfig: () => ({}), fetch: f, totalRam: () => ram, ...(model ? { model } : {}) }));
      return calls[0];
    };
    expect(await modelSent(16 * GB)).toBe('qwen3:8b');
    expect(await modelSent(8 * GB)).toBe('llama3.2:3b');
    expect(await modelSent(16 * GB, 'llama3.2:3b')).toBe('llama3.2:3b');
  });
});

describe('streaming Ollama (/api/chat)', () => {
  const stream = (parts: string[]) => () => new Response(body(parts), { headers: { 'content-type': 'application/x-ndjson' } });

  test('lê NDJSON cortado no meio, manda num_ctx e stream, e junta o texto', async () => {
    const lines = nd({ message: { content: 'Olá, ' } }, { message: { content: 'mundo' } }, { message: { content: '' }, done: true });
    const joined = lines.join('');
    const { f, calls } = fake({ chat: stream([joined.slice(0, 20), joined.slice(20, 55), joined.slice(55)]) });
    const runner = createLocalRunner({ getConfig: () => ({ numCtx: 8192 }), fetch: f, totalRam: () => 16 * GB });
    const out = await drain(runner);
    expect(out.deltas.join('')).toBe('Olá, mundo');
    expect(out.full).toBe('Olá, mundo');
    const chat = calls.find((c) => c.url.endsWith('/api/chat'))!;
    const sent = JSON.parse(String(chat.init.body));
    expect(sent).toMatchObject({ model: 'qwen3:8b', stream: true, options: { num_ctx: 8192 } }); // sem escolha: o maior que cabe na RAM (16 GB)
    expect(sent.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'PROMPT' }]);
  });

  test('o padrão do contexto é 16k e o modelo escolhido vale', async () => {
    const { f, calls } = fake({ chat: stream(nd({ message: { content: 'ok' }, done: true })) });
    await drain(createLocalRunner({ getConfig: () => ({}), model: 'qwen3:8b', fetch: f }));
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith('/api/chat'))!.init.body));
    expect(sent).toMatchObject({ model: 'qwen3:8b', options: { num_ctx: DEFAULT_NUM_CTX } });
    expect(DEFAULT_NUM_CTX).toBe(16384);
  });

  test('o raciocínio <think>…</think> do Qwen3 não entra na resposta', async () => {
    const { f } = fake({ chat: stream(nd({ message: { content: '<thi' } }, { message: { content: 'nk>pensando…</th' } }, { message: { content: 'ink>Resposta final' }, done: true })) });
    const out = await drain(createLocalRunner({ getConfig: () => ({}), fetch: f }));
    expect(out.full).toBe('Resposta final');
  });

  test('modelo de visão (capabilities no /api/show) recebe as imagens; sem visão, nada de imagens', async () => {
    const image = [{ mime: 'image/png', data: 'AAAA' }];
    const withVision = fake({ show: { capabilities: ['completion', 'vision'] }, chat: stream(nd({ message: { content: 'ok' }, done: true })) });
    await drain(createLocalRunner({ getConfig: () => ({}), model: 'gemma3:4b', fetch: withVision.f }), { images: image });
    expect(JSON.parse(String(withVision.calls.find((c) => c.url.endsWith('/api/chat'))!.init.body)).messages[1]).toMatchObject({ images: ['AAAA'] });
    clearLocalCaches();
    const noVision = fake({ chat: stream(nd({ message: { content: 'ok' }, done: true })) });
    await drain(createLocalRunner({ getConfig: () => ({}), model: 'qwen3:8b', fetch: noVision.f }), { images: image });
    expect(JSON.parse(String(noVision.calls.find((c) => c.url.endsWith('/api/chat'))!.init.body)).messages[1]).not.toHaveProperty('images');
  });

  test('modelo que não existe, falta de memória, servidor fora do ar e sem modelos: mensagens claras', async () => {
    const missing = fake({ chat: () => json({ error: "model 'x:1b' not found" }, 404) });
    await expect(drain(createLocalRunner({ getConfig: () => ({}), model: 'x:1b', fetch: missing.f }))).rejects.toThrow(/x:1b.*não está instalado.*ollama pull/s);
    const memory = fake({ chat: () => json({ error: 'model requires more system memory (12.0 GiB) than is available (6.1 GiB)' }, 500) });
    await expect(drain(createLocalRunner({ getConfig: () => ({}), model: 'qwen3:8b', fetch: memory.f }))).rejects.toThrow(/falta memória/);
    const midStream = fake({ chat: () => new Response(body(nd({ message: { content: 'a' } }, { error: 'out of memory' })), { status: 200 }) });
    await expect(drain(createLocalRunner({ getConfig: () => ({}), fetch: midStream.f }))).rejects.toThrow(/falta memória/);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(drain(createLocalRunner({ getConfig: () => ({}), fetch: down }))).rejects.toThrow(/Ollama.*aberto/);
    const empty = vi.fn(async (url: string) => (url.endsWith('/api/tags') ? json({ models: [] }) : Promise.reject(new TypeError('x'))));
    await expect(drain(createLocalRunner({ getConfig: () => ({}), fetch: empty as unknown as FetchLike }))).rejects.toThrow(/Nenhum modelo instalado/);
  });

  test('cancelar interrompe', async () => {
    const { f } = fake({ chat: (_u, init) => new Response(new ReadableStream({ start: (c) => (init.signal as AbortSignal).addEventListener('abort', () => c.error(new DOMException('abort', 'AbortError'))) })) });
    const controller = new AbortController();
    const run = drain(createLocalRunner({ getConfig: () => ({}), fetch: f }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('streaming compatível com OpenAI (/v1/chat/completions)', () => {
  const sse = (...events: string[]) => () => new Response(body(events.map((e) => `data: ${e}\n\n`)), { headers: { 'content-type': 'text/event-stream' } });

  test('lê delta.content até [DONE]; não manda num_ctx (o servidor decide)', async () => {
    const { f, calls } = fake({ ollama: false, openai: true, chat: sse('{"choices":[{"delta":{"content":"Oi "}}]}', '{"choices":[{"delta":{"content":"você"}}]}', '[DONE]') });
    const out = await drain(createLocalRunner({ getConfig: () => ({ url: 'http://127.0.0.1:1234' }), model: 'qwen2.5-7b-instruct', fetch: f }));
    expect(out.full).toBe('Oi você');
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith('/v1/chat/completions'))!.init.body));
    expect(sent).toMatchObject({ model: 'qwen2.5-7b-instruct', stream: true });
    expect(sent).not.toHaveProperty('options');
    expect(sent.messages[1].content).toBe('PROMPT');
  });

  test('imagens só com modelo de visão (pelo nome: llava, qwen2.5vl…)', async () => {
    const image = [{ mime: 'image/png', data: 'AAAA' }];
    const vision = fake({ ollama: false, openai: true, chat: sse('{"choices":[{"delta":{"content":"ok"}}]}', '[DONE]') });
    await drain(createLocalRunner({ getConfig: () => ({ url: 'http://127.0.0.1:1234' }), model: 'llava-1.6', fetch: vision.f }), { images: image });
    expect(JSON.parse(String(vision.calls.find((c) => c.url.endsWith('/v1/chat/completions'))!.init.body)).messages[1].content[1]).toMatchObject({ type: 'image_url' });
    clearLocalCaches();
    const plain = fake({ ollama: false, openai: true, chat: sse('{"choices":[{"delta":{"content":"ok"}}]}', '[DONE]') });
    await drain(createLocalRunner({ getConfig: () => ({ url: 'http://127.0.0.1:1234' }), model: 'qwen2.5-7b-instruct', fetch: plain.f }), { images: image });
    expect(JSON.parse(String(plain.calls.find((c) => c.url.endsWith('/v1/chat/completions'))!.init.body)).messages[1].content).toBe('PROMPT');
    expect(await isVisionModel({ kind: 'openai', url: 'http://127.0.0.1:1234' }, 'Qwen2.5VL-7B', plain.f)).toBe(true);
  });

  test('erro do servidor no corpo vira mensagem amigável', async () => {
    const { f } = fake({ ollama: false, openai: true, chat: () => json({ error: { message: 'The model `zzz` does not exist' } }, 404) });
    await expect(drain(createLocalRunner({ getConfig: () => ({ url: 'http://127.0.0.1:1234' }), model: 'zzz', fetch: f }))).rejects.toThrow(/zzz.*não está instalado/s);
  });
});

describe('filtro de raciocínio', () => {
  test('marcas cortadas em qualquer ponto e texto antes e depois', () => {
    const text = 'antes<think>segredo interno</think>depois';
    for (let cut = 1; cut < text.length; cut++) {
      const f = createThinkFilter();
      expect(f.feed(text.slice(0, cut)) + f.feed(text.slice(cut)) + f.flush(), `corte em ${cut}`).toBe('antesdepois');
    }
    const f = createThinkFilter();
    expect(f.feed('1 < 2 e a <b>negrito</b>') + f.flush()).toBe('1 < 2 e a <b>negrito</b>');
  });
});

describe('contexto e orçamento', () => {
  test('16k: limites do map-reduce e do chat derivados do num_ctx; menor contexto, menor limite', () => {
    const b8 = localBudget(8192);
    const b16 = localBudget(16384);
    const b32 = localBudget(32768);
    expect(b16).toEqual({ directMaxChars: 37152, partMaxChars: 23006, chatChars: 20433, globalChars: 20433 });
    expect(b8.directMaxChars).toBeLessThan(b16.directMaxChars);
    expect(b16.directMaxChars).toBeLessThan(b32.directMaxChars);
    expect(b32.directMaxChars).toBeLessThanOrEqual(60_000); // nunca passa do teto da nuvem
    for (const b of [b8, b16, b32]) expect(b.partMaxChars).toBeLessThanOrEqual(b.directMaxChars);
  });

  test('transcrição longa sintética: cada parte cabe no orçamento do contexto escolhido', () => {
    const line = (n: number) => `**[${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor((n % 3600) / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}] Eu:** ${'palavra '.repeat(24)}`;
    const transcript = Array.from({ length: 1200 }, (_, i) => line(i * 5)).join('\n\n'); // ~100 min, ~270 mil caracteres
    for (const numCtx of [8192, 16384, 32768]) {
      const budget = localBudget(numCtx);
      expect(transcript.length).toBeGreaterThan(budget.directMaxChars); // reunião longa: vai para o map-reduce
      const parts = splitTranscript(transcript, { maxChars: budget.partMaxChars });
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) expect(part.text.length, `${numCtx}`).toBeLessThanOrEqual(budget.directMaxChars * 0.75); // parte + sobreposição de 1 min + prompt cabem na janela
    }
    expect(splitTranscript(transcript, { maxChars: localBudget(8192).partMaxChars }).length).toBeGreaterThan(splitTranscript(transcript, { maxChars: localBudget(32768).partMaxChars }).length);
  });
});

describe('provedor, status, modelo leve e testes', () => {
  const deps = (f: FetchLike, local: RunnerDeps['local'] = () => ({})): RunnerDeps => ({ getSecret: async () => null, binaries: { claude: 'claude', codex: 'codex', opencode: 'opencode', agy: 'agy' }, workDir: '/tmp/x', fetch: f, local });

  test('entra na lista de provedores, valida nomes de modelo do Ollama e não tem busca na web', () => {
    expect(AI_PROVIDERS.at(-1)).toBe('local-model');
    for (const ok of ['qwen3:8b', 'llama3.2:3b', 'hf.co/user/model:Q4_K_M', 'qwen2.5-7b-instruct']) expect(isModelFor('local-model', ok), ok).toBe(true);
    for (const bad of ['', '-x', 'a b', 'a;rm', 'x'.repeat(200)]) expect(isModelFor('local-model', bad), bad).toBe(false);
    expect(webSearchSupported('local-model')).toBe(false);
  });

  test('configurações: endereço e contexto lidos com tolerância', () => {
    expect(resolveAiSettings({ provider: 'local-model', local: { url: ' http://127.0.0.1:11434 ', numCtx: 32768 } })).toMatchObject({ provider: 'local-model', local: { url: 'http://127.0.0.1:11434', numCtx: 32768 } });
    expect(resolveAiSettings({ local: { numCtx: 12345, url: 42 } }).local).toBeUndefined();
  });

  test('status: conectado com os modelos e tamanhos; sem servidor; endereço não local explica', async () => {
    const ok = await aiStatus(resolveAiSettings({ provider: 'local-model' }), { ...deps(fake().f), totalRam: () => 16 * GB });
    expect(ok.providers['local-model']!.local!.autoModel).toEqual({ id: 'qwen3:8b', label: 'Qwen3 8B' });
    expect(ok.providers['local-model']).toMatchObject({ connected: true, installed: true, local: { kind: 'ollama', numCtx: 16384, models: [{ id: 'qwen3:8b', size: 5_200_000_000 }, { id: 'llama3.2:3b' }] } });
    expect(ok.providers['local-model']!.detail).toContain('Ollama');
    invalidateAiStatus();
    const down = await aiStatus(resolveAiSettings({}), deps(fake({ ollama: false }).f));
    expect(down.providers['local-model']).toMatchObject({ connected: false, installed: false, detail: 'Nenhum servidor local encontrado.' });
    invalidateAiStatus();
    const bad = await aiStatus(resolveAiSettings({}), deps(fake().f, () => ({ url: 'http://example.com' })));
    expect(bad.providers['local-model']!.detail).toMatch(/próprio computador/);
    expect(bad.providers['local-model']!.connected).toBe(false);
  });

  test('lista de modelos, "Testar conexão" (geração curtinha) e fábrica de runner', async () => {
    const { f, calls } = fake({ chat: () => new Response(body(nd({ message: { content: 'ok' }, done: true }))) });
    expect(await listModels('local-model', deps(f))).toEqual({ ok: true, models: ['qwen3:8b', 'llama3.2:3b'] });
    expect(await testProvider('local-model', resolveAiSettings({ provider: 'local-model', models: { 'local-model': 'qwen3:8b' } }), deps(f))).toMatchObject({ ok: true });
    expect(calls.some((c) => c.url.endsWith('/api/chat'))).toBe(true);
    expect(createRunnerFor('local-model', {}, deps(f))).toHaveProperty('run');
    const down = await testProvider('local-model', resolveAiSettings({}), deps(fake({ ollama: false }).f));
    expect(down).toMatchObject({ ok: false });
    expect(await installedLocalModels(deps(f))).toHaveLength(2);
  });

  test('modelo leve: Automático = o menor instalado; "same" = o principal; escolha explícita vale', async () => {
    const { f } = fake();
    const local = () => installedLocalModels(deps(f));
    expect(await lightModelFor(resolveAiSettings({ provider: 'local-model' }), undefined, undefined, local)).toBe('llama3.2:3b');
    expect(await lightModelFor(resolveAiSettings({ provider: 'local-model', light: 'same' }), undefined, undefined, local)).toBeUndefined();
    expect(await lightModelFor(resolveAiSettings({ provider: 'local-model', light: 'qwen3:4b' }), undefined, undefined, local)).toBe('qwen3:4b');
    expect(await lightModelFor(resolveAiSettings({ provider: 'local-model' }))).toBeUndefined(); // sem servidor para consultar
  });
});

describe('textos de todos os provedores', () => {
  test('cada provedor tem o nome na Privacidade ("Hoje: …") em pt e en', () => {
    for (const file of ['pt-BR', 'en']) {
      const text = readFileSync(`src/renderer/locales/${file}.js`, 'utf8');
      for (const id of AI_PROVIDERS) expect(text, `${file} ${id}`).toContain(`'privacy.vendor.${id}':`);
    }
  });
});


describe('qualquer servidor local: portas, detecção e seletor', () => {
  const ok = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  /** Servidores falsos por porta: `routes[port][path]` = resposta; o resto dá "conexão recusada". */
  function ports(routes: Record<number, Record<string, () => Response>>) {
    const calls: string[] = [];
    const f: FetchLike = vi.fn(async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      const handler = routes[Number(u.port)]?.[u.pathname];
      if (routes[Number(u.port)] && !handler) return new Response('not found', { status: 404 });
      if (!handler) throw new TypeError('fetch failed');
      return handler();
    });
    return { f, calls };
  }
  const models = (...ids: string[]) => ({ '/v1/models': () => ok({ data: ids.map((id) => ({ id })) }) });

  test('as portas padrão são as da documentação de cada servidor', () => {
    expect(Object.fromEntries(LOCAL_SERVERS.map((s) => [s.id, s.port]))).toEqual({ ollama: 11434, lmstudio: 1234, llamacpp: 9931, mlx: 8080, jan: 1337 });
    expect(LOCAL_SERVERS.map((s) => s.kind)).toEqual(['ollama', 'openai', 'openai', 'openai', 'openai']);
    expect([...DETECT_PORTS]).toEqual([11434, 1234, 9931, 8080, 1337]);
    expect(defaultUrlOf('lmstudio')).toBe('http://127.0.0.1:1234');
    expect(defaultUrlOf('auto')).toBeNull();
    expect(defaultUrlOf('other')).toBeNull();
  });

  test('a detecção automática testa TODAS as portas em paralelo e diz qual achou', async () => {
    const { f, calls } = ports({ 1234: models('qwen2.5-7b-instruct'), 1337: models('jan-v1') });
    const found = await detectLocalServers(f);
    expect(found.map((s) => `${s.name}:${new URL(s.url).port}`)).toEqual(['LM Studio:1234', 'Jan:1337']);
    expect(new Set(calls.map((c) => new URL(c).port))).toEqual(new Set(['11434', '1234', '9931', '8080', '1337']));
    expect(calls.every((c) => new URL(c).hostname === '127.0.0.1')).toBe(true); // só localhost
    expect((await resolveLocalServer({}, f))?.name).toBe('LM Studio'); // o primeiro, na ordem da lista
  });

  test('a detecção é estrita: um servidor qualquer na porta (404, HTML, JSON sem lista) NÃO conta', async () => {
    const { f } = ports({ 8080: { '/v1/models': () => new Response('<html>dev server</html>') }, 1337: {} , 9931: { '/v1/models': () => ok({ hello: 'world' }) } });
    expect(await detectLocalServers(f)).toEqual([]);
  });

  test('porta 8080: o nome diz MLX / llama.cpp (as duas usam); 9931 é o llama.cpp atual', async () => {
    expect(serverNameOf('http://127.0.0.1:8080')).toBe('MLX / llama.cpp');
    expect(serverNameOf('http://127.0.0.1:9931')).toBe('llama.cpp');
    expect(serverNameOf('http://localhost:1337')).toBe('Jan');
    expect(serverNameOf('http://localhost:5555')).toBe('servidor compatível com OpenAI');
    const { f } = ports({ 8080: models('mlx-community/Qwen3-8B-4bit') });
    expect((await detectLocalServers(f))[0]!.name).toBe('MLX / llama.cpp');
  });

  test('o tempo de cada sonda é curto (nada de esperar segundos por porta fechada)', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => (init.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))));
    const t0 = Date.now();
    expect(await detectLocalServers(hang)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(5000); // 5 portas EM PARALELO: ~1,5 s no total, não 5 × 1,5 s
  });

  test('servidor escolhido no seletor: só a porta padrão dele e só o tipo de API dele', async () => {
    const jan = ports({ 1337: models('jan-v1') });
    const server = await resolveLocalServer({ server: 'jan' }, jan.f);
    expect(server).toMatchObject({ kind: 'openai', name: 'Jan', url: 'http://127.0.0.1:1337' });
    expect(new Set(jan.calls.map((c) => new URL(c).port))).toEqual(new Set(['1337']));
    expect(jan.calls.some((c) => c.endsWith('/api/tags'))).toBe(false); // API compatível com OpenAI: nem tenta a do Ollama
    const ollama = ports({ 11434: { '/api/tags': () => ok(TAGS) } });
    expect(await resolveLocalServer({ server: 'ollama' }, ollama.f)).toMatchObject({ kind: 'ollama', name: 'Ollama' });
    expect(ollama.calls.some((c) => c.endsWith('/v1/models'))).toBe(false);
    expect(await resolveLocalServer({ server: 'lmstudio' }, ports({}).f)).toBeNull(); // nada escutando na 1234
  });

  test('servidor que não lista modelos (só o chat) vale quando foi ESCOLHIDO: conectado, lista vazia', async () => {
    const { f } = ports({ 9931: { '/v1/chat/completions': () => ok({}) } }); // /v1/models dá 404
    expect(await resolveLocalServer({ server: 'llamacpp' }, f)).toMatchObject({ kind: 'openai', name: 'llama.cpp', models: [] });
    expect(await resolveLocalServer({}, f)).toBeNull(); // no Automático, não
  });

  test('"Outro": sem endereço não há servidor; com endereço qualquer porta de localhost; não local continua recusado', async () => {
    const { f, calls } = ports({ 5555: models('x-model') });
    expect(await resolveLocalServer({ server: 'other' }, f)).toBeNull();
    expect(await resolveLocalServer({ server: 'other', url: 'http://localhost:5555' }, f)).toMatchObject({ kind: 'openai', url: 'http://localhost:5555', models: [{ id: 'x-model' }] });
    calls.length = 0;
    await expect(resolveLocalServer({ server: 'other', url: 'https://api.openai.com' }, f)).rejects.toThrow(/próprio computador/);
    await expect(resolveLocalServer({ server: 'jan', url: 'http://192.168.0.5:1337' }, f)).rejects.toThrow(/próprio computador/);
    expect(calls).toEqual([]);
  });

  test('endereço digitado vale sobre a porta padrão do servidor escolhido', async () => {
    const { f, calls } = ports({ 4321: models('m1') });
    const server = await resolveLocalServer({ server: 'lmstudio', url: 'http://127.0.0.1:4321' }, f);
    expect(server).toMatchObject({ url: 'http://127.0.0.1:4321', name: 'LM Studio', models: [{ id: 'm1' }] });
    expect(calls.every((c) => new URL(c).port === '4321')).toBe(true);
  });

  test('o runner conversa com o servidor escolhido e, sem lista de modelos, não manda "model" (usa o que o servidor carregou); com nome digitado, manda o nome', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const chat = () => new Response(body(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']), { headers: { 'content-type': 'text/event-stream' } });
    const f: FetchLike = async (url, init) => {
      const u = new URL(url);
      if (u.port !== '9931') throw new TypeError('x');
      if (u.pathname === '/v1/chat/completions') {
        bodies.push(JSON.parse(String(init.body)));
        return chat();
      }
      return new Response('nope', { status: 404 });
    };
    await drain(createLocalRunner({ getConfig: () => ({ server: 'llamacpp' }), fetch: f }));
    expect(bodies[0]).not.toHaveProperty('model');
    await drain(createLocalRunner({ getConfig: () => ({ server: 'llamacpp' }), model: 'meu-modelo.gguf', fetch: f }));
    expect(bodies[1]).toMatchObject({ model: 'meu-modelo.gguf', stream: true });
  });

  test('configuração salva: o servidor vale (Automático não precisa guardar nada) e lixo é ignorado', () => {
    expect(resolveAiSettings({ local: { server: 'lmstudio' } }).local).toEqual({ server: 'lmstudio' });
    expect(resolveAiSettings({ local: { server: 'auto' } }).local).toBeUndefined();
    expect(resolveAiSettings({ local: { server: 'rm -rf' } }).local).toBeUndefined();
  });

  test('o status mostra o servidor encontrado pelo nome', async () => {
    const f = ports({ 1234: models('qwen2.5-7b-instruct') }).f;
    const status = await aiStatus(resolveAiSettings({ provider: 'local-model' }), { getSecret: async () => null, binaries: { claude: 'c', codex: 'c', opencode: 'o', agy: 'a' }, workDir: '/tmp/x', fetch: f, local: () => ({}), totalRam: () => 16 * GB });
    expect(status.providers['local-model']!.local).toMatchObject({ serverName: 'LM Studio', server: 'auto', kind: 'openai', models: [{ id: 'qwen2.5-7b-instruct' }] });
    expect(status.providers['local-model']!.detail).toBe('LM Studio · 1 modelo');
  });
});
