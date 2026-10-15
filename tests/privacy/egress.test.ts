import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createActiveRunner, createLightRunner, createRunnerFor, type RunnerDeps } from '../../src/main/ai/factory';
import type { FetchLike } from '../../src/main/ai/http-stream';
import type { AiProvider, AiRunner } from '../../src/main/ai/types';
import { appendEgress, buildReceipt, EGRESS_FILE, newEgress, readEgress, receiptText, viaOf, withEgressContext, type EgressRecord } from '../../src/main/privacy/egress';
import { t, tn } from '../../src/main/i18n';
import { makeTmpDir } from '../helpers/tmp';

const enc = new TextEncoder();
const claudeStream = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
const sseFetch: FetchLike = async () => new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(claudeStream)), c.close()) }), { headers: { 'content-type': 'text/event-stream' } });
const deps = (egress: RunnerDeps['egress'], fetch: FetchLike = sseFetch): RunnerDeps => ({ getSecret: async () => 'chave-falsa-12345678', binaries: { claude: 'c', codex: 'c', opencode: 'o', agy: 'a' }, workDir: '/tmp/x', fetch, egress });
async function drain(runner: Pick<AiRunner, 'run'>, options: Partial<Parameters<AiRunner['run']>[0]> = {}) {
  const gen = runner.run({ system: 'SISTEMA SECRETO', prompt: 'TRANSCRICAO CONFIDENCIAL com João e o CPF 123', ...options });
  for (;;) if ((await gen.next()).done) return;
}

describe('registro central das saídas (createRunnerFor)', () => {
  test('toda chamada vira um registro de metadados: tipo, provedor, via, tamanho, imagens, sucesso', async () => {
    const sink = vi.fn();
    await drain(createRunnerFor('claude-api', {}, deps(sink)), { egress: { kind: 'notes', dir: '/R/a' }, images: [{ mime: 'image/png', data: 'AAAA' }] });
    expect(sink).toHaveBeenCalledTimes(1);
    const [dirs, record] = sink.mock.calls[0]! as [string[], EgressRecord];
    expect(dirs).toEqual(['/R/a']);
    expect(record).toMatchObject({ kind: 'notes', provider: 'claude-api', via: 'api', items: { text: 'SISTEMA SECRETO'.length + 'TRANSCRICAO CONFIDENCIAL com João e o CPF 123'.length, images: 1 }, ok: true });
    expect(record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('NUNCA grava conteúdo: nem o texto, nem os nomes, nem o segredo aparecem no registro', async () => {
    const dir = await makeTmpDir();
    const run = createRunnerFor('claude-api', {}, deps(async (dirs, rec) => void (await Promise.all(dirs.map((d) => appendEgress(d, rec))))));
    await drain(run, { egress: { kind: 'chat', dir } });
    await new Promise((r) => setTimeout(r, 20));
    const raw = await readFile(join(dir, EGRESS_FILE), 'utf8');
    for (const secret of ['SISTEMA SECRETO', 'CONFIDENCIAL', 'João', 'CPF 123', 'chave-falsa']) expect(raw).not.toContain(secret);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['at', 'items', 'kind', 'ok', 'provider', 'via']);
  });

  test('via: CLIs = cli, APIs = api, Modelo local = local (não saiu)', () => {
    const table: Record<AiProvider, string> = { 'claude-sub': 'cli', 'chatgpt-sub': 'cli', 'opencode-sub': 'cli', 'agy-sub': 'cli', 'claude-api': 'api', 'openai-api': 'api', 'gemini-api': 'api', 'local-model': 'local' };
    for (const [p, via] of Object.entries(table)) expect(viaOf(p as AiProvider), p).toBe(via);
  });

  test('falha ou cancelamento também são registrados (ok: false): os dados podem ter saído', async () => {
    const sink = vi.fn();
    const down: FetchLike = async () => new Response('{"error":{"message":"boom"}}', { status: 500 });
    await expect(drain(createRunnerFor('openai-api', {}, deps(sink, down)), { egress: { kind: 'notes', dir: '/R/a' } })).rejects.toThrow();
    expect(sink.mock.calls[0]![1]).toMatchObject({ ok: false, provider: 'openai-api' });
  });

  test('busca na web fica marcada; sem contexto o registro vai com dirs vazio (nunca se perde)', async () => {
    const sink = vi.fn();
    await drain(createRunnerFor('claude-api', {}, deps(sink)), { tools: { web: true, mcp: false, onCall: () => {} } });
    const [dirs, record] = sink.mock.calls[0]! as [string[], EgressRecord];
    expect(dirs).toEqual([]);
    expect(record).toMatchObject({ kind: 'other', web: true });
  });

  test('chat entre reuniões: um registro para cada reunião envolvida', async () => {
    const sink = vi.fn();
    await drain(createRunnerFor('claude-api', {}, deps(sink)), { egress: { kind: 'chat', dirs: ['/R/a', '/R/b'] } });
    expect(sink.mock.calls[0]![0]).toEqual(['/R/a', '/R/b']);
  });

  test('um sink que falha nunca derruba a chamada', async () => {
    const sink = vi.fn(async () => {
      throw new Error('disco cheio');
    });
    await expect(drain(createRunnerFor('claude-api', {}, deps(sink)), { egress: { kind: 'notes', dir: '/R/a' } })).resolves.toBeUndefined();
  });

  test('o ativo e o leve passam pelo mesmo ponto: nenhum recurso esquece de registrar', async () => {
    const sink = vi.fn();
    const settings = () => ({ provider: 'claude-api' as const, models: {}, verified: {} });
    await drain(createActiveRunner(settings, deps(sink)), { egress: { kind: 'chat', dir: '/R/a' } });
    await drain(createLightRunner(settings, deps(sink)), { egress: { kind: 'ideas', dir: '/R/a' } });
    expect(sink.mock.calls.map((c) => (c[1] as EgressRecord).kind)).toEqual(['chat', 'ideas']);
  });

  test('withEgressContext marca as chamadas sem sobrescrever um contexto já dado', async () => {
    const seen: unknown[] = [];
    const inner: AiRunner = { async *run(o) { seen.push(o.egress); return 'x'; } };
    await drain(withEgressContext(inner, { kind: 'screenshot', dir: '/R/a' }));
    await drain(withEgressContext(inner, { kind: 'screenshot', dir: '/R/a' }), { egress: { kind: 'notes', dir: '/R/b' } });
    expect(seen).toEqual([{ kind: 'screenshot', dir: '/R/a' }, { kind: 'notes', dir: '/R/b' }]);
  });
});

describe('arquivo do registro', () => {
  test('ida e volta; linhas malformadas ou de outro formato são ignoradas', async () => {
    const dir = await makeTmpDir();
    await appendEgress(dir, newEgress({ kind: 'notes', provider: 'claude-sub', via: 'cli', items: { text: 100, images: 0 }, ok: true }));
    await appendEgress(dir, newEgress({ kind: 'ideas', provider: 'local-model', via: 'local', items: { text: 5, images: 0 }, ok: true, redacted: 3 }));
    const path = join(dir, EGRESS_FILE);
    await writeFile(path, `${await readFile(path, 'utf8')}{ não é json\n${JSON.stringify({ kind: 'notes' })}\n${JSON.stringify({ at: 'x', kind: 'inventado', provider: 'p', via: 'cli' })}\n`);
    const read = await readEgress(dir);
    expect(read.map((r) => r.kind)).toEqual(['notes', 'ideas']);
    expect(read[1]).toMatchObject({ redacted: 3, via: 'local' });
    expect(await readEgress(await makeTmpDir())).toEqual([]);
  });
});

describe('recibo: o que saiu deste computador', () => {
  const label = (p: AiProvider) => t(`receipt.provider.${p}`);
  const rec = (over: Partial<EgressRecord>): EgressRecord => ({ at: '2026-10-13T14:31:05-03:00', kind: 'notes', provider: 'claude-sub', via: 'cli', items: { text: 1000, images: 0 }, ok: true, ...over });
  const make = (entries: EgressRecord[], meta = {}) => buildReceipt(entries, meta, (k, v) => t(k, v), (k, n, v) => tn(k, n, v), label);
  const row = (r: ReturnType<typeof make>, id: string) => r.rows.find((x) => x.id === id)!;

  test('sem envios: "Nada desta reunião saiu do seu computador"; áudio e transcrição sempre locais', () => {
    const r = make([]);
    expect(r.summary).toBe('Nada desta reunião saiu do seu computador');
    expect(r.nothingLeft).toBe(true);
    expect(row(r, 'audio')).toMatchObject({ label: 'Áudio', value: 'nunca sai do computador', sent: false });
    expect(row(r, 'transcript')).toMatchObject({ label: 'Transcrição', value: 'local' });
    expect(row(r, 'notes').value).toBe('nenhum envio');
    expect(row(r, 'screenshots').value).toBe('0 enviadas');
    expect(row(r, 'web').value).toBe('não usada');
    expect(row(r, 'consent').value).toBe('não copiado');
  });

  test('notas enviadas ao Claude: provedor, contagem e hora; o resumo diz para onde foi', () => {
    const r = make([rec({})]);
    expect(row(r, 'notes')).toMatchObject({ label: 'Notas', value: 'Claude (assinatura) · 1 envio · 14:31', sent: true });
    expect(r.nothingLeft).toBe(false);
    expect(r.summary).toBe('Partes desta reunião (só texto) foram enviadas para: Claude (assinatura)');
    const many = make([rec({}), rec({ at: '2026-10-13T15:02:00-03:00', provider: 'openai-api', via: 'api' })]);
    expect(row(many, 'notes').value).toBe('Claude (assinatura), OpenAI (API) · 2 envios · 15:02');
  });

  test('só Modelo local: tudo "não saiu do computador" e o resumo é o de nada ter saído', () => {
    const r = make([rec({ provider: 'local-model', via: 'local' }), rec({ kind: 'chat', provider: 'local-model', via: 'local' })]);
    expect(row(r, 'notes').value).toBe('Modelo local · 1 uso · 14:31 · não saiu do computador');
    expect(row(r, 'chat').sent).toBe(false);
    expect(r.nothingLeft).toBe(true);
    expect(r.summary).toBe('Nada desta reunião saiu do seu computador');
  });

  test('capturas (imagens enviadas), busca na web, ocultações e consentimento', () => {
    const r = make([rec({ kind: 'screenshot', items: { text: 10, images: 3 } }), rec({ kind: 'chat', web: true, redacted: 12 }), rec({ kind: 'chat', web: true })], { consentNoticeCopiedAt: '2026-10-13T14:02:30-03:00' });
    expect(row(r, 'screenshots')).toMatchObject({ value: '3 enviadas', sent: true });
    expect(row(r, 'web').value).toBe('usada em 2 perguntas');
    expect(row(r, 'redacted').value).toBe('12 dados pessoais ocultados');
    expect(row(r, 'consent')).toMatchObject({ label: 'Aviso de consentimento', value: 'copiado às 14:02' });
    expect(row(make([rec({ kind: 'screenshot', items: { text: 5, images: 1 }, provider: 'local-model', via: 'local' })]), 'screenshots').value).toBe('0 enviadas'); // imagem para o modelo local não saiu
  });

  test('ideias e war room agrupam; e-mail só aparece quando usado; texto para exportar', () => {
    const r = make([rec({ kind: 'ideas' }), rec({ kind: 'warroom' }), rec({ kind: 'email-draft' })]);
    expect(row(r, 'ideas').value).toContain('2 envios');
    expect(row(r, 'email').label).toBe('E-mail');
    expect(make([]).rows.find((x) => x.id === 'email')).toBeUndefined();
    const text = receiptText(r, 'Kickoff Acme', t('receipt.title'));
    expect(text).toContain('Recibo de privacidade');
    expect(text).toContain('Kickoff Acme');
    expect(text).toContain('- Áudio: nunca sai do computador');
  });
});

describe('ocultar dados pessoais no ponto central dos runners', () => {
  /** Servidor falso da API da Anthropic: guarda o corpo recebido e responde citando os marcadores que recebeu. */
  function api() {
    const bodies: Array<{ system: string; messages: Array<{ content: unknown }> }> = [];
    const fetch: FetchLike = async (_url, init) => {
      const sent = JSON.parse(String(init.body));
      bodies.push(sent);
      const text = `Resumo: o contato é [EMAIL 1] e o CPF é [CPF 1]. Sem dados: pedido 123456789.`;
      const half = Math.floor(text.length / 2);
      const ev = (t: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`;
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(ev(text.slice(0, half)) + ev(text.slice(half)) + 'event: message_stop\ndata: {"type":"message_stop"}\n\n')), c.close()) }), { headers: { 'content-type': 'text/event-stream' } });
    };
    return { fetch, bodies };
  }
  const PROMPT = 'Reunião com Ana (ana@acme.com, CPF 529.982.247-25). Pedido 123456789.';

  async function run(shouldRedact: RunnerDeps['shouldRedact'], provider: AiProvider = 'claude-api', images = false) {
    const { fetch, bodies } = api();
    const records: EgressRecord[] = [];
    const runner = createRunnerFor(provider === 'local-model' ? 'claude-api' : provider, {}, { ...deps(async (_d, r) => void records.push(r), fetch), ...(shouldRedact ? { shouldRedact } : {}) });
    const deltas: string[] = [];
    const gen = runner.run({ system: 'Responda sobre ana@acme.com.', prompt: PROMPT, egress: { kind: 'chat', dir: '/R/a' }, ...(images ? { images: [{ mime: 'image/png', data: 'AAAA' }] } : {}) });
    let full = '';
    for (;;) {
      const step = await gen.next();
      if (step.done) {
        full = step.value;
        break;
      }
      deltas.push(step.value);
    }
    await new Promise((r) => setTimeout(r, 10));
    return { bodies, records, deltas, full };
  }

  test('ligado: o que sai não tem os dados; a resposta (em fluxo e final) volta com os valores; o recibo conta', async () => {
    const out = await run(() => true);
    const sent = JSON.stringify(out.bodies[0]);
    expect(sent).not.toMatch(/ana@acme|529\.982|ana\\u0040/);
    expect(sent).toContain('[EMAIL 1]');
    expect(sent).toContain('[CPF 1]');
    expect(sent).toContain('123456789'); // número de pedido não é dado pessoal
    const expected = 'Resumo: o contato é ana@acme.com e o CPF é 529.982.247-25. Sem dados: pedido 123456789.';
    expect(out.full).toBe(expected);
    expect(out.deltas.join('')).toBe(expected); // o texto mostrado durante o fluxo também já vem restaurado
    expect(out.records[0]).toMatchObject({ kind: 'chat', redacted: 3 });
    expect(JSON.stringify(out.records)).not.toContain('ana@acme');
  });

  test('desligado: nada muda (o texto sai como está, sem campo "redacted")', async () => {
    const out = await run(() => false);
    expect(JSON.stringify(out.bodies[0])).toContain('ana@acme.com');
    expect(out.records[0]).not.toHaveProperty('redacted');
  });

  test('a decisão é por chamada, a partir do contexto (reunião)', async () => {
    const seen: unknown[] = [];
    await run((ctx) => (seen.push(ctx), false));
    expect(seen).toEqual([{ kind: 'chat', dir: '/R/a' }]);
  });

  test('com a ocultação ligada as imagens não vão (não dá para ocultar pixels)', async () => {
    const withImage = await run(() => true, 'claude-api', true);
    expect(JSON.stringify(withImage.bodies[0])).not.toContain('AAAA');
    expect(withImage.records[0]!.items.images).toBe(0);
    const without = await run(() => false, 'claude-api', true);
    expect(JSON.stringify(without.bodies[0])).toContain('AAAA');
  });

  test('o mapa nunca é gravado: nada do mapa no registro nem em campo algum', async () => {
    const out = await run(() => true);
    expect(JSON.stringify(out.records)).not.toMatch(/\[CPF|\[EMAIL|529|acme/);
  });
});

describe('recibo: microfone capturado', () => {
  const make = (meta = {}) => buildReceipt([], meta, (k, v) => t(k, v), (k, n, v) => tn(k, n, v), (p) => p);
  test('mostra o microfone (o áudio em si nunca sai) e a sequência quando trocou no meio', () => {
    const one = make({ micName: 'MacBook Pro Microphone', micChanges: [{ at: '2026-10-14T10:00:00-03:00', name: 'MacBook Pro Microphone' }] });
    const row = one.rows.find((r) => r.id === 'mic')!;
    expect(row).toMatchObject({ value: 'MacBook Pro Microphone', sent: false });
    const sw = make({ micName: 'FIFINE K669', micChanges: [{ at: 'a', name: 'Realtek Audio' }, { at: 'b', name: 'FIFINE K669' }] });
    expect(sw.rows.find((r) => r.id === 'mic')!.value).toBe('Realtek Audio → FIFINE K669');
    expect(sw.nothingLeft).toBe(true);
  });
  test('sem informação de microfone, a linha não aparece', () => {
    expect(make().rows.some((r) => r.id === 'mic')).toBe(false);
  });
});
