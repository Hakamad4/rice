// @vitest-environment happy-dom
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DetectorClient } from '../../src/main/session/detector-client';
import { bootRenderer } from '../helpers/boot-renderer';

const FAKE = resolve(__dirname, '../fixtures/fake-rice-detector.mjs');
const clients: DetectorClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((c) => c.stop());
  for (const k of ['FAKE_DETECTOR_SCRIPT', 'FAKE_DETECTOR_REMINDERS', 'FAKE_REMINDERS_AFTER_REQUEST', 'FAKE_REMINDER_OK']) delete process.env[k];
});
const start = (script: object[] = []) => {
  process.env.FAKE_DETECTOR_SCRIPT = JSON.stringify(script);
  const c = new DetectorClient(FAKE);
  clients.push(c);
  c.start();
  return c;
};

const R = [
  { id: 'r1', title: 'Treinar', due: '2026-10-11T07:00:00-03:00', hasTime: true, overdue: false, list: 'Pessoal', color: '#FF9500' },
  { id: 'r2', title: 'Ler livro', due: '2026-10-10T00:00:00-03:00', hasTime: false, overdue: true, list: 'Pessoal' },
  { id: 'bad' }, // sem vencimento: ignorado
];

it('detector: lista, pede permissão e conclui lembretes (fake detector, nada real)', async () => {
  process.env.FAKE_DETECTOR_REMINDERS = JSON.stringify(R);
  const c = start([{ at: 20, line: { event: 'reminders-access', status: 'notDetermined' } }]);
  const access: string[] = [];
  c.on('reminders-access', (s) => access.push(s));
  await vi.waitFor(() => expect(access).toEqual(['notDetermined']));
  c.requestRemindersAccess();
  await vi.waitFor(() => expect(access).toEqual(['notDetermined', 'granted']));
  const items = await c.listReminders();
  expect(items.map((i) => [i.id, i.overdue, i.hasTime])).toEqual([['r1', false, true], ['r2', true, false]]);
  expect(await c.completeReminder('r1')).toBe(true);
  process.env.FAKE_REMINDER_OK = '0';
});

it('detector: concluir que falha devolve false; sem detector, lista vazia e false', async () => {
  process.env.FAKE_REMINDER_OK = '0';
  const c = start();
  await new Promise((r) => setTimeout(r, 100));
  expect(await c.completeReminder('x')).toBe(false);
  const off = new DetectorClient(FAKE);
  expect(await off.listReminders()).toEqual([]);
  expect(await off.completeReminder('x')).toBe(false);
});

const g = globalThis as any;
const tick = () => new Promise((r) => setTimeout(r, 40));
const items = [
  { id: 'r2', title: 'Ler livro', due: '2026-10-10T00:00:00-03:00', hasTime: false, overdue: true, list: 'Pessoal' },
  { id: 'r1', title: 'Treinar', due: '2026-10-11T07:00:00-03:00', hasTime: true, overdue: false, list: 'Pessoal' },
];

async function home(state: object, extra: Record<string, unknown> = {}) {
  const remindersComplete = vi.fn(async () => ({ ok: true }));
  const remindersRequest = vi.fn(async () => ({ access: 'notDetermined' }));
  const openRemindersPrivacy = vi.fn(async () => undefined);
  bootRenderer({ remindersList: async () => state, remindersComplete, remindersRequest, openRemindersPrivacy, ...extra }, []);
  await tick();
  g.document.getElementById('home-link').click();
  await tick();
  await tick();
  return { remindersComplete, remindersRequest, openRemindersPrivacy };
}
const slot = () => g.document.querySelector('.reminders-slot') as any;

it('Início: "Para hoje" com caixinha, hora, atrasado discreto e sem botão de gravar; marcar conclui', async () => {
  const { remindersComplete } = await home({ access: 'granted', enabled: true, items });
  expect(slot().querySelector('.day-label').textContent).toBe('Para hoje');
  const rows = [...slot().querySelectorAll('.rem-row')];
  expect(rows.map((r: any) => r.querySelector('.rem-title').textContent)).toEqual(['Ler livro', 'Treinar']);
  expect(rows[0].querySelector('.rem-late').textContent).toBe('Atrasado');
  expect(rows[1].querySelector('.rem-time').textContent).toMatch(/07:00|7:00/);
  expect(slot().querySelector('button')).toBeNull(); // sem botão de gravar nem de notas
  const box = rows[1].querySelector('.rem-box');
  box.checked = true;
  box.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await tick();
  expect(remindersComplete).toHaveBeenCalledWith('r1');
  expect(rows[1].classList.contains('done')).toBe(true);
});

it('concluir que falha desfaz a marcação', async () => {
  await home({ access: 'granted', enabled: true, items }, { remindersComplete: vi.fn(async () => ({ ok: false })) });
  const box = slot().querySelector('.rem-row .rem-box');
  box.checked = true;
  box.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await tick();
  expect(box.checked).toBe(false);
  expect(slot().querySelector('.rem-row').classList.contains('done')).toBe(false);
});

it('vazio, desligado ou sem resposta: o espaço some', async () => {
  await home({ access: 'granted', enabled: true, items: [] });
  expect(slot().childElementCount).toBe(0);
  await home({ access: 'granted', enabled: false, items });
  expect(slot().childElementCount).toBe(0);
});

it('sem permissão: linha "Mostrar lembretes de hoje" com Permitir; bloqueado leva aos Ajustes', async () => {
  const a = await home({ access: 'notDetermined', enabled: true, items: [] });
  expect(slot().textContent).toContain('Mostrar lembretes de hoje');
  [...slot().querySelectorAll('button')].find((b: any) => b.textContent === 'Permitir').click();
  await tick();
  expect(a.remindersRequest).toHaveBeenCalled();
  const b = await home({ access: 'denied', enabled: true, items: [] });
  [...slot().querySelectorAll('button')].find((x: any) => x.textContent === 'Abrir Ajustes').click();
  await tick();
  expect(b.openRemindersPrivacy).toHaveBeenCalled();
});

it('lembretes não passam pela IA: nenhum arquivo de IA menciona lembretes', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const hits: string[] = [];
  for (const dir of ['src/main/ai', 'src/main/claude', 'src/main/session/notes.ts']) {
    const files = dir.endsWith('.ts') ? [dir] : (await readdir(dir)).map((f) => `${dir}/${f}`);
    for (const f of files) if (/reminder|lembrete/i.test(await readFile(f, 'utf8'))) hits.push(f);
  }
  expect(hits).toEqual([]);
});
