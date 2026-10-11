import { expect, test } from 'vitest';
import { parseStartInput } from '../../src/main/app/start-input';

const root = '/Users/x/Rice';

test('sem dir: só título e trigger', () => {
  expect(parseStartInput({ title: 'Daily' }, root)).toEqual({ title: 'Daily', trigger: 'manual' });
  expect(parseStartInput(undefined, root)).toEqual({ title: 'Reunião', trigger: 'manual' });
});

test('dir dentro da raiz é repassado resolvido', () => {
  expect(parseStartInput({ title: 'Gi e Eu', dir: `${root}/2026-10-09 0921 - Gi e Eu` }, root)).toEqual({
    title: 'Gi e Eu',
    trigger: 'manual',
    dir: `${root}/2026-10-09 0921 - Gi e Eu`,
  });
});

test('dir fora da raiz (ou com ..) é erro', () => {
  expect(() => parseStartInput({ dir: '/etc' }, root)).toThrow(/fora da pasta/);
  expect(() => parseStartInput({ dir: `${root}/../outro` }, root)).toThrow(/fora da pasta/);
  expect(() => parseStartInput({ dir: '/Users/x/Rice2/a' }, root)).toThrow(/fora da pasta/);
});

test('título vazio, em branco ou não-string cai em "Reunião"', () => {
  expect(parseStartInput({ title: '' }, root).title).toBe('Reunião');
  expect(parseStartInput({ title: '   ' }, root).title).toBe('Reunião');
  expect(parseStartInput({ title: undefined }, root).title).toBe('Reunião');
});
