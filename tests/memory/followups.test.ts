import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { addManual, diffFromNotes, groupOf, listFollowups, overdueMine, planNotifications, readNotifyState, remindersScript, sendToReminders, setDone, setDue, similar, toggleTaskLine, writeNotifyState } from '../../src/main/memory/followups';
import { MemoryStore } from '../../src/main/memory/store';
import { makeTmpDir } from '../helpers/tmp';
import { fact } from './store.test';

const now = new Date(2026, 9, 12, 9, 30); // segunda
const f = (id: string, over = {}) => fact({ id, kind: 'commitment', mine: true, ...over });

async function seeded() {
  const root = await makeTmpDir();
  const store = new MemoryStore(root);
  await store.putMany([
    f('late', { due: '2026-10-09', text: 'Eu mando a proposta' }), f('today', { due: '2026-10-12', text: 'Eu ligo para a Acme' }), f('week', { due: '2026-10-16', text: 'Eu reviso o contrato' }),
    f('later', { due: '2026-11-20', text: 'Eu preparo o relatório' }), f('nodue', { text: 'Eu organizo a pasta' }), f('done', { status: 'done', due: '2026-10-01', doneAt: '2026-10-05', doneBy: { manual: true }, text: 'Eu enviei o convite' }),
    f('theirs', { mine: false, who: 'Carlos', due: '2026-10-10', text: 'Carlos manda a minuta' }), f('req', { kind: 'request', mine: true, who: 'Ana', due: '2026-10-11', text: 'Ana pediu o orçamento' }),
    fact({ id: 'dec', kind: 'decision' }),
  ]);
  return { root, store };
}

describe('agrupamento e filtros', () => {
  test('Vencidas, Hoje, Esta semana, Depois, Sem prazo e Feitas; decisão não é pendência', async () => {
    const { store } = await seeded();
    const g = listFollowups(store, 'all', now);
    expect(g.overdue.map((x) => x.id)).toEqual(['late', 'theirs', 'req'].sort((a, b) => (store.get(a)!.due! < store.get(b)!.due! ? -1 : 1)));
    expect(g.today.map((x) => x.id)).toEqual(['today']);
    expect(g.week.map((x) => x.id)).toEqual(['week']);
    expect(g.later.map((x) => x.id)).toEqual(['later']);
    expect(g.nodue.map((x) => x.id)).toEqual(['nodue']);
    expect(g.done.map((x) => x.id)).toEqual(['done']);
    expect(Object.values(g).flat().some((x) => x.id === 'dec')).toBe(false);
    expect(groupOf(store.get('week')!, new Date(2026, 9, 9))).toBe('week'); // exatamente 7 dias
    expect(groupOf(store.get('later')!, now)).toBe('later');
  });
  test('filtros: Minhas, Dos outros e Todas', async () => {
    const { store } = await seeded();
    const ids = (flt: 'mine' | 'others' | 'all') => Object.values(listFollowups(store, flt, now)).flat().map((x) => x.id).sort();
    expect(ids('others')).toEqual(['theirs']);
    expect(ids('mine')).toEqual(['done', 'late', 'later', 'nodue', 'req', 'today', 'week']);
    expect(ids('all')).toHaveLength(8);
  });
  test('contador das minhas vencidas', async () => {
    const { store } = await seeded();
    expect(overdueMine(store, now)).toBe(2); // late + req (a do Carlos não é minha)
    await setDone(store, 'late', true, now, { syncNotes: false });
    expect(overdueMine(store, now)).toBe(1);
  });
});

describe('prazo, feito, reabrir e criar à mão', () => {
  test('editar o prazo aceita data e relativo; inválido não muda; vazio limpa', async () => {
    const { store } = await seeded();
    expect((await setDue(store, 'nodue', '2026-10-30', now))?.due).toBe('2026-10-30');
    expect((await setDue(store, 'nodue', 'sexta', now))?.due).toBe('2026-10-16');
    expect(await setDue(store, 'nodue', 'quando der', now)).toBeNull();
    expect(store.get('nodue')?.due).toBe('2026-10-16');
    expect((await setDue(store, 'nodue', '', now))?.due).toBeUndefined();
    expect(await setDue(store, 'dec', '2026-10-30', now)).toBeNull(); // só pendência
  });
  test('marcar feito, e reabrir com um clique (a IA nunca apaga: só muda o estado)', async () => {
    const { store } = await seeded();
    await store.put({ ...store.get('late')!, status: 'done', doneBy: { dir: '/R/9', title: 'Reunião 9', date: '2026-10-11' }, doneAt: '2026-10-11' });
    const reopened = await setDone(store, 'late', false, now, { syncNotes: false });
    expect(reopened).toMatchObject({ status: 'open' });
    expect(reopened?.doneBy).toBeUndefined();
    expect(store.get('late')).toBeDefined();
  });
  test('pendência manual: texto limpo, prazo relativo, opcionalmente ligada a uma reunião; nunca vazia', async () => {
    const { store } = await seeded();
    const a = await addManual(store, { text: '  Ligar <b>para o Ze</b>\n amanhã ', due: 'amanhã' }, now);
    expect(a).toMatchObject({ manual: true, mine: true, who: 'Eu', due: '2026-10-13', status: 'open' });
    expect(a!.text).not.toMatch(/[<>\n]/);
    const b = await addManual(store, { text: 'Revisar a minuta', dir: '/R/1', title: 'Kickoff' }, now);
    expect(b!.source).toMatchObject({ dir: '/R/1', title: 'Kickoff' });
    expect(await addManual(store, { text: '  ' }, now)).toBeNull();
    expect(listFollowups(store, 'mine', now).nodue.some((x) => x.id === b!.id)).toBe(true);
  });
});

describe('sincronia com as notas', () => {
  const notes = '## Próximas ações\n\n- [ ] Conduzir o piloto com cinco clientes — Carlos\n- [x] Montar o roteiro de testes até sexta — Ana\n- [ ] Enviar a proposta <!--u:2-->\n\nOutro: [ ] fora da lista\n';
  test('texto da pendência × tarefa das notas (responsável no fim, marcação, maiúsculas)', () => {
    expect(similar('Conduzir o piloto com cinco clientes — Carlos', 'Carlos conduz o piloto com cinco clientes')).toBe(true);
    expect(similar('Enviar a proposta', 'Eu envio a proposta')).toBe(true); // envia/envio: mesma tarefa
    expect(similar('Enviar a proposta', 'Revisar a proposta')).toBe(false); // só 1 palavra em comum
    expect(similar('Enviar a proposta comercial', 'Enviar a proposta comercial até sexta')).toBe(true);
  });
  test('pendência → notas: marca e desmarca o `- [ ]` certo; sem correspondência não mexe', () => {
    const on = toggleTaskLine(notes, 'Carlos conduz o piloto com cinco clientes', true);
    expect(on.changed).toBe(true);
    expect(on.text).toContain('- [x] Conduzir o piloto com cinco clientes — Carlos');
    expect(on.text).toContain('- [ ] Enviar a proposta'); // as outras ficam
    expect(toggleTaskLine(on.text, 'Carlos conduz o piloto com cinco clientes', false).text).toBe(notes);
    expect(toggleTaskLine(notes, 'Algo que não está nas notas', true)).toEqual({ text: notes, changed: false });
    expect(toggleTaskLine(on.text, 'Carlos conduz o piloto com cinco clientes', true).changed).toBe(false); // já estava marcada
  });
  test('setDone escreve nas notas da reunião de origem (arquivo) e reabrir desmarca', async () => {
    const root = await makeTmpDir();
    const dir = join(root, 'Reunião');
    await mkdir(dir);
    await writeFile(join(dir, 'notas.md'), notes);
    const store = new MemoryStore(root);
    await store.put(f('p', { text: 'Carlos conduz o piloto com cinco clientes', source: { dir, title: 'Reunião', date: '2026-10-01' } }));
    await setDone(store, 'p', true, now);
    expect(await readFile(join(dir, 'notas.md'), 'utf8')).toContain('- [x] Conduzir o piloto');
    await setDone(store, 'p', false, now);
    expect(await readFile(join(dir, 'notas.md'), 'utf8')).toBe(notes);
    // sem tarefa correspondente: as notas ficam intactas
    await store.put(f('q', { text: 'Uma pendência sem tarefa nas notas', source: { dir, title: 'Reunião', date: '2026-10-01' } }));
    await setDone(store, 'q', true, now);
    expect(await readFile(join(dir, 'notas.md'), 'utf8')).toBe(notes);
  });
  test('notas → pendência: marcar o `- [x]` fecha; desmarcar reabre só o que foi fechado à mão; o fechado por reunião seguinte fica', () => {
    const facts = [
      f('roteiro', { text: 'Ana monta o roteiro de testes' }), f('piloto', { text: 'Carlos conduz o piloto com cinco clientes', status: 'done', doneBy: { manual: true } }),
      f('proposta', { text: 'Eu envio a proposta comercial', status: 'done', doneBy: { dir: '/R/2', title: 'R2', date: '2026-10-05' } }),
    ];
    const edited = notes.replace('- [x] Montar', '- [x] Montar').replace('- [ ] Enviar a proposta', '- [ ] Enviar a proposta comercial');
    expect(diffFromNotes(edited, facts)).toEqual([{ id: 'roteiro', done: true }, { id: 'piloto', done: false }]);
  });
});

describe('cobrança', () => {
  test('uma vez por dia, a partir das 9h: vencem hoje + vencidas sem aviso, só as minhas e abertas', async () => {
    const { store } = await seeded();
    expect(planNotifications(store, { notified: {} }, new Date(2026, 9, 12, 8, 59))).toBeNull(); // antes das 9h
    const plan = planNotifications(store, { notified: {} }, now)!;
    expect(plan.ids.sort()).toEqual(['late', 'req', 'today']); // a do Carlos é dos outros; a da semana ainda não venceu
    expect(plan.allToday).toBe(false);
    const state = { notified: Object.fromEntries(plan.ids.map((id) => [id, '2026-10-12'])) };
    expect(planNotifications(store, state, new Date(2026, 9, 12, 15))).toBeNull(); // já avisou
    expect(planNotifications(store, state, new Date(2026, 9, 13, 9, 5))).toBeNull(); // no dia seguinte não repete as já avisadas
  });
  test('amanhã avisa a que vence amanhã; agrupa várias numa só', async () => {
    const root = await makeTmpDir();
    const store = new MemoryStore(root);
    await store.putMany([f('a', { due: '2026-10-12' }), f('b', { due: '2026-10-12' }), f('c', { due: '2026-10-12' }), f('d', { due: '2026-10-13' })]);
    const plan = planNotifications(store, { notified: {} }, now)!;
    expect(plan.ids.sort()).toEqual(['a', 'b', 'c']);
    expect(plan.allToday).toBe(true);
    const next = planNotifications(store, { notified: { a: '2026-10-12', b: '2026-10-12', c: '2026-10-12' } }, new Date(2026, 9, 13, 9))!;
    expect(next.ids).toEqual(['d']);
  });
  test('o estado dos avisos persiste e lixo no arquivo não quebra', async () => {
    const root = await makeTmpDir();
    expect(await readNotifyState(root)).toEqual({ notified: {} });
    await writeNotifyState(root, { notified: { x: '2026-10-12' } });
    expect(await readNotifyState(root)).toEqual({ notified: { x: '2026-10-12' } });
    await writeFile(join(root, '.rice', 'followups-state.json'), '{quebrado');
    expect(await readNotifyState(root)).toEqual({ notified: {} });
  });
  test('Lembretes do macOS: script com aspas e quebras escapadas, prazo às 9h; só roda quando chamado', async () => {
    const script = remindersScript([{ title: 'Mandar "a proposta"\n e a \\ barra', due: '2026-10-09' }, { title: 'Sem prazo' }]);
    expect(script).toContain('name:"Mandar \\"a proposta\\"  e a \\\\ barra"');
    expect(script).toContain('set day of d to 9');
    expect(script).toContain('set month of d to 10');
    expect(script).toContain('make new reminder with properties {name:"Sem prazo"}');
    const run = vi.fn(async () => {});
    expect(await sendToReminders([{ title: 'x' }], run)).toBe(true);
    expect(run).toHaveBeenCalledWith('osascript', ['-e', expect.stringContaining('tell application "Reminders"')], expect.anything());
    expect(await sendToReminders([], run)).toBe(false);
    expect(await sendToReminders([{ title: 'x' }], async () => { throw new Error('negado'); })).toBe(false);
  });
});
