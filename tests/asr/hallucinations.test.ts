import { expect, test } from 'vitest';
import { cleanTranscript } from '../../src/main/asr/hallucinations';

test.each([
  ['  Bom dia,   pessoal. ', 'Bom dia, pessoal.'],
  ['A Amara é a nova gerente.', 'A Amara é a nova gerente.'],
  ['Obrigado por assistir o relatório, João.', 'Obrigado por assistir o relatório, João.'],
])('mantém fala real: %s', (input, expected) => {
  expect(cleanTranscript(input)).toBe(expected);
});

test.each([
  '',
  '   ',
  '...',
  ' - ',
  '[Música]',
  '(risos)',
  '[BLANK_AUDIO]',
  'Legendas pela comunidade Amara.org',
  'Legenda por comunidade Amara.org',
  'Obrigado por assistir!',
  'Obrigada por assistir.',
  'Inscreva-se no canal!',
  'Tchau, tchau.',
])('descarta alucinação/vazio: %s', (input) => {
  expect(cleanTranscript(input)).toBeNull();
});
