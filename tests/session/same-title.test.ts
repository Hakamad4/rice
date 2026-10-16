import { EventEmitter } from 'node:events';
import { readdir } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { MeetingSession } from '../../src/main/session/meeting-session';
import { createMeeting, listMeetingDirs, readMeetingText, readMeta } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

class FakeCapture extends EventEmitter {
  start() {}
  async stop() { this.emit('exit', { code: 0, signal: null, expected: true }); }
  emitFrames(n: number) {
    for (let i = 0; i < n; i++) for (const source of ['mic', 'sys'] as const) this.emit('frame', { source, timestampMs: i * 100, pcm: Buffer.alloc(3200, 1) });
  }
}
class FakePipeline extends EventEmitter {
  mic = 0;
  constructor(private readonly tag: string) { super(); }
  pushFrame(f: { source: string; timestampMs: number }) {
    if (f.source === 'mic' && ++this.mic % 10 === 0) this.emit('segment', { id: String(this.mic), source: 'Eu', startMs: f.timestampMs - 900, endMs: f.timestampMs + 100, text: `fala ${this.tag}` });
  }
  async finish() {}
  retry() {}
  async flush() {}
}

async function rig() {
  const root = await makeTmpDir();
  const captures: FakeCapture[] = [];
  let clock = new Date(2026, 9, 8, 10, 0);
  let n = 0;
  const session = new MeetingSession({
    root: async () => root,
    createCapture: () => { const c = new FakeCapture(); captures.push(c); return c as never; },
    createPipeline: async () => new FakePipeline(`reunião-${++n}`) as never,
    generateNotes: vi.fn(async () => {}),
    keepAudio: () => false,
    now: () => clock,
    restartDelayMs: 1,
  } as never);
  return { root, session, captures, at: (d: Date) => (clock = d) };
}

/** Grava uma reunião inteira (do início ao fim) e devolve a pasta. */
async function record(r: Awaited<ReturnType<typeof rig>>, input: Parameters<MeetingSession['start']>[0]) {
  const dir = await r.session.start(input);
  r.captures.at(-1)!.emitFrames(20);
  await r.session.stop();
  return dir;
}

test('"Daily" em dias diferentes (e duas vezes no mesmo minuto): cada gravação vira a sua pasta, com a sua transcrição', async () => {
  const r = await rig();
  r.at(new Date(2026, 9, 8, 10, 0));
  const d1 = await record(r, { title: 'Daily', trigger: 'manual' });
  r.at(new Date(2026, 9, 9, 10, 0));
  const d2 = await record(r, { title: 'Daily', trigger: 'manual' });
  const d3 = await record(r, { title: 'Daily', trigger: 'manual' }); // mesmo dia e minuto
  expect(new Set([d1, d2, d3]).size).toBe(3);
  expect(await listMeetingDirs(r.root)).toHaveLength(3);
  for (const [i, d] of [d1, d2, d3].entries()) {
    expect((await readMeta(d)).state).toBe('done');
    expect(await readMeetingText(d, 'transcript'), `pasta ${i + 1}`).toContain(`fala reunião-${i + 1}`);
  }
});

test('evento recorrente da agenda: o rascunho de cada ocorrência é reaproveitado só por ela e o de ontem não é gravado por cima', async () => {
  const r = await rig();
  const occurrence = (day: number) => ({ id: `ics:daily-uid:2026-10-0${day}T13:00:00.000Z`, title: 'Daily' });
  const drafts: string[] = [];
  for (const day of [8, 9]) {
    r.at(new Date(2026, 9, day, 10, 0));
    const ev = occurrence(day);
    const draft = await createMeeting(r.root, { title: ev.title, startedAt: new Date(2026, 9, day, 9, 0), trigger: 'manual', state: 'draft', calendarEventId: ev.id });
    drafts.push(draft.dir);
    expect(await record(r, { title: ev.title, trigger: 'calendar', calendarEventId: ev.id, dir: draft.dir })).toBe(draft.dir);
  }
  expect(await readdir(r.root)).toHaveLength(2);
  for (const d of drafts) expect((await readMeta(d)).state).toBe('done');
  expect(await readMeetingText(drafts[0]!, 'transcript')).toContain('fala reunião-1');
  expect(await readMeetingText(drafts[1]!, 'transcript')).toContain('fala reunião-2');
});

test('gravar pelo aviso da agenda sem rascunho (trigger calendar) em dois dias: duas pastas', async () => {
  const r = await rig();
  r.at(new Date(2026, 9, 8, 10, 0));
  const d1 = await record(r, { title: 'Daily', trigger: 'calendar', calendarEventId: 'ics:daily-uid:2026-10-08T13:00:00.000Z' });
  r.at(new Date(2026, 9, 9, 10, 0));
  const d2 = await record(r, { title: 'Daily', trigger: 'calendar', calendarEventId: 'ics:daily-uid:2026-10-09T13:00:00.000Z' });
  expect(d1).not.toBe(d2);
  expect(await readMeetingText(d2, 'transcript')).toContain('fala reunião-2');
});

test('estado "preso" (Gravar retomou a daily de ontem): 2 sessões em meta.sessions e as duas falas na mesma transcrição', async () => {
  const r = await rig();
  r.at(new Date(2026, 9, 8, 10, 0));
  const dir = await record(r, { title: 'Daily', trigger: 'manual' });
  r.at(new Date(2026, 9, 9, 10, 0));
  expect(await record(r, { title: 'Reunião', trigger: 'manual', dir })).toBe(dir); // o botão antigo passava o dir da reunião aberta
  const meta = await readMeta(dir);
  expect(meta.sessions).toHaveLength(2);
  expect(meta.sessions!.map((s) => s.startedAt.slice(0, 10))).toEqual(['2026-10-08', '2026-10-09']);
  expect(meta.sessions!.every((s) => s.endedAt)).toBe(true);
  expect(meta.title).toBe('Daily');
  const transcript = await readMeetingText(dir, 'transcript');
  expect(transcript).toMatch(/\*\[gravação retomada às \d\d:\d\d\]\*/); // a linha que marca onde a 2ª sessão começa (ponto de corte para separar)
  expect(transcript).toContain('fala reunião-1');
  expect(transcript).toContain('fala reunião-2');
  expect(await readdir(r.root)).toHaveLength(1); // só a pasta da 1ª: é daqui que a 2ª precisa ser separada
});
