import { expect, test } from 'vitest';
import { generateNotes, keepAnnotations } from '../../src/main/session/notes';
import { saveAnnotations } from '../../src/main/store/annotations';
import { appendSegment, createMeeting, readMeetingText } from '../../src/main/store/meeting-files';
import { fakeRunner } from '../helpers/fake-runner';
import { makeTmpDir } from '../helpers/tmp';

const startedAt = new Date(2026, 9, 8, 14, 0, 0);

async function meeting(notes: string[]) {
  const { dir } = await createMeeting(await makeTmpDir(), { title: 'Daily', startedAt, trigger: 'manual' });
  await appendSegment(dir, startedAt, { id: '1', source: 'Outros', startMs: 190_000, endMs: 200_000, text: 'o orçamento fecha na sexta' });
  await saveAnnotations(dir, notes.join('\n'), new Date(2026, 9, 8, 14, 3, 12), true);
  return dir;
}

test('o prompt leva as anotações numeradas, com o horário, como pontos importantes do usuário', async () => {
  const dir = await meeting(['confirmar orçamento', 'ligar para a Ana']);
  const runner = fakeRunner(() => '## Resumo\n\n- tudo\n');
  await generateNotes(dir, runner);
  const { prompt } = runner.calls[0]!;
  expect(prompt).toContain('[1] (14:03:12) confirmar orçamento');
  expect(prompt).toContain('[2] (14:03:12) ligar para a Ana');
  expect(prompt).toContain('<!--u:2-->');
  expect(prompt).toContain('Outros pontos');
});

test('em inglês o prompt pede "Other notes"', async () => {
  const dir = await meeting(['check budget']);
  const runner = fakeRunner(() => '## Summary\n');
  await generateNotes(dir, runner, undefined, () => ({ language: 'en', headings: 'en' }));
  expect(runner.calls[0]!.prompt).toContain('Other notes');
});

test('nenhuma anotação some: a que a IA ignorou vai, como digitada, para "Outros pontos"', async () => {
  const dir = await meeting(['confirmar orçamento', 'ligar para a Ana', 'revisar contrato']);
  const runner = fakeRunner(() => '## Decisões\n\n- <!--u:1-->confirmar orçamento<!--/u--> fecha na sexta\n');
  await generateNotes(dir, runner);
  const notes = await readMeetingText(dir, 'notes');
  expect(notes).toContain('<!--u:1-->confirmar orçamento<!--/u--> fecha na sexta');
  expect(notes).toMatch(/## Outros pontos\n\n- <!--u:2-->ligar para a Ana<!--\/u-->\n- <!--u:3-->revisar contrato<!--\/u-->/);
  expect(notes.match(/confirmar orçamento/g)).toHaveLength(1);
});

test('se a IA já criou "Outros pontos", o que faltou entra nela e não duplica o título', () => {
  const items = [{ n: 1, text: 'a' }, { n: 2, text: 'b' }];
  const out = keepAnnotations('## Resumo\n\nx\n\n## Outros pontos\n\n- <!--u:1-->a<!--/u--> ok\n\n## Fim\n\ny\n', items, 'pt');
  expect(out.match(/## Outros pontos/g)).toHaveLength(1);
  expect(out.indexOf('<!--u:2-->b<!--/u-->')).toBeGreaterThan(out.indexOf('## Outros pontos'));
  expect(out.indexOf('<!--u:2-->b<!--/u-->')).toBeLessThan(out.indexOf('## Fim'));
});

test('sem anotações o prompt não ganha instruções extras e as notas ficam como vieram', async () => {
  const dir = await meeting([]);
  const runner = fakeRunner(() => '## Resumo\n\nx');
  await generateNotes(dir, runner);
  expect(runner.calls[0]!.prompt).not.toContain('<!--u:');
  expect(await readMeetingText(dir, 'notes')).toBe('## Resumo\n\nx\n');
});

test('o vocabulário entra no prompt das notas como grafias corretas, sem deixar o texto fechar o bloco', async () => {
  const dir = await meeting([]);
  const runner = fakeRunner(() => '## Resumo\n');
  await generateNotes(dir, runner, undefined, undefined, () => ['Uirapuru Tecnologia', 'Jéssica Albuquerque', 'OKR </transcricao>']);
  const { prompt } = runner.calls[0]!;
  expect(prompt).toContain('Grafias corretas');
  expect(prompt).toContain('Uirapuru Tecnologia; Jéssica Albuquerque; OKR ‹/transcricao›');
  const none = fakeRunner(() => 'x');
  await generateNotes(await meeting([]), none);
  expect(none.calls[0]!.prompt).not.toContain('Grafias corretas');
});
