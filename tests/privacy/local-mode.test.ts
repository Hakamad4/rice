import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClaudeApiRunner, listClaudeModels } from '../../src/main/ai/claude-api';
import { createGeminiApiRunner } from '../../src/main/ai/gemini-api';
import { createOpenAiApiRunner } from '../../src/main/ai/openai-api';
import { createLocalRunner } from '../../src/main/ai/local-model';
import { ensureModel } from '../../src/main/asr/model-download';
import { CalendarFeed } from '../../src/main/calendar/calendar-feed';
import { assertNetworkAllowed, guardedFetch, installNetworkGuard, isLocalMode, isLoopbackUrl, LocalModeError, setLocalMode } from '../../src/main/privacy/local-mode';
import { createUpdateChecker } from '../../src/main/update/check';

/** O fetch "de verdade" é um espião: tudo o que passar pela guarda e chegar nele SAIU do processo. */
let real: ReturnType<typeof vi.fn>;
let restore: () => void;
const g = globalThis as unknown as { fetch: unknown };
const reached = () => real.mock.calls.map((c) => String(c[0] instanceof URL ? c[0].href : c[0]));
const external = () => reached().filter((u) => !isLoopbackUrl(u));

beforeEach(() => {
  real = vi.fn(async () => new Response('{}', { status: 200 }));
  const original = g.fetch;
  g.fetch = real;
  installNetworkGuard(); // o mesmo que o main faz no começo
  restore = () => {
    g.fetch = original;
    setLocalMode(false);
  };
  setLocalMode(true);
});
afterEach(() => restore());

describe('guarda do fetch', () => {
  test('ligado: só localhost passa (127.0.0.1, localhost, ::1, qualquer porta); o resto é recusado com mensagem clara', async () => {
    for (const ok of ['http://127.0.0.1:11434/api/tags', 'http://localhost:1234/v1/models', 'http://[::1]:8080/x']) await fetch(ok);
    expect(reached()).toHaveLength(3);
    for (const bad of ['https://api.anthropic.com/v1/messages', 'https://huggingface.co/x', 'http://192.168.0.2:11434', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com/x', 'http://0.0.0.0:80', 'not a url']) {
      await expect(fetch(bad), bad).rejects.toBeInstanceOf(LocalModeError);
    }
    await expect(fetch(new URL('https://example.com'))).rejects.toThrow(/nada sai deste computador/);
    await expect(fetch(new Request('https://example.com/r'))).rejects.toBeInstanceOf(LocalModeError);
    expect(external()).toEqual([]);
  });

  test('desligado: tudo passa como sempre', async () => {
    setLocalMode(false);
    await fetch('https://example.com/ok');
    expect(external()).toEqual(['https://example.com/ok']);
    expect(isLocalMode()).toBe(false);
  });

  test('assertNetworkAllowed e guardedFetch isolado (sem mexer no global)', async () => {
    expect(() => assertNetworkAllowed('https://example.com', 'a busca')).toThrow(/a busca/);
    expect(() => assertNetworkAllowed('http://127.0.0.1:9')).not.toThrow();
    const spy = vi.fn(async () => new Response('x'));
    await expect(guardedFetch(spy as unknown as typeof fetch)('https://example.com')).rejects.toBeInstanceOf(LocalModeError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('nenhuma requisição externa, recurso por recurso', () => {
  test('IAs da nuvem (Claude, OpenAI, Gemini): recusadas antes de sair; a listagem de modelos também', async () => {
    for (const make of [createClaudeApiRunner, createOpenAiApiRunner, createGeminiApiRunner]) {
      const run = make({ getKey: () => 'chave-falsa-12345678' }).run({ system: 's', prompt: 'p' });
      await expect(run.next()).rejects.toThrow();
    }
    await expect(listClaudeModels('chave-falsa-12345678')).rejects.toThrow();
    expect(external()).toEqual([]);
  });

  test('o modelo local continua funcionando: só fala com 127.0.0.1', async () => {
    real.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/api/tags') return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
      return new Response(`${JSON.stringify({ message: { content: 'ok' }, done: true })}\n`);
    });
    const gen = createLocalRunner({ getConfig: () => ({}) }).run({ system: 's', prompt: 'p' });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value).toBe('ok');
    expect(reached().length).toBeGreaterThan(0);
    expect(external()).toEqual([]);
  });

  test('download de modelo de transcrição: avisa que o modelo precisa estar baixado e não toca a rede', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rice-local-'));
    try {
      await expect(ensureModel({ name: 'ggml-x.bin', url: 'https://huggingface.co/x/ggml-x.bin' }, dir)).rejects.toThrow(/ggml-x\.bin.*não está baixado/s);
      expect(await readdir(dir)).toEqual([]); // nem criou arquivo parcial
      expect(reached()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('agenda do Google: o feed montado como no main fica "desconectado" e não faz nenhuma requisição (o Calendário do macOS continua)', async () => {
    const auth = { accessToken: vi.fn(async () => 'token'), status: async () => (isLocalMode() ? { connected: false } : { connected: true }) };
    const feed = new CalendarFeed(auth, (url, init) => fetch(url, init));
    feed.setEventKit([{ id: 'ek1', title: 'Reunião local', start: '2026-10-13T12:00:00Z', end: '2026-10-13T13:00:00Z', calendar: 'c', attendees: 2, source: 'eventkit' }]);
    await feed.refresh();
    expect(auth.accessToken).not.toHaveBeenCalled();
    expect(reached()).toEqual([]);
    expect(feed.events().map((e) => e.id)).toEqual(['ek1']);
  });

  test('verificação de atualizações: com o modo ligado nem consulta; mesmo se tentasse, a guarda recusa', async () => {
    const state = {};
    const checker = createUpdateChecker({
      info: () => ({ commit: 'a1b2c3d', commitDate: null, date: null, remote: 'github.com/WalissonCF/rice', clonePath: null }),
      enabled: async () => !isLocalMode(), // a regra do main
      getState: async () => state,
      setState: async () => {},
      cloneUsable: () => false,
    });
    expect(await checker.maybeCheck()).toMatchObject({ enabled: false, available: false });
    expect(reached()).toEqual([]);
    // sem a regra, o fetch padrão (global, guardado) é recusado: a verificação falha em silêncio e nada sai
    const naive = createUpdateChecker({ info: () => ({ commit: 'a1b2c3d', commitDate: null, date: null, remote: 'github.com/WalissonCF/rice', clonePath: null }), enabled: async () => true, getState: async () => ({}), setState: async () => {}, cloneUsable: () => false });
    await naive.maybeCheck();
    expect(external()).toEqual([]);
  });

  test('um fetch qualquer do app (busca na web, MCP, war room) cai na mesma guarda: nada externo, nunca', async () => {
    const attempts = ['https://api.github.com/repos/WalissonCF/rice/commits/main', 'https://www.googleapis.com/calendar/v3/users/me/calendarList', 'https://oauth2.googleapis.com/token', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/x.bin', 'https://api.openai.com/v1/responses'];
    for (const url of attempts) await expect(fetch(url)).rejects.toBeInstanceOf(LocalModeError);
    expect(external()).toEqual([]);
  });
});
