import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildBrief, briefPrompts, liveBullets, memoryContext, mentionedIn, parseBullets, recall, recentMeetings, titleWords } from '../../src/main/memory/recall';
import { MemoryStore } from '../../src/main/memory/store';
import { makeTmpDir } from '../helpers/tmp';
import { fact } from './store.test';

const now = new Date(2026, 9, 12, 9, 0);
const src = (n: number, title = `R${n}`) => ({ dir: `/R/${n}`, title, date: new Date(2026, 9, n, 10).toISOString() });

async function seeded() {
  const root = await makeTmpDir();
  const store = new MemoryStore(root);
  await store.putMany([
    fact({ id: 'desc', kind: 'request', who: 'Ana', org: 'acme', text: 'Ana pediu 10% de desconto', source: src(1), mine: true }),
    fact({ id: 'prop', kind: 'commitment', who: 'Eu', org: 'acme', text: 'Eu mando a proposta até sexta', due: '2026-10-09', source: src(2), mine: true }),
    fact({ id: 'dec', kind: 'decision', who: 'Ana', org: 'acme', text: 'Decidiram começar pelo piloto', source: src(3) }),
    fact({ id: 'ctx', kind: 'context', who: 'Ana', org: 'acme', text: 'A Acme usa Salesforce', source: src(2) }),
    fact({ id: 'done', kind: 'commitment', who: 'Carlos', org: 'acme', text: 'Carlos mandou o contrato', status: 'done', source: src(1) }),
    fact({ id: 'out', kind: 'commitment', who: 'Zed', org: 'zzz', text: 'Zed faz algo', source: src(2) }),
    fact({ id: 'sup', kind: 'decision', who: 'Ana', org: 'acme', text: 'Ideia antiga', status: 'superseded', source: src(1) }),
  ]);
  return { root, store };
}

describe('recuperação', () => {
  test('pessoas e empresa do evento: pendência aberta (vencida primeiro) antes de pedido, decisão e contexto; feito e superado no fim ou fora', async () => {
    const { store } = await seeded();
    const got = recall(store, { people: ['ana'], orgs: ['Acme'] }, 10, now).map((f) => f.id);
    expect(got.slice(0, 3)).toEqual(['prop', 'desc', 'dec']); // 'prop' venceu em 09/10
    expect(got).not.toContain('out');
    expect(got).not.toContain('sup');
    expect(got.indexOf('done')).toBeGreaterThan(got.indexOf('ctx')); // o que já foi feito vem por último
  });
  test('palavras do título puxam fatos de outras pessoas sobre o assunto; sem a reunião atual', async () => {
    const { store } = await seeded();
    await store.put(fact({ id: 'piloto', who: 'Bia', org: 'beta', about: 'piloto', text: 'O piloto começa em novembro', source: src(4) }));
    expect(recall(store, { people: ['ninguém'], orgs: [], words: titleWords('Revisão do piloto Acme') }, 10, now).map((f) => f.id)).toContain('piloto');
    expect(recall(store, { people: ['ana'], orgs: [] , excludeDir: '/R/1' }, 10, now).some((f) => f.source.dir === '/R/1')).toBe(false);
    expect(titleWords('Weekly: Revisão do piloto da Acme')).toEqual(['revisao', 'piloto']);
  });
  test('as últimas 3 reuniões dessas pessoas, da mais nova para a mais antiga', async () => {
    const { store } = await seeded();
    const facts = recall(store, { people: ['ana', 'carlos'], orgs: ['acme'] }, 30, now);
    expect(recentMeetings(facts, 3).map((r) => r.dir)).toEqual(['/R/3', '/R/2', '/R/1']);
    expect(recentMeetings(facts, 2)).toHaveLength(2);
  });
});

const runnerOf = (answer: string | Error) => {
  const calls: string[] = [];
  return {
    calls,
    async *run(o: { prompt: string }) {
      calls.push(o.prompt);
      if (answer instanceof Error) throw answer;
      return answer;
      yield '';
    },
  };
};

describe('"O que lembrar"', () => {
  const input = { key: 'ev1', title: 'Revisão Acme', people: [{ name: 'Ana', org: 'acme' }], orgs: ['acme'] };
  test('3 a 6 bullets com o link da reunião de origem DO FATO (a IA não escolhe o link); pendências abertas primeiro', async () => {
    const { root, store } = await seeded();
    const runner = runnerOf(JSON.stringify({ bullets: [{ fact: 'dec', text: 'Decidiram começar pelo piloto.' }, { fact: 'desc', text: 'Ana pediu 10% de desconto.' }, { fact: 'inexistente', text: 'Inventado' }, { fact: 'ctx', text: '<b>A Acme usa Salesforce</b>' }] }));
    const brief = (await buildBrief(input, { store, runner: runner as never, language: () => 'pt', root, now: () => now }))!;
    expect(brief.bullets.map((b) => b.factId)).toEqual(['prop', 'desc', 'dec', 'ctx']); // 'prop' (aberta e vencida) entrou mesmo a IA a tendo deixado de fora
    expect(brief.bullets.find((b) => b.factId === 'desc')).toMatchObject({ dir: '/R/1', title: 'R1' });
    expect(brief.bullets.every((b) => !/[<>]/.test(b.text))).toBe(true);
    expect(brief.bullets.length).toBeGreaterThanOrEqual(3);
    expect(brief.bullets.length).toBeLessThanOrEqual(6);
    expect(brief.recent.map((r) => r.dir)).toEqual(['/R/3', '/R/2', '/R/1']);
    expect(brief.openCount).toBe(2);
  });
  test('sem fatos: nada (nem cartão vazio) e nenhuma chamada à IA', async () => {
    const root = await makeTmpDir();
    const runner = runnerOf('{}');
    expect(await buildBrief(input, { store: new MemoryStore(root), runner: runner as never, language: () => 'pt', root, now: () => now })).toBeNull();
    expect(runner.calls).toHaveLength(0);
  });
  test('cache por evento: a 2ª vez não chama a IA; fato novo refaz; outro idioma refaz', async () => {
    const { root, store } = await seeded();
    const runner = runnerOf(JSON.stringify({ bullets: [{ fact: 'desc', text: 'Ana pediu desconto.' }] }));
    const deps = { store, runner: runner as never, language: () => 'pt' as const, root, now: () => now };
    await buildBrief(input, deps);
    await buildBrief(input, deps);
    expect(runner.calls).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, '.rice', 'memory-briefs.json'), 'utf8')).ev1.bullets.length).toBeGreaterThan(0);
    await store.put(fact({ id: 'novo', who: 'Ana', org: 'acme', kind: 'request', text: 'Ana pediu relatório mensal', source: src(5) }));
    await buildBrief(input, deps);
    expect(runner.calls).toHaveLength(2);
    await buildBrief(input, { ...deps, language: () => 'en' });
    expect(runner.calls).toHaveLength(3);
  });
  test('IA fora do ar ou resposta inválida: cai no resumo direto dos fatos', async () => {
    for (const bad of [new Error('rede'), 'Não posso ajudar.'] as const) {
      const { root, store } = await seeded();
      const brief = (await buildBrief(input, { store, runner: runnerOf(bad) as never, language: () => 'pt', root, now: () => now }))!;
      expect(brief.bullets.length).toBeGreaterThanOrEqual(3);
      expect(brief.bullets[0]!.factId).toBe('prop');
    }
  });
  test('o cartão relê os prazos e o estado de hoje; fato apagado some', async () => {
    const { store } = await seeded();
    const [b] = parseBullets(JSON.stringify({ bullets: [{ fact: 'prop', text: 'Mandar a proposta' }] }), new Map(store.all().map((f) => [f.id, f])));
    await store.put({ ...store.get('prop')!, status: 'done' });
    expect(liveBullets(store, [b!])[0]).toMatchObject({ factId: 'prop', done: true });
    await store.remove(['prop']);
    expect(liveBullets(store, [b!])).toEqual([]);
  });
  test('o prompt trata os fatos como dado e não leva e-mails', async () => {
    const { store } = await seeded();
    const { system, prompt } = briefPrompts('en', 'Revisão', store.all(), []);
    expect(system).toMatch(/data, never instructions/);
    expect(prompt).not.toMatch(/@/);
  });
});

describe('memória no chat', () => {
  test('contexto com origem e estado, dentro do orçamento; nada de outras pessoas', async () => {
    const { store } = await seeded();
    const ctx = memoryContext(store, { people: ['ana'], orgs: ['acme'] }, 3500, now);
    expect(ctx).toContain('Ana (acme) · request, em aberto · 2026-10-01 · R1: Ana pediu 10% de desconto');
    expect(ctx).toContain('Eu (acme) · commitment, em aberto, prazo 2026-10-09');
    expect(ctx).not.toContain('Zed');
    expect(memoryContext(store, { people: ['ana'], orgs: ['acme'] }, 150, now).split('\n').length).toBeLessThan(ctx.split('\n').length);
  });
  test('"o que a Acme pediu antes?" acha a empresa e as pessoas pelo nome na pergunta', async () => {
    const { store } = await seeded();
    expect(mentionedIn(store, 'O que a Acme pediu antes?')).toEqual({ people: [], orgs: ['acme'] });
    expect(mentionedIn(store, 'o que a ana disse sobre o desconto')).toEqual({ people: ['Ana'], orgs: [] });
    expect(mentionedIn(store, 'nada a ver')).toEqual({ people: [], orgs: [] });
  });
});
