import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createRunnerFor, type RunnerDeps } from '../../src/main/ai/factory';
import type { FetchLike } from '../../src/main/ai/http-stream';
import { clearLocalCaches } from '../../src/main/ai/local-model';
import type { EgressRecord } from '../../src/main/privacy/egress';
import { extractMeeting } from '../../src/main/memory/extract';
import { buildBrief } from '../../src/main/memory/recall';
import { MemoryStore } from '../../src/main/memory/store';
import { createMeeting, updateMeta } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';
import { fact } from './store.test';

const enc = new TextEncoder();
const CPF = '529.982.247-25'; // CPF válido (dígitos verificadores corretos)
const EMAIL = 'ana.silva@acme.com';
afterEach(() => clearLocalCaches());

/** API de nuvem falsa (Anthropic): guarda o que recebeu e responde com `reply(texto recebido)`. */
function cloud(reply: (sent: string) => string) {
  const sent: string[] = [];
  const f: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { system: string; messages: Array<{ content: string }> };
    const all = `${body.system}\n${body.messages[0]!.content}`;
    sent.push(all);
    const text = reply(all);
    const sse = `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
    return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(sse)), c.close()) }), { headers: { 'content-type': 'text/event-stream' } });
  };
  return { sent, f };
}
const deps = (over: Partial<RunnerDeps>): RunnerDeps => ({ getSecret: async () => 'chave-falsa-12345678', binaries: { claude: 'c', codex: 'c', opencode: 'o', agy: 'a' }, workDir: '/tmp/x', ...over });

async function meetingWith(root: string, title: string, notes: string) {
  const { dir } = await createMeeting(root, { title, startedAt: new Date(2026, 9, 7, 10), trigger: 'manual', state: 'recording' });
  await writeFile(join(dir, 'notas.md'), notes);
  await updateMeta(dir, (m) => ({ ...m, state: 'done', participants: ['Ana Silva'], participantEmails: [EMAIL] }));
  return dir;
}

describe('memória × privacidade do Bem-te-vi', () => {
  test('a extração passa pelo registro de saídas com kind=memory e pela ocultação: a IA recebe marcadores, o fato guardado volta com o valor real (só local)', async () => {
    const root = await makeTmpDir();
    const dir = await meetingWith(root, 'Kickoff Acme', `Ana (${EMAIL}, CPF ${CPF}) pediu desconto de 10%.`);
    const records: Array<[string[], EgressRecord]> = [];
    const api = cloud((sent) => {
      const marker = /\[EMAIL \d+\]/.exec(sent)?.[0] ?? '';
      return JSON.stringify({ facts: [{ kind: 'request', who: 'Ana Silva', about: 'desconto', text: `Ana (${marker}) pediu desconto de 10%`, confidence: 0.9 }], resolves: [] });
    });
    const runner = createRunnerFor('claude-api', {}, deps({ fetch: api.f, shouldRedact: async () => true, egress: (dirs, rec) => void records.push([[...dirs], rec]) }));
    const store = new MemoryStore(root);
    await extractMeeting(dir, { store, runner, language: () => 'pt' });
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]).not.toContain(CPF); // nada de CPF nem e-mail na chamada à nuvem
    expect(api.sent[0]).not.toContain(EMAIL);
    expect(api.sent[0]).toMatch(/\[CPF \d+\]/);
    expect(store.ofDir(dir)[0]!.text).toBe(`Ana (${EMAIL}) pediu desconto de 10%`); // restaurado localmente, como na resposta do chat
    expect(records).toHaveLength(1);
    expect(records[0]![0]).toEqual([dir]);
    expect(records[0]![1]).toMatchObject({ kind: 'memory', provider: 'claude-api', via: 'api', ok: true });
    expect(records[0]![1].redacted).toBeGreaterThanOrEqual(2);
  });

  test('pasta sensível: só oculta quando a reunião (ou uma das de onde vêm os fatos) está nela; fora dela e sem a opção global, vai como está', async () => {
    const root = await makeTmpDir();
    const sensitive = await meetingWith(root, 'Reunião sensível', `Nota com CPF ${CPF}.`);
    const normal = await meetingWith(root, 'Reunião comum', `Nota com CPF ${CPF}.`);
    const shouldRedact: RunnerDeps['shouldRedact'] = (ctx) => (ctx?.dirs ?? (ctx?.dir ? [ctx.dir] : [])).includes(sensitive);
    const api = cloud(() => JSON.stringify({ facts: [], resolves: [] }));
    const runner = createRunnerFor('claude-api', {}, deps({ fetch: api.f, shouldRedact }));
    const store = new MemoryStore(root);
    await extractMeeting(sensitive, { store, runner, language: () => 'pt' });
    await extractMeeting(normal, { store, runner, language: () => 'pt' });
    expect(api.sent[0]).not.toContain(CPF);
    expect(api.sent[1]).toContain(CPF);
  });

  test('"O que lembrar": o resumo também passa por kind=memory, com as pastas dos fatos, e fatos de pasta sensível ativam a ocultação', async () => {
    const root = await makeTmpDir();
    const store = new MemoryStore(root);
    await store.putMany([
      fact({ id: 'a', kind: 'request', who: 'Ana', org: 'acme', text: `Ana pediu a proposta no e-mail ${EMAIL}`, source: { dir: '/R/sens', title: 'Sensível', date: '2026-10-01' } }),
      fact({ id: 'b', kind: 'decision', who: 'Ana', org: 'acme', text: 'Decidiram o piloto', source: { dir: '/R/comum', title: 'Comum', date: '2026-10-02' } }),
    ]);
    const records: Array<[string[], EgressRecord]> = [];
    const api = cloud((sent) => JSON.stringify({ bullets: [{ fact: 'a', text: `Ana quer a proposta em ${/\[EMAIL \d+\]/.exec(sent)?.[0] ?? ''}` }] }));
    const runner = createRunnerFor('claude-api', {}, deps({ fetch: api.f, shouldRedact: async (ctx) => (ctx?.dirs ?? []).includes('/R/sens'), egress: (dirs, rec) => void records.push([[...dirs], rec]) }));
    const brief = (await buildBrief({ key: 'ev', title: 'Revisão Acme', people: [{ name: 'Ana', org: 'acme' }], orgs: ['acme'] }, { store, runner, language: () => 'pt', root, now: () => new Date(2026, 9, 12, 9) }))!;
    expect(api.sent[0]).not.toContain(EMAIL);
    expect(records[0]![1]).toMatchObject({ kind: 'memory', ok: true });
    expect(records[0]![0].sort()).toEqual(['/R/comum', '/R/sens']);
    expect(brief.bullets[0]!.text).toContain(EMAIL); // restaurado localmente para mostrar no cartão
  });

  test('Modo 100% local: a memória funciona com o provedor Modelo local (nada sai do computador; o recibo marca "local")', async () => {
    const root = await makeTmpDir();
    const dir = await meetingWith(root, 'Kickoff Acme', 'Ana pediu desconto de 10%. Carlos manda a proposta até sexta.');
    const calls: string[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push(url);
      const u = new URL(url);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`rede fora do localhost: ${url}`);
      if (u.pathname === '/api/tags') return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 5_200_000_000 }] }), { headers: { 'content-type': 'application/json' } });
      if (u.pathname === '/api/chat') {
        const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
        const answer = JSON.stringify({ facts: [{ kind: 'request', who: 'Ana Silva', about: 'desconto', text: 'Ana pediu desconto de 10%', confidence: 0.9 }], resolves: [] });
        void body;
        return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(`${JSON.stringify({ message: { content: answer } })}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`)), c.close()) }), { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    };
    const records: EgressRecord[] = [];
    const runner = createRunnerFor('local-model', {}, deps({ fetch: f, local: async () => ({}), totalRam: () => 16_000_000_000, shouldRedact: async () => true, egress: (_d, rec) => void records.push(rec) }));
    const store = new MemoryStore(root);
    const r = await extractMeeting(dir, { store, runner, language: () => 'pt', maxChars: async () => 8000 });
    expect(r.added).toBe(1);
    expect(store.ofDir(dir)[0]!.text).toBe('Ana pediu desconto de 10%');
    expect(calls.every((u) => /^(http:\/\/(127\.0\.0\.1|localhost):\d+)/.test(u))).toBe(true);
    expect(records[0]).toMatchObject({ kind: 'memory', provider: 'local-model', via: 'local' });
  });

  test('janela pequena (modelo local): as notas e os fatos da chamada são cortados pelo orçamento', async () => {
    const root = await makeTmpDir();
    const dir = await meetingWith(root, 'Longa', `${'palavra '.repeat(1500)}FIM-DAS-NOTAS`);
    const api = cloud(() => JSON.stringify({ facts: [], resolves: [] }));
    const runner = createRunnerFor('claude-api', {}, deps({ fetch: api.f }));
    await extractMeeting(dir, { store: new MemoryStore(root), runner, language: () => 'pt', maxChars: () => 2000 });
    expect(api.sent[0]).not.toContain('FIM-DAS-NOTAS');
    expect(api.sent[0]!.length).toBeLessThan(5000);
    const big = cloud(() => JSON.stringify({ facts: [], resolves: [] }));
    await extractMeeting(dir, { store: new MemoryStore(await makeTmpDir()), runner: createRunnerFor('claude-api', {}, deps({ fetch: big.f })), language: () => 'pt' });
    expect(big.sent[0]).toContain('FIM-DAS-NOTAS'); // nuvem: o limite de sempre (14 mil)
  });
});
