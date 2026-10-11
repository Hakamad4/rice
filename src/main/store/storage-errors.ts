/**
 * Falhas de escrita em disco: o que adianta repetir e o que não. `full` (sem espaço/quota) não melhora com tentativas
 * imediatas; `unavailable` (pasta apagada, volume desmontado, sem permissão) pode voltar sozinha ou pedir outro destino.
 */
export type StorageFailure = 'full' | 'unavailable' | 'other';

const FULL = new Set(['ENOSPC', 'EDQUOT', 'EFBIG']);
const UNAVAILABLE = new Set(['ENOENT', 'ENOTDIR', 'EIO', 'ENXIO', 'ENODEV', 'EROFS', 'EACCES', 'EPERM', 'ESTALE', 'EBUSY', 'ENOTCONN', 'EHOSTDOWN', 'ETIMEDOUT', 'EBADF', 'ENAMETOOLONG']);

export function classifyStorageError(err: unknown): StorageFailure {
  const code = typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
  if (code && FULL.has(code)) return 'full';
  if (code && UNAVAILABLE.has(code)) return 'unavailable';
  return 'other';
}
