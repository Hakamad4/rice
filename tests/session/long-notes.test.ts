import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { DEFAULT_DIRECT_MAX_CHARS, configureLongNotes, parseLines, readDigest, splitTranscript, type NotesProgress } from '../../src/main/session/long-notes';
import { generateNotes, regenerateNotes } from '../../src/main/session/notes';
import { saveAnnotations } from '../../src/main/store/annotations';
import { createMeeting, readMeetingText, readMeta } from '../../src/main/store/meeting-files';
import { fakeRunner } from '../helpers/fake-runner';
import { syntheticTranscript } from '../helpers/long-transcript';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 0, 0);
const progress: NotesProgress[] = [];

beforeEach(() => {
  progress.length = 0;
  configureLongNotes({ directMaxChars: DEFAULT_DIRECT_MAX_CHARS, onProgress: (p) => progress.push(p) });
});
afterEach(() => configureLongNotes({ directMaxChars: DEFAULT_DIRECT_MAX_CHARS, onProgress: () => {} }));

async function meetingWith(minutes: number) {
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'Planejamento', startedAt, trigger: 'manual' });
  const t = syntheticTranscript({ minutes, startedAt });
  await writeFile(join(dir, 'transcricao.md'), t.text);
  return { dir, ...t };
}

test('a transcrição sintética de 2 h tem o tamanho esperado (18-20 mil palavras)', () => {
  const t = syntheticTranscript({ minutes: 120, startedAt });
  expect(t.words).toBeGreaterThan(17_000);
  expect(t.words).toBeLessThan(20_500);
  expect(t.text.length).toBeGreaterThan(DEFAULT_DIRECT_MAX_CHARS * 2);
});

test('divide em partes de ~15 min, em ordem, com ~1 min de sobreposição e sem perder nenhuma fala', () => {
  const t = syntheticTranscript({ minutes: 120, startedAt });
  const parts = splitTranscript(t.text);
  expect(parts).toHaveLength(8);
  expect(parts.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(parts[0]!.from).toBe('14:00:00');
  expect(parts[1]!.from < parts[0]!.to).toBe(true); // sobreposição
  const seen = new Set(parts.flatMap((p) => p.text.match(/no item (\d+) /g) ?? []));
  expect(seen.size).toBe(t.lines);
  for (const p of parts) expect(p.text.length).toBeLessThan(40_000);
});

test('sobra curta no fim junta na parte anterior; reunião curta vira uma parte; virada da meia-noite segue crescendo', () => {
  const t = syntheticTranscript({ minutes: 32, startedAt });
  expect(splitTranscript(t.text).map((p) => p.index)).toEqual([1, 2]);
  expect(splitTranscript(syntheticTranscript({ minutes: 10, startedAt }).text)).toHaveLength(1);
  const night = parseLines('**[23:59:58] Eu:** a\n\n**[00:00:03] Eu:** b\n\n*[áudio interrompido]*\n');
  expect(night.map((l) => l.ms)).toEqual([86_398_000, 86_403_000, 86_403_000]);
});

test('2 h: extrai 8 partes em ordem e depois escreve as notas a partir das extrações e das anotações', async () => {
  const { dir } = await meetingWith(120);
  await saveAnnotations(dir, 'confirmar orçamento', new Date(2026, 9, 8, 14, 40, 0), true);
  const runner = fakeRunner(({ prompt }, i) => (i < 8 ? `## Tópicos\n- [14:00:10] extração ${i + 1}` : '## Resumo\n\n- <!--u:1-->confirmar orçamento<!--/u--> fechado\n'));
  await generateNotes(dir, runner);
  expect(runner.calls).toHaveLength(9);
  runner.calls.slice(0, 8).forEach((c, i) => {
    expect(c.prompt).toContain(`Parte ${i + 1} de 8`);
    expect(c.system).toContain('reunião longa');
  });
  // as partes seguem a ordem do tempo
  const firstItems = runner.calls.slice(0, 8).map((c) => Number(/no item (\d+) /.exec(c.prompt)![1]));
  expect([...firstItems].sort((a, b) => a - b)).toEqual(firstItems);
  // o passo final recebe as extrações (não a fala inteira) e as anotações
  const final = runner.calls[8]!.prompt;
  for (let i = 1; i <= 8; i++) expect(final).toContain(`extração ${i}`);
  expect(final).not.toContain('no item 700 ');
  expect(final).toContain('[1] (14:40:00) confirmar orçamento');
  expect(final.length).toBeLessThan(15_000);
  expect(await readMeetingText(dir, 'notes')).toContain('<!--u:1-->confirmar orçamento<!--/u-->');
  expect((await readMeta(dir)).notesStatus).toBe('done');
  // progresso: parte 1..8 de 8, depois a escrita, depois fim
  expect(progress.filter((p) => p.phase === 'extract').map((p) => [p.part, p.total])).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 8]));
  expect(progress.at(-1)).toEqual({ dir, phase: 'done' });
  expect(progress.map((p) => p.phase).slice(-3)).toEqual(['extract', 'write', 'done']);
  // as extrações ficam guardadas
  expect((await readDigest(dir))!.parts).toHaveLength(8);
});

test('reunião curta: uma única chamada, sem extrações', async () => {
  const { dir } = await meetingWith(20);
  const runner = fakeRunner(() => '## Resumo\n');
  await generateNotes(dir, runner);
  expect(runner.calls).toHaveLength(1);
  expect(await readDigest(dir)).toBeNull();
  expect(progress.map((p) => p.phase)).toEqual(['write', 'done']);
});

test('o limite é configurável', async () => {
  const { dir } = await meetingWith(20);
  configureLongNotes({ directMaxChars: 5_000 });
  const runner = fakeRunner(() => '## Resumo\n');
  await generateNotes(dir, runner);
  expect(runner.calls.length).toBeGreaterThan(1);
});

test('regerar com outro template reaproveita as extrações (só o passo final roda de novo)', async () => {
  const { dir } = await meetingWith(120);
  const first = fakeRunner((_c, i) => (i < 8 ? `extração ${i + 1}` : '## Resumo\n'));
  await generateNotes(dir, first);
  const second = fakeRunner(() => '## Outro\n');
  await regenerateNotes(dir, second, 'daily');
  expect(second.calls).toHaveLength(1);
  expect(second.calls[0]!.prompt).toContain('extração 8');
});

test('falha numa parte: marca failed, mantém as extrações prontas e a próxima tentativa continua dali', async () => {
  const { dir } = await meetingWith(120);
  const failing = fakeRunner((_c, i) => {
    if (i === 3) throw new Error('limite de uso');
    return `extração ${i + 1}`;
  });
  await expect(generateNotes(dir, failing)).rejects.toThrow('limite de uso');
  expect((await readMeta(dir)).notesStatus).toBe('failed');
  expect((await readDigest(dir))!.parts).toHaveLength(3);
  const retry = fakeRunner((_c, i) => (i < 5 ? `retomada ${i + 4}` : '## Resumo\n'));
  await generateNotes(dir, retry);
  expect(retry.calls).toHaveLength(6); // 5 partes que faltavam + o passo final
  expect(JSON.parse(await readFile(join(dir, 'extracoes.json'), 'utf8')).parts).toHaveLength(8);
});
