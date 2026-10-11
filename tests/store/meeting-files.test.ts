import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendChat,
  appendGapMarker,
  appendSegment,
  createMeeting,
  formatSegmentLine,
  listMeetingDirs,
  MEETING_FILES,
  readChat,
  readMeetingText,
  readMeta,
  renameMeeting,
  setSpeakerName,
  updateMeta,
  writeAnnotations,
  writeMeta,
  writeNotes,
} from '../../src/main/store/meeting-files';
import type { Segment } from '../../src/shared/types';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 30, 0);
const seg = (startMs: number, text: string, source: Segment['source'] = 'Eu'): Segment => ({
  id: `s${startMs}`,
  source,
  startMs,
  endMs: startMs + 1000,
  text,
});

describe('createMeeting', () => {
  test('cria pasta nomeada, meta.json e transcricao.md com título', async () => {
    const root = await makeTmpDir();
    const { dir, meta } = await createMeeting(root, { title: 'Daily Squad', startedAt, trigger: 'calendar', calendarEventId: 'ev1' });
    expect(basename(dir)).toBe('2026-10-08 1430 - Daily Squad');
    expect(meta).toMatchObject({
      title: 'Daily Squad',
      startedAt: '2026-10-08T14:30:00-03:00',
      state: 'recording',
      trigger: 'calendar',
      calendarEventId: 'ev1',
      notesStatus: 'pending',
      gaps: [],
    });
    expect(meta.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readMeta(dir)).toEqual(meta);
    expect(await readFile(join(dir, MEETING_FILES.transcript), 'utf8')).toBe('# Transcrição — Daily Squad\n\n');
  });

  test('cria a pasta raiz se não existir', async () => {
    const root = join(await makeTmpDir(), 'nao', 'existe');
    const { dir } = await createMeeting(root, { title: 'X', startedAt, trigger: 'manual' });
    expect(dir.startsWith(root)).toBe(true);
  });

  test('mesma hora e título não sobrescreve: adiciona sufixo', async () => {
    const root = await makeTmpDir();
    const a = await createMeeting(root, { title: 'Daily', startedAt, trigger: 'manual' });
    const b = await createMeeting(root, { title: 'Daily', startedAt, trigger: 'manual' });
    const c = await createMeeting(root, { title: 'Daily', startedAt, trigger: 'manual' });
    expect(basename(a.dir)).toBe('2026-10-08 1430 - Daily');
    expect(basename(b.dir)).toBe('2026-10-08 1430 - Daily (2)');
    expect(basename(c.dir)).toBe('2026-10-08 1430 - Daily (3)');
    expect(new Set([a.meta.id, b.meta.id, c.meta.id]).size).toBe(3);
  });

  test('título vazio vira Reunião no meta e na pasta', async () => {
    const root = await makeTmpDir();
    const { dir, meta } = await createMeeting(root, { title: '  ', startedAt, trigger: 'mic', app: 'zoom.us' });
    expect(meta.title).toBe('Reunião');
    expect(basename(dir)).toBe('2026-10-08 1430 - Reunião');
  });
});

test('writeMeta é atômico: não deixa arquivos temporários', async () => {
  const root = await makeTmpDir();
  const { dir, meta } = await createMeeting(root, { title: 'A', startedAt, trigger: 'manual' });
  await writeMeta(dir, { ...meta, state: 'done', endedAt: '2026-10-08T15:00:00-03:00' });
  expect((await readMeta(dir)).state).toBe('done');
  expect((await readdir(dir)).sort()).toEqual([MEETING_FILES.meta, MEETING_FILES.transcript].sort());
});

describe('transcrição', () => {
  test('formatSegmentLine usa relógio local = início + offset', () => {
    expect(formatSegmentLine(startedAt, seg(65_000, '  Bom dia a todos  ', 'Outros'))).toBe(
      '**[14:31:05] Outros:** Bom dia a todos\n\n',
    );
  });

  test('appendSegment acumula linhas na ordem', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'A', startedAt, trigger: 'manual' });
    await appendSegment(dir, startedAt, seg(0, 'um'));
    await appendSegment(dir, startedAt, seg(1000, 'dois', 'Outros'));
    expect(await readMeetingText(dir, 'transcript')).toBe(
      '# Transcrição — A\n\n**[14:30:00] Eu:** um\n\n**[14:30:01] Outros:** dois\n\n',
    );
  });

  test('appendGapMarker escreve o intervalo interrompido', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'A', startedAt, trigger: 'manual' });
    await appendGapMarker(dir, startedAt, 120_000, 185_000);
    expect(await readMeetingText(dir, 'transcript')).toContain('*[áudio interrompido 14:32–14:33]*\n\n');
  });
});

test('anotações, notas e chat', async () => {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'A', startedAt, trigger: 'manual' });
  expect(await readMeetingText(dir, 'notes')).toBe('');
  await writeAnnotations(dir, '- decidir orçamento');
  await writeAnnotations(dir, '- decidir orçamento até sexta');
  await writeNotes(dir, '## Resumo\nok\n');
  await appendChat(dir, new Date(2026, 9, 8, 14, 40, 0), 'Qual o prazo?', 'Sexta.');
  await appendChat(dir, new Date(2026, 9, 8, 14, 41, 0), 'Quem?', 'Ana.');
  expect(await readMeetingText(dir, 'annotations')).toBe('- decidir orçamento até sexta');
  expect(await readMeetingText(dir, 'notes')).toBe('## Resumo\nok\n');
  expect(await readMeetingText(dir, 'chat')).toBe(
    '### [14:40:00] Você\nQual o prazo?\n\n### Rice\nSexta.\n\n### [14:41:00] Você\nQuem?\n\n### Rice\nAna.\n\n',
  );
});

test('listMeetingDirs ignora pastas sem meta.json e arquivos soltos', async () => {
  const root = await makeTmpDir();
  const a = await createMeeting(root, { title: 'B', startedAt, trigger: 'manual' });
  const b = await createMeeting(root, { title: 'A', startedAt, trigger: 'manual' });
  await mkdir(join(root, 'lixo'));
  await writeFile(join(root, 'solto.txt'), 'x');
  expect(await listMeetingDirs(root)).toEqual([b.dir, a.dir]);
});

test('listMeetingDirs em raiz inexistente devolve lista vazia', async () => {
  expect(await listMeetingDirs(join(await makeTmpDir(), 'nada'))).toEqual([]);
});

describe('escrita atômica e chat estruturado', () => {
  test('writeAnnotations/writeNotes não deixam .tmp', async () => {
    const { dir } = await createMeeting(await makeTmpDir(), { title: 'X', startedAt, trigger: 'manual' });
    await writeAnnotations(dir, 'a');
    await writeNotes(dir, 'n');
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(await readMeetingText(dir, 'annotations')).toBe('a');
    expect(await readMeetingText(dir, 'notes')).toBe('n');
  });

  test('writeAnnotations concorrente nunca mistura conteúdo', async () => {
    const { dir } = await createMeeting(await makeTmpDir(), { title: 'X', startedAt, trigger: 'manual' });
    const inputs = Array.from({ length: 10 }, (_, i) => `${i}:`.repeat(50_000));
    await Promise.all(inputs.map((t) => writeAnnotations(dir, t)));
    expect(inputs).toContain(await readMeetingText(dir, 'annotations'));
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('readChat faz round-trip com markdown e "### Rice"', async () => {
    const { dir } = await createMeeting(await makeTmpDir(), { title: 'X', startedAt, trigger: 'manual' });
    expect(await readChat(dir)).toEqual([]);
    const a1 = 'Resposta\n\n### Rice\n- item\n- outro\n\n```ts\nx\n```';
    await appendChat(dir, startedAt, 'Pergunta 1?', a1);
    await appendChat(dir, startedAt, 'Pergunta 2?', 'ok');
    expect(await readChat(dir)).toEqual([
      { question: 'Pergunta 1?', answer: a1.trim() },
      { question: 'Pergunta 2?', answer: 'ok' },
    ]);
    expect(await readMeetingText(dir, 'chat')).toContain('### Rice');
    expect(MEETING_FILES.chatLog).toBe('chat.jsonl');
  });

  test('readChat ignora linhas malformadas', async () => {
    const { dir } = await createMeeting(await makeTmpDir(), { title: 'X', startedAt, trigger: 'manual' });
    await writeFile(join(dir, MEETING_FILES.chatLog), 'lixo\n{"question":"q","answer":"a"}\n{"x":1}\n');
    expect(await readChat(dir)).toEqual([{ question: 'q', answer: 'a' }]);
  });

  test('título colapsa quebras de linha e tabs', async () => {
    const { meta } = await createMeeting(await makeTmpDir(), { title: 'Daily\n\tSquad', startedAt, trigger: 'manual' });
    expect(meta.title).toBe('Daily Squad');
  });
});

describe('renameMeeting', () => {
  test('atualiza o título no meta.json sem renomear a pasta', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'Antigo', startedAt: new Date('2026-10-08T14:30:00-03:00'), trigger: 'manual' });
    const meta = await renameMeeting(dir, '  Planejamento   Q4 ');
    expect(meta.title).toBe('Planejamento Q4');
    expect((await readMeta(dir)).title).toBe('Planejamento Q4');
    expect((await listMeetingDirs(root))[0]).toBe(dir);
  });

  test('título vazio é erro e não altera nada', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'Antigo', startedAt: new Date(), trigger: 'manual' });
    await expect(renameMeeting(dir, '   ')).rejects.toThrow('O título não pode ficar vazio.');
    expect((await readMeta(dir)).title).toBe('Antigo');
  });
});

describe('escritas concorrentes no meta.json', () => {
  test('renomear durante outras atualizações do meta não perde nenhuma (read-modify-write serializado)', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'Antigo', startedAt: new Date(), trigger: 'manual' });
    for (let i = 0; i < 25; i++) {
      await Promise.all([
        updateMeta(dir, (m) => ({ ...m, gaps: [...m.gaps, { fromMs: i, toMs: i + 1, reason: 'audio-restart' }] })),
        renameMeeting(dir, `Título ${i}`),
        updateMeta(dir, (m) => ({ ...m, state: 'done' })),
      ]);
      const meta = await readMeta(dir);
      expect(meta.title).toBe(`Título ${i}`);
      expect(meta.gaps).toHaveLength(i + 1);
    }
  });

  test('acentos, emoji e título longo sobrevivem ao renomear', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'x', startedAt: new Date(), trigger: 'manual' });
    const long = `Reunião ção 🍚 ${'a'.repeat(300)}`;
    expect((await renameMeeting(dir, long)).title).toBe(long);
    expect((await readMeta(dir)).title).toBe(long);
  });
});

test('createMeeting grava templateId no meta quando informado', async () => {
  const root = await makeTmpDir();
  const { dir, meta } = await createMeeting(root, { title: 'T', startedAt: new Date(2026, 9, 8, 14, 0), trigger: 'manual', templateId: 'brainstorm' });
  expect(meta.templateId).toBe('brainstorm');
  expect((await readMeta(dir)).templateId).toBe('brainstorm');
  const other = await createMeeting(root, { title: 'T2', startedAt: new Date(2026, 9, 8, 15, 0), trigger: 'manual' });
  expect('templateId' in other.meta).toBe(false);
});

describe('pessoas identificadas', () => {
  test('segmento do sistema com pessoa grava "Pessoa N"; sem pessoa e o microfone ficam como antes', () => {
    const at = new Date(2026, 9, 8, 14, 0, 0);
    expect(formatSegmentLine(at, { id: '1', source: 'Outros', speaker: 2, startMs: 1000, endMs: 2000, text: 'oi' })).toBe('**[14:00:01] Pessoa 2:** oi\n\n');
    expect(formatSegmentLine(at, { id: '1', source: 'Outros', startMs: 1000, endMs: 2000, text: 'oi' })).toBe('**[14:00:01] Outros:** oi\n\n');
    expect(formatSegmentLine(at, { id: '1', source: 'Eu', speaker: 2, startMs: 1000, endMs: 2000, text: 'oi' })).toBe('**[14:00:01] Eu:** oi\n\n');
  });

  test('setSpeakerName grava em meta.speakers, troca, remove e some do meta quando vazio', async () => {
    const root = await makeTmpDir();
    const { dir } = await createMeeting(root, { title: 'x', startedAt: new Date(2026, 9, 8, 14, 0), trigger: 'manual' });
    expect(await setSpeakerName(dir, 2, 'Ana')).toEqual({ '2': 'Ana' });
    expect(await setSpeakerName(dir, 1, 'Bruno')).toEqual({ '1': 'Bruno', '2': 'Ana' });
    expect((await readMeta(dir)).speakers).toEqual({ '1': 'Bruno', '2': 'Ana' });
    await setSpeakerName(dir, 1, '');
    expect(await setSpeakerName(dir, 2, '')).toEqual({});
    expect('speakers' in (await readMeta(dir))).toBe(false);
  });
});
