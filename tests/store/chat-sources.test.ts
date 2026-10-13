import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { appendGlobalTurn, globalChatFile, readGlobalConversation } from '../../src/main/store/global-chat';
import { appendChat, createMeeting, MEETING_FILES, readChat } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const SRC = [{ url: 'https://nodejs.org/en', title: 'Node.js' }, { url: 'https://endoflife.date/nodejs', title: 'endoflife.date' }];
const at = new Date(2026, 9, 13, 10);

async function meeting() {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Sync', startedAt: at, trigger: 'manual', state: 'draft' });
  return { root, dir };
}

describe('fontes da web no chat da reunião', () => {
  test('gravadas junto da resposta e lidas de volta; o chat.md não muda', async () => {
    const { dir } = await meeting();
    await appendChat(dir, at, 'versão LTS?', 'A 24.', SRC);
    await appendChat(dir, at, 'sem busca', 'ok');
    const turns = await readChat(dir);
    expect(turns).toEqual([{ question: 'versão LTS?', answer: 'A 24.', sources: SRC }, { question: 'sem busca', answer: 'ok' }]);
    expect(await readFile(join(dir, MEETING_FILES.chat), 'utf8')).not.toContain('nodejs.org');
    const jsonl = (await readFile(join(dir, MEETING_FILES.chatLog), 'utf8')).trim().split('\n');
    expect(JSON.parse(jsonl[1]!)).not.toHaveProperty('sources'); // sem busca, o formato é o de sempre
  });

  test('histórico antigo (sem o campo) continua legível', async () => {
    const { dir } = await meeting();
    await writeFile(join(dir, MEETING_FILES.chatLog), `${JSON.stringify({ at: '2026-10-01T10:00:00-03:00', question: 'q', answer: 'a' })}\n`);
    expect(await readChat(dir)).toEqual([{ question: 'q', answer: 'a' }]);
    await appendChat(dir, at, 'nova', 'resposta', SRC); // misturar antigo e novo no mesmo arquivo
    expect((await readChat(dir)).map((t) => t.sources?.length ?? 0)).toEqual([0, 2]);
  });

  test('lixo no campo: só passam fontes https válidas; o resto é ignorado sem derrubar a leitura', async () => {
    const { dir } = await meeting();
    const bad = { question: 'q', answer: 'a', sources: [{ url: 'javascript:alert(1)', title: 'x' }, { url: 'http://inseguro.com', title: 'y' }, 42, null, { url: 'https://ok.com/p', title: '<b>t</b>' }] };
    await writeFile(join(dir, MEETING_FILES.chatLog), `${JSON.stringify(bad)}\n${JSON.stringify({ question: 'q2', answer: 'a2', sources: 'não é lista' })}\n`);
    expect(await readChat(dir)).toEqual([{ question: 'q', answer: 'a', sources: [{ url: 'https://ok.com/p', title: '<b>t</b>' }] }, { question: 'q2', answer: 'a2' }]);
  });
});

describe('fontes da web no chat global', () => {
  const turn = { question: 'q', answer: 'a', scope: { kind: 'all' as const }, citations: [], terms: [] };

  test('gravadas no turno e lidas de volta; turnos antigos sem o campo seguem iguais', async () => {
    const root = await makeTmpDir();
    await appendGlobalTurn(root, { ...turn, sources: SRC }, at);
    await appendGlobalTurn(root, turn, at);
    await appendFile(globalChatFile(root), `${JSON.stringify({ type: 'turn', at: '2026-10-01T10:00:00-03:00', question: 'velho', answer: 'formato antigo', scope: { kind: 'all' }, citations: [], terms: [] })}\n`);
    const read = await readGlobalConversation(root);
    expect(read.map((t) => t.sources)).toEqual([SRC, undefined, undefined]);
    expect(read[2]).toMatchObject({ question: 'velho', answer: 'formato antigo' });
  });

  test('só https válido sobrevive à leitura', async () => {
    const root = await makeTmpDir();
    await appendGlobalTurn(root, { ...turn, sources: [{ url: 'http://x.com', title: 'a' }, { url: 'https://y.com/z', title: 'b' }] }, at);
    expect((await readGlobalConversation(root))[0]!.sources).toEqual([{ url: 'https://y.com/z', title: 'b' }]);
  });
});
