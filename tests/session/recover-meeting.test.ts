import { EventEmitter } from 'node:events';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { recoverMeeting, transcribedUntil } from '../../src/main/session/recover-meeting';
import { StereoWavWriter } from '../../src/main/session/wav-writer';
import { createMeeting, readMeetingText, readMeta, updateMeta } from '../../src/main/store/meeting-files';
import type { AudioFrame } from '../../src/shared/frames';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 0, 0);

/** Pipeline falso: devolve um segmento por 2 s de áudio recebido em cada canal e guarda os frames recebidos. */
class FakePipeline extends EventEmitter {
  frames: AudioFrame[] = [];
  pushFrame(f: AudioFrame) { this.frames.push(f); }
  async finish() {
    for (const source of ['mic', 'sys'] as const) {
      const mine = this.frames.filter((f) => f.source === source);
      if (mine.length === 0) continue;
      this.emit('segment', { id: source, source: source === 'mic' ? 'Eu' : 'Outros', startMs: mine[0]!.timestampMs, endMs: mine.at(-1)!.timestampMs + 100, text: `texto recuperado de ${source}` });
    }
  }
}

async function interruptedMeeting(seconds: number, transcriptLines: string[]) {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Longa', startedAt, trigger: 'manual' });
  await updateMeta(dir, (m) => ({ ...m, state: 'interrupted' }));
  const w = await StereoWavWriter.open(join(dir, 'audio.wav'));
  for (let i = 0; i < seconds * 10; i++) {
    for (const source of ['mic', 'sys'] as const) w.write({ source, timestampMs: i * 100, pcm: Buffer.alloc(3200, 1) });
  }
  await w.close();
  await writeFile(join(dir, 'transcricao.md'), `# T\n\n${transcriptLines.join('\n\n')}\n\n`);
  return dir;
}

const deps = (pipeline: FakePipeline, generateNotes = vi.fn(async () => {})) => ({
  createPipeline: async () => pipeline as never,
  generateNotes,
  language: async () => 'pt' as const,
  keepAudio: () => true,
  encode: async (_w: string, m4a: string) => { await writeFile(m4a, 'm4a'); },
});

test('instante já transcrito por canal, com estimativa do fim da última fala e virada de dia', () => {
  const t = '# T\n\n**[14:00:10] Eu:** olá\n\n**[14:00:20] Outros:** uma fala bem mais comprida para estimar o fim dela\n\n**[13:59:00] Eu:** de uma gravação anterior\n';
  const until = transcribedUntil(t, startedAt);
  expect(until.Eu).toBe(10_000 + 2000);
  expect(until.Outros).toBe(20_000 + 'uma fala bem mais comprida para estimar o fim dela'.length * 65);
  expect(transcribedUntil('**[00:00:05] Eu:** x', new Date(2026, 9, 8, 23, 59, 50)).Eu).toBe(15_000 + 2000);
});

test('Recuperar: transcreve só o que veio depois da última fala, codifica o áudio, fecha a reunião e gera as notas', async () => {
  const dir = await interruptedMeeting(60, ['**[14:00:10] Eu:** primeira fala', '**[14:00:30] Outros:** segunda fala']);
  const pipeline = new FakePipeline();
  const notes = vi.fn(async () => {});
  const result = await recoverMeeting(dir, deps(pipeline, notes));
  expect(result).toMatchObject({ audioRecovered: true, notes: true });
  expect(result.tailSegments).toBe(2); // um por canal
  // não repete o que já tinha texto: o mic só recebe a partir de ~12 s, o sistema só a partir de ~30 s + estimativa
  const mic = pipeline.frames.filter((f) => f.source === 'mic');
  const sys = pipeline.frames.filter((f) => f.source === 'sys');
  expect(mic[0]!.timestampMs).toBeGreaterThanOrEqual(12_000);
  expect(sys[0]!.timestampMs).toBeGreaterThanOrEqual(30_000);
  const text = await readMeetingText(dir, 'transcript');
  expect(text).toContain('primeira fala');
  expect(text).toMatch(/\*\*\[14:00:\d\d\] Eu:\*\* texto recuperado de mic/);
  expect(text).toMatch(/\*\*\[14:00:\d\d\] Outros:\*\* texto recuperado de sys/);
  const meta = await readMeta(dir);
  expect(meta.state).toBe('done');
  expect(meta.sessions!.at(-1)!.endedAt).toBeTruthy();
  expect((await readdir(dir)).sort()).toEqual(expect.arrayContaining(['audio.m4a']));
  expect((await readdir(dir)).some((n) => n.endsWith('.wav'))).toBe(false);
  expect(notes).toHaveBeenCalledOnce();
});

test('nada novo para transcrever (queda logo depois da última fala): só finaliza o áudio e gera as notas', async () => {
  const dir = await interruptedMeeting(5, ['**[14:00:04] Eu:** última fala', '**[14:00:04] Outros:** outra']);
  const pipeline = new FakePipeline();
  const result = await recoverMeeting(dir, deps(pipeline));
  expect(result.tailSegments).toBe(0);
  expect(pipeline.frames).toHaveLength(0);
  expect((await readMeta(dir)).state).toBe('done');
});

test('sem nenhuma fala (nem no áudio): fecha a reunião sem gerar notas vazias', async () => {
  const dir = await interruptedMeeting(2, []);
  const notes = vi.fn(async () => {});
  const result = await recoverMeeting(dir, deps(new FakePipeline(), notes));
  expect(result.notes).toBe(false);
  expect(notes).not.toHaveBeenCalled();
  expect((await readMeta(dir)).state).toBe('done');
});

test('reunião sem WAV órfão (já recuperada): só garante o estado e as notas, sem mexer na transcrição', async () => {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'x', startedAt, trigger: 'manual' });
  await writeFile(join(dir, 'transcricao.md'), '# T\n\n**[14:00:01] Eu:** oi\n\n');
  await updateMeta(dir, (m) => ({ ...m, state: 'interrupted' }));
  const before = await readFile(join(dir, 'transcricao.md'), 'utf8');
  const pipeline = new FakePipeline();
  await recoverMeeting(dir, deps(pipeline));
  expect(await readFile(join(dir, 'transcricao.md'), 'utf8')).toBe(before);
  expect(pipeline.frames).toHaveLength(0);
});
