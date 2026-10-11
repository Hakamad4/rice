import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { chatTranscript, keywordsOf } from '../../src/main/session/chat-context';
import { generateNotes } from '../../src/main/session/notes';
import { buildChatPrompt } from '../../src/main/claude/prompts';
import { createMeeting } from '../../src/main/store/meeting-files';
import { fakeRunner } from '../helpers/fake-runner';
import { syntheticTranscript } from '../helpers/long-transcript';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 0, 0);

async function longMeeting() {
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'Planejamento', startedAt, trigger: 'manual' });
  const t = syntheticTranscript({ minutes: 120, startedAt });
  // uma fala única no meio da reunião, que a pergunta vai procurar
  const text = t.text.replace('no item 700 sobre', 'o fornecedor Zeferino aprovou o desconto de quinze por cento sobre');
  await writeFile(join(dir, 'transcricao.md'), text);
  return { dir, text };
}

test('palavras-chave: sem acento, sem as comuns, sem repetir', () => {
  expect(keywordsOf('Quando o Zeferino aprovou o desconto? E o desconto de quanto?')).toEqual(['zeferino', 'aprovou', 'desconto', 'quanto']);
});

test('reunião curta: o chat recebe a transcrição inteira, como antes', async () => {
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'x', startedAt, trigger: 'manual' });
  expect(await chatTranscript(dir, 'abc', 'qualquer coisa?', 'pt')).toBe('abc');
});

test('reunião de 2 h: o chat recebe o trecho relevante da pergunta, em até 60 mil caracteres, e não a fala inteira', async () => {
  const { dir, text } = await longMeeting();
  expect(text.length).toBeGreaterThan(120_000);
  const out = await chatTranscript(dir, text, 'O que o Zeferino decidiu sobre o desconto?', 'pt');
  expect(out.length).toBeLessThanOrEqual(60_000);
  expect(out).toContain('o fornecedor Zeferino aprovou o desconto de quinze por cento');
  expect(out).not.toContain('no item 3 ');
  expect(out).toContain('Trechos da transcrição');
});

test('com as notas já geradas, as extrações por parte vão junto (metade do orçamento no máximo)', async () => {
  const { dir, text } = await longMeeting();
  await generateNotes(dir, fakeRunner((_c, i) => (i < 8 ? `- [14:00:10] decisão da parte ${i + 1}` : '## Resumo\n')));
  const out = await chatTranscript(dir, text, 'O que o Zeferino decidiu?', 'pt');
  expect(out).toContain('Resumo da reunião por partes');
  for (let i = 1; i <= 8; i++) expect(out).toContain(`decisão da parte ${i}`);
  expect(out.length).toBeLessThanOrEqual(60_000);
  expect(out).toContain('Zeferino aprovou');
});

test('pergunta sem palavra útil: entram os trechos mais recentes; em inglês os rótulos mudam', async () => {
  const { dir, text } = await longMeeting();
  const out = await chatTranscript(dir, text, 'e agora?', 'en');
  expect(out).toContain('Transcript excerpts');
  expect(out).toContain('no item 1199 ');
  const prompt = buildChatPrompt({ title: 'x', startedAt: 'y', transcript: out, annotations: '' }, [], 'e agora?', 'en');
  expect(prompt.length).toBeLessThan(62_000);
});
