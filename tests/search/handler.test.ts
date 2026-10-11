import { describe, expect, test, vi } from 'vitest';
import { handleSearch, MAX_QUERY_LENGTH } from '../../src/main/search/handler';
import { SearchIndex } from '../../src/main/search/index';

function deps() {
  const index = new SearchIndex();
  const refresh = vi.spyOn(index, 'refresh').mockResolvedValue();
  const query = vi.spyOn(index, 'query').mockReturnValue([]);
  const folders = vi.fn(async () => [{ id: 'f1', name: 'Clientes', createdAt: '', order: 0 }]);
  return { d: { root: async () => '/R', folders, index, now: () => 42 }, refresh, query, folders };
}

describe('search:query', () => {
  test('só aceita texto: qualquer outra coisa dá lista vazia e nem toca o índice', async () => {
    const { d, refresh } = deps();
    for (const bad of [undefined, null, 5, {}, ['a'], { toString: () => 'x' }, '', '   ']) expect(await handleSearch(d, bad)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  test('atualiza o índice na raiz das configurações e consulta com os nomes das pastas', async () => {
    const { d, refresh, query } = deps();
    await handleSearch(d, '  Orçamento ');
    expect(refresh).toHaveBeenCalledWith('/R');
    expect(query).toHaveBeenCalledWith('Orçamento', new Map([['f1', 'Clientes']]), 42);
  });

  test('consulta enorme é cortada', async () => {
    const { d, query } = deps();
    await handleSearch(d, 'a'.repeat(MAX_QUERY_LENGTH * 5));
    expect((query.mock.calls[0]![0] as string).length).toBe(MAX_QUERY_LENGTH);
  });
});

describe('pastas aninhadas na busca', () => {
  test('o nome da pasta enviado ao índice é o caminho "Clientes / Acme"', async () => {
    const { d, query } = deps();
    d.folders = vi.fn(async () => [
      { id: 'f1', name: 'Clientes', createdAt: '', order: 0 },
      { id: 'f2', name: 'Acme', createdAt: '', order: 0, parentId: 'f1' },
    ]);
    await handleSearch(d, 'acme');
    expect(query.mock.calls[0]![1]).toEqual(new Map([['f1', 'Clientes'], ['f2', 'Clientes / Acme']]));
  });
});
