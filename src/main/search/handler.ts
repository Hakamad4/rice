import type { Folder } from '../../shared/types';
import { folderPaths } from '../store/folders';
import type { SearchIndex, SearchResult } from './index';

export const MAX_QUERY_LENGTH = 200;

export type SearchDeps = {
  root: () => Promise<string>;
  folders: (root: string) => Promise<Folder[]>;
  index: SearchIndex;
  now?: () => number;
};

/** `search:query`: a entrada vem do renderer, então só texto é aceito (cortado em 200 caracteres); qualquer outra coisa dá lista vazia. */
export async function handleSearch(deps: SearchDeps, raw: unknown): Promise<SearchResult[]> {
  if (typeof raw !== 'string') return [];
  const query = raw.slice(0, MAX_QUERY_LENGTH).trim();
  if (!query) return [];
  const root = await deps.root();
  await deps.index.refresh(root);
  const folders = folderPaths(await deps.folders(root)); // "Clientes / Acme"
  return deps.index.query(query, folders, deps.now?.() ?? Date.now());
}
