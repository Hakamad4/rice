import { expect, test } from 'vitest';
import { applySpeakerNames, cleanSpeakerName, personIds } from '../../src/shared/speakers';

const T = '# T\n\n**[14:00:01] Eu:** oi\n\n**[14:00:05] Pessoa 2:** Obrigado, Ana.\n\n**[14:00:09] Pessoa 1:** fala Pessoa 2: texto\n\n**[14:00:12] Outros:** x\n';

test('os nomes entram só no rótulo de quem falou, não no meio do texto', () => {
  const out = applySpeakerNames(T, { '2': 'Ana' });
  expect(out).toContain('**[14:00:05] Ana:** Obrigado, Ana.');
  expect(out).toContain('**[14:00:09] Pessoa 1:** fala Pessoa 2: texto'); // sem nome: continua Pessoa 1; o texto não muda
  expect(out).toContain('**[14:00:01] Eu:**');
  expect(applySpeakerNames(T, undefined)).toBe(T);
  expect(applySpeakerNames(T, {})).toBe(T);
});

test('pessoas que aparecem na transcrição', () => {
  expect(personIds(T)).toEqual([1, 2]);
  expect(personIds('**[14:00:01] Eu:** oi')).toEqual([]);
});

test('nome limpo: uma linha, sem marcação do Markdown, no máximo 40 caracteres', () => {
  expect(cleanSpeakerName('  Ana **Paula**\n<b>x</b> ')).toBe('Ana Paula b x /b');
  expect(cleanSpeakerName('x'.repeat(100))).toHaveLength(40);
  expect(cleanSpeakerName(undefined)).toBe('');
});
