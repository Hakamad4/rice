// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const NOW = new Date(2026, 9, 15, 15, 0, 0);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

afterEach(() => vi.useRealTimers());

/** Abre uma reunião "Daily" (já gravada, ou rascunho) cuja última sessão terminou `endedMin` minutos antes de NOW e clica em Gravar. */
async function clickRecord(opts: { state?: string; endedMin: number; events?: unknown[] }) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const state = opts.state ?? 'done';
  const meta = { title: 'Daily', state, startedAt: ago(opts.endedMin + 20), endedAt: ago(opts.endedMin), sessions: [{ startedAt: ago(opts.endedMin + 20), endedAt: ago(opts.endedMin) }], notesStatus: 'done' };
  const startRecording = vi.fn(async (input: { dir?: string }) => ({ ok: true, dir: input.dir ?? '/R/nova' }));
  const createMeeting = vi.fn(async () => '/R/rascunho-evento');
  const t = bootRenderer({ startRecording, createMeeting, calendarEvents: async () => opts.events ?? [] }, [{ dir: '/R/daily', ...meta }]);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  g.document.getElementById('rec').click();
  await vi.waitFor(() => expect(startRecording).toHaveBeenCalled());
  return { startRecording, createMeeting, t };
}

it('ontem: o botão Gravar cria uma reunião NOVA (não grava em cima da daily de ontem)', async () => {
  const { startRecording } = await clickRecord({ endedMin: 24 * 60 + 5 });
  expect(startRecording).toHaveBeenCalledWith({ title: 'Reunião' }); // sem dir
});

it('hoje, mas há 3 h: reunião nova', async () => {
  const { startRecording } = await clickRecord({ endedMin: 180 });
  expect(startRecording).toHaveBeenCalledWith({ title: 'Reunião' });
});

it('hoje, há 10 min: retoma a mesma reunião e mostra o aviso com "Começar uma nova"', async () => {
  const { startRecording } = await clickRecord({ endedMin: 10 });
  expect(startRecording).toHaveBeenCalledWith({ title: 'Reunião', dir: '/R/daily' });
  await vi.waitFor(() => expect(g.document.querySelector('.consent-toast')).not.toBeNull());
  const toast = g.document.querySelector('.consent-toast');
  expect(toast.textContent).toContain('Continuando esta reunião');
  expect(toast.querySelector('button').textContent).toBe('Começar uma nova');
});

it('rascunho aberto: usa o rascunho, sem importar a data', async () => {
  const { startRecording } = await clickRecord({ state: 'draft', endedMin: 24 * 60 * 3 });
  expect(startRecording).toHaveBeenCalledWith({ title: 'Reunião', dir: '/R/daily' });
});

it('reunião nova com evento da agenda em andamento: título e nota própria da ocorrência', async () => {
  const events = [
    { id: 'ics:daily:2026-10-15T14:30', title: 'Daily', start: ago(30), end: new Date(NOW.getTime() + 30 * 60_000).toISOString(), attendees: 3 },
    { id: 'x', title: 'Outro, amanhã', start: new Date(NOW.getTime() + 86_400_000).toISOString(), end: new Date(NOW.getTime() + 90_000_000).toISOString(), attendees: 1 },
  ];
  const { startRecording, createMeeting } = await clickRecord({ endedMin: 24 * 60 + 5, events });
  expect(createMeeting).toHaveBeenCalledWith('Daily', 'ics:daily:2026-10-15T14:30');
  expect(startRecording).toHaveBeenCalledWith({ title: 'Daily', dir: '/R/rascunho-evento' });
});

it('regra pura: limites de 60 min, meia-noite e meta antiga sem sessions', () => {
  bootRenderer();
  const r = g.window.RiceResume;
  const at = (h: number, m: number) => new Date(2026, 9, 15, h, m);
  expect(r.shouldResume({ startedAt: at(9, 0).toISOString(), sessions: [{ startedAt: at(9, 0).toISOString(), endedAt: at(10, 1).toISOString() }] }, at(11, 0))).toBe(true);
  expect(r.shouldResume({ startedAt: at(9, 0).toISOString(), sessions: [{ startedAt: at(9, 0).toISOString(), endedAt: at(10, 0).toISOString() }] }, at(11, 0))).toBe(false);
  expect(r.shouldResume({ startedAt: new Date(2026, 9, 14, 23, 0).toISOString(), endedAt: new Date(2026, 9, 14, 23, 50).toISOString() }, at(0, 10))).toBe(false); // virou o dia
  // vale a ÚLTIMA sessão, não a primeira
  expect(r.shouldResume({ startedAt: at(8, 0).toISOString(), sessions: [{ startedAt: at(8, 0).toISOString(), endedAt: at(8, 30).toISOString() }, { startedAt: at(10, 30).toISOString(), endedAt: at(10, 50).toISOString() }] }, at(11, 0))).toBe(true);
  expect(r.shouldResume(null, at(11, 0))).toBe(false);
});
