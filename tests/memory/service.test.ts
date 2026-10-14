import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { registerMemory, type MemoryHost } from '../../src/main/memory/ipc';
import { MemoryService, viewOf, type CalendarEventLike } from '../../src/main/memory/service';
import { createMeeting, updateMeta } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';
import { fact } from './store.test';

const now = new Date(2026, 9, 12, 9, 30);
const json = (facts: unknown[], resolves: string[] = []) => JSON.stringify({ facts, resolves });

async function setup(answer: string | ((prompt: string) => string) = json([]), over: { enabled?: boolean; events?: CalendarEventLike[]; notify?: boolean } = {}) {
  const root = await makeTmpDir();
  const calls: string[] = [];
  const runner = { async *run(o: { prompt: string }) { calls.push(o.prompt); return typeof answer === 'function' ? answer(o.prompt) : answer; yield ''; } };
  const flags = { enabled: over.enabled ?? true, notify: over.notify ?? true };
  const changed = vi.fn();
  const service = new MemoryService({ root: async () => root, runner: () => runner as never, language: async () => 'pt', enabled: () => flags.enabled, notifyEnabled: () => flags.notify, events: () => over.events ?? [], now: () => now, onChanged: changed });
  const meeting = async (title: string, when: Date, notes: string, extra: Record<string, unknown> = {}) => {
    const { dir } = await createMeeting(root, { title, startedAt: when, trigger: 'manual', state: 'recording' });
    await writeFile(join(dir, 'notas.md'), notes);
    await updateMeta(dir, (m) => ({ ...m, state: 'done', ...extra }));
    return dir;
  };
  return { root, service, calls, flags, changed, meeting };
}

describe('serviço', () => {
  test('ligado: extrai quando as notas ficam prontas; desligado ou IA fora do ar: nada e nada quebra', async () => {
    const a = await setup(json([{ kind: 'request', who: 'Ana', org: 'Acme', about: 'desconto', text: 'Ana pediu desconto de 10%', confidence: 0.9 }]));
    const dir = await a.meeting('Acme 1', new Date(2026, 9, 1), 'notas');
    await a.service.onNotesReady(dir);
    expect((await a.service.status()).facts).toBe(1);
    expect(a.changed).toHaveBeenCalled();
    const b = await setup(json([{ kind: 'decision', who: 'X', text: 'Decisão qualquer aqui', confidence: 1 }]), { enabled: false });
    await b.service.onNotesReady(await b.meeting('R', new Date(2026, 9, 1), 'notas'));
    expect((await b.service.status()).facts).toBe(0);
    expect(b.calls).toHaveLength(0);
    const c = await setup('{}');
    c.service['deps' as never];
    await expect(c.service.onNotesReady('/não/existe')).resolves.toBeUndefined();
  });
  test('apagar a reunião remove os fatos dela', async () => {
    const s = await setup(json([{ kind: 'commitment', who: 'Ana', text: 'Ana manda a proposta', confidence: 1 }]));
    const dir = await s.meeting('R1', new Date(2026, 9, 1), 'notas');
    await s.service.onNotesReady(dir);
    expect((await s.service.status()).facts).toBe(1);
    await s.service.removeMeeting(dir);
    expect((await s.service.status()).facts).toBe(0);
    expect((await s.service.list('')).people).toEqual([]);
  });
  test('"Eu" não vira uma pessoa da lista (o que é meu fica na empresa e nas Pendências); "acme" e "Acme" são a mesma empresa', async () => {
    const s = await setup();
    const store = await s.service.memory();
    await store.putMany([fact({ id: 'm1', who: 'Eu', org: 'acme', text: 'Mandar a proposta' }), fact({ id: 'm2', who: 'Ana', org: 'Acme', text: 'Ana pediu desconto' })]);
    const all = await s.service.list('');
    expect(all.people.map((p) => p.name)).toEqual(['Ana']);
    expect(all.orgs.map((o) => [o.name, o.facts.length])).toEqual([['Acme', 2]]);
    expect((await s.service.status()).people).toBe(1);
  });
  test('a página lista por pessoa e por empresa, com busca; editar preserva e marca; apagar; esquecer; limpar tudo', async () => {
    const s = await setup();
    const store = await s.service.memory();
    await store.putMany([fact({ id: '1', who: 'Ana', org: 'acme', text: 'Ana pediu desconto' }), fact({ id: '2', who: 'Bia', org: 'acme', text: 'Bia decidiu o prazo', kind: 'decision' }), fact({ id: '3', who: 'Cid', org: 'beta', text: 'Cid prefere e-mail' })]);
    const all = await s.service.list('');
    expect(all.people.map((p) => p.name)).toEqual(['Ana', 'Bia', 'Cid']);
    expect(all.orgs.map((o) => [o.name, o.facts.length])).toEqual([['Acme', 2], ['Beta', 1]]);
    expect((await s.service.list('DESCONTO')).people.map((p) => p.name)).toEqual(['Ana']);
    expect(JSON.stringify(all)).not.toMatch(/@/); // e-mails nunca vão ao renderer (a memória nem os guarda)
    const edited = await s.service.update('1', { text: '  Ana pediu <b>15%</b> ', due: 'sexta' });
    expect(edited).toMatchObject({ due: '2026-10-16' });
    expect(edited!.text).not.toMatch(/[<>]/);
    expect(store.get('1')?.edited).toBe(true);
    expect(await s.service.update('1', { due: 'quando der' })).toBeNull();
    expect(await s.service.update('nada', { text: 'x' })).toBeNull();
    expect(await s.service.remove('3')).toBe(true);
    expect(await s.service.remove('3')).toBe(false);
    expect(await s.service.forget('org', 'ACME')).toBe(2);
    expect(await s.service.forget('person', 'ninguem')).toBe(0);
    expect(await s.service.forget('xx', 'a')).toBe(0);
    await store.put(fact({ id: '9' }));
    await s.service.clear();
    expect((await s.service.status()).facts).toBe(0);
  });
  test('"O que lembrar" por evento: só com evento da agenda; reuniões antigas com a Acme: pedido + promessa já cumprida', async () => {
    const event: CalendarEventLike = { id: 'ev1', title: 'Revisão da proposta', start: '2026-10-12T10:00:00-03:00', attendeeNames: ['Ana Silva'], attendeeEmails: ['ana.silva@acme.com'] };
    const s = await setup((p) => (p.includes('Upcoming meeting') ? JSON.stringify({ bullets: [] }) : json([])), { events: [event] });
    const store = await s.service.memory();
    await store.putMany([
      fact({ id: 'd', kind: 'request', who: 'Ana Silva', org: 'acme', text: 'Ana pediu desconto de 10%', source: { dir: '/R/1', title: 'Kickoff', date: '2026-10-01' }, mine: true }),
      fact({ id: 'p', kind: 'commitment', who: 'Eu', org: 'acme', text: 'Eu mando a proposta até sexta', status: 'done', doneBy: { dir: '/R/3', title: 'Follow-up', date: '2026-10-09' }, source: { dir: '/R/2', title: 'Reunião 2', date: '2026-10-05' }, mine: true }),
    ]);
    const brief = (await s.service.briefForEvent('ev1'))!;
    expect(brief.bullets.map((b) => b.factId).sort()).toEqual(['d', 'p']);
    expect(brief.bullets.find((b) => b.factId === 'd')).toMatchObject({ dir: '/R/1', title: 'Kickoff' });
    expect(brief.bullets.find((b) => b.factId === 'p')).toMatchObject({ done: true });
    expect(await s.service.briefForEvent('outro')).toBeNull();
    const none = await setup('{}', { events: [{ ...event, attendeeEmails: ['zz@zzz.com'], attendeeNames: ['Zé'], title: 'Café' }] });
    expect(await none.service.briefForEvent('ev1')).toBeNull(); // sem fatos: nada
    const off = await setup('{}', { events: [event], enabled: false });
    expect(await off.service.briefForEvent('ev1')).toBeNull();
  });
  test('cartão da aba Notas: reunião ligada ao evento mostra; reunião sem evento não', async () => {
    const event: CalendarEventLike = { id: 'ev1', title: 'Revisão Acme', start: '2026-10-12T10:00:00-03:00', attendeeEmails: ['ana@acme.com'], attendeeNames: ['Ana'] };
    const s = await setup('{"bullets":[]}', { events: [event] });
    const store = await s.service.memory();
    await store.put(fact({ id: 'd', who: 'Ana', org: 'acme', source: { dir: '/R/1', title: 'Kickoff', date: '2026-10-01' } }));
    const withEvent = await s.meeting('Revisão Acme', new Date(2026, 9, 12), '', { calendarEventId: 'ev1', participantEmails: ['ana@acme.com'] });
    const without = await s.meeting('Conversa', new Date(2026, 9, 12), '');
    expect((await s.service.briefForMeeting(withEvent))?.bullets.length).toBeGreaterThan(0);
    expect(await s.service.briefForMeeting(without)).toBeNull();
  });
  test('chat com memória: a pergunta nomeia a empresa, ou a reunião tem os participantes; sem relação, nada', async () => {
    const s = await setup();
    const store = await s.service.memory();
    await store.put(fact({ id: 'd', kind: 'request', who: 'Ana', org: 'acme', text: 'Ana pediu desconto de 10%' }));
    const withAcme = await s.service.chatContext('O que a Acme pediu antes?');
    expect(withAcme.text).toContain('Ana pediu desconto de 10%');
    expect(withAcme.dirs).toEqual(['/R/a']); // as reuniões de origem entram no recibo e na ocultação do chat
    expect((await s.service.chatContext('Qual o plano de marketing?')).text).toBe('');
    const dir = await s.meeting('R', new Date(2026, 9, 12), '', { participants: ['Ana'], participantEmails: ['ana@acme.com'] });
    const { readMeta } = await import('../../src/main/store/meeting-files');
    expect((await s.service.chatContext('resuma', await readMeta(dir))).text).toContain('desconto');
    s.flags.enabled = false;
    expect((await s.service.chatContext('O que a Acme pediu antes?')).text).toBe('');
  });
  test('marcar tarefa nas notas: grava o arquivo e fecha a pendência correspondente (e o inverso reabre)', async () => {
    const s = await setup();
    const dir = await s.meeting('R', new Date(2026, 9, 1), '## Próximas ações\n- [ ] Enviar a proposta comercial — Eu\n');
    const store = await s.service.memory();
    await store.put(fact({ id: 'p', who: 'Eu', mine: true, text: 'Eu envio a proposta comercial', source: { dir, title: 'R', date: '2026-10-01' } }));
    expect(await s.service.toggleNoteTask(dir, 'Enviar a proposta comercial — Eu', true)).toBe(true);
    expect(await readFile(join(dir, 'notas.md'), 'utf8')).toContain('- [x] Enviar a proposta comercial');
    expect(store.get('p')?.status).toBe('done');
    expect(await s.service.toggleNoteTask(dir, 'Enviar a proposta comercial — Eu', false)).toBe(true);
    expect(store.get('p')?.status).toBe('open');
    expect(await s.service.toggleNoteTask(dir, 'Tarefa que não existe', true)).toBe(false);
  });
  test('aviso de vencimento: respeita a opção, uma vez por dia (o estado persiste)', async () => {
    const s = await setup();
    const store = await s.service.memory();
    await store.putMany([fact({ id: 'a', mine: true, due: '2026-10-12', text: 'Eu ligo para a Acme' }), fact({ id: 'b', mine: true, due: '2026-10-12', text: 'Eu reviso o contrato' })]);
    const first = (await s.service.dueNotification())!;
    expect(first).toMatchObject({ count: 2, allToday: true });
    await s.service.markNotified(first.ids);
    expect(await s.service.dueNotification()).toBeNull();
    s.flags.notify = false;
    await store.put(fact({ id: 'c', mine: true, due: '2026-10-12' }));
    expect(await s.service.dueNotification()).toBeNull();
  });
});

describe('IPC', () => {
  function host(service: MemoryService) {
    const handlers = new Map<string, (e: unknown, ...a: any[]) => unknown>();
    const flags = { enabled: true, notify: true };
    const h: MemoryHost = {
      handle: (c, fn) => void handlers.set(c, fn),
      send: () => {},
      checkedDir: async (d) => {
        if (typeof d !== 'string' || !d.startsWith('/ok/')) throw new Error('fora da raiz');
        return d;
      },
      readMeetingInfo: async () => ({ title: 'T', date: '2026-10-01' }),
      setEnabled: async (on) => void (flags.enabled = on),
      setNotify: async (on) => void (flags.notify = on),
      remindersActive: async () => false,
    };
    registerMemory(h, service);
    return { call: (c: string, ...a: unknown[]) => handlers.get(c)!(null, ...a) as Promise<any>, flags };
  }
  test('pastas só por checkedDir; entradas inválidas não quebram; opções só aceitam booleano', async () => {
    const s = await setup();
    const { call, flags } = host(s.service);
    await expect(call('memory:brief-meeting', '/etc')).rejects.toThrow();
    await expect(call('followups:add', { text: 'x', dir: '../../etc' })).rejects.toThrow();
    await expect(call('followups:toggle-note-task', '/tmp/x', 't', true)).rejects.toThrow();
    expect(await call('memory:brief-event', { x: 1 })).toBeNull();
    expect(await call('memory:update', 42, null)).toEqual({ ok: false });
    expect(await call('memory:remove', ['x'])).toEqual({ ok: false });
    await call('memory:set-enabled', 'true');
    expect(flags.enabled).toBe(false);
    await call('memory:set-notify', false);
    expect(flags.notify).toBe(false);
    expect(await call('followups:to-reminders', 'mine')).toEqual({ ok: false, count: 0 }); // sem a integração com Lembretes
    expect((await call('followups:add', { text: 'Ligar para o Ze', due: 'amanhã', dir: '/ok/reuniao' })).ok).toBe(true);
    const list = await call('followups:list', 'mine');
    expect(list.groups.week.map((f: { text: string }) => f.text)).toEqual(['Ligar para o Ze']);
  });
  test('o que vai ao renderer é só a visão do fato (sem confiança, sem ids internos de IA)', async () => {
    const v = viewOf(fact({ id: 'x' }));
    expect(Object.keys(v)).not.toContain('confidence');
    expect(Object.keys(v)).not.toContain('updatedAt');
  });
});
