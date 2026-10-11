import { expect, test } from 'vitest';
import { wer } from '../helpers/wer';

test('idênticos ignorando caixa, acento e pontuação = 0', () => {
  expect(wer('Decisão: orçamento.', 'decisao orcamento')).toBe(0);
});
test('uma troca em quatro palavras = 0.25', () => {
  expect(wer('a b c d', 'a x c d')).toBe(0.25);
});
