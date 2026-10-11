import { expect, test } from 'vitest';
import { suggestSpeakerNames } from '../../src/main/session/speaker-names';
import { fakeRunner } from '../helpers/fake-runner';

const T = '**[14:00:05] Pessoa 2:** Obrigado, Ana.\n\n**[14:00:09] Pessoa 3:** de nada, pessoal\n';

test('sugestões só para pessoas que existem, com nome limpo; o prompt pede evidência explícita', async () => {
  const runner = fakeRunner(() => 'Claro:\n{"2": "Ana", "3": "  ", "9": "Fantasma", "x": "Y"}');
  expect(await suggestSpeakerNames(runner, T, 'pt')).toEqual({ '2': 'Ana' });
  expect(runner.calls[0]!.system).toContain('Nunca chute');
  expect(runner.calls[0]!.prompt).toContain('Pessoas: 2, 3');
  expect(runner.calls[0]!.prompt).toContain('Obrigado, Ana.');
});

test('resposta fora do formato ou transcrição sem pessoas: vazio, sem chamar a IA quando não há ninguém', async () => {
  expect(await suggestSpeakerNames(fakeRunner(() => 'não sei'), T, 'en')).toEqual({});
  expect(await suggestSpeakerNames(fakeRunner(() => '{quebrado'), T, 'pt')).toEqual({});
  const none = fakeRunner(() => '{"1":"X"}');
  expect(await suggestSpeakerNames(none, '**[14:00:01] Eu:** oi', 'pt')).toEqual({});
  expect(none.calls).toHaveLength(0);
});

test('o nome dado entra nas notas (prompt) no lugar de "Pessoa N"', async () => {
  const { generateNotes } = await import('../../src/main/session/notes');
  const { createMeeting, appendSegment, updateMeta } = await import('../../src/main/store/meeting-files');
  const { makeTmpDir } = await import('../helpers/tmp');
  const startedAt = new Date(2026, 9, 8, 14, 0, 0);
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'x', startedAt, trigger: 'manual' });
  await appendSegment(dir, startedAt, { id: '1', source: 'Outros', speaker: 2, startMs: 1000, endMs: 2000, text: 'o prazo é sexta' });
  await appendSegment(dir, startedAt, { id: '2', source: 'Outros', speaker: 1, startMs: 3000, endMs: 4000, text: 'fechado' });
  await updateMeta(dir, (m) => ({ ...m, speakers: { '2': 'Ana' } }));
  const runner = fakeRunner(() => '## Resumo\n');
  await generateNotes(dir, runner);
  expect(runner.calls[0]!.prompt).toContain('Ana:** o prazo é sexta');
  expect(runner.calls[0]!.prompt).toContain('Pessoa 1:** fechado');
});
