import { chmod, rename } from 'node:fs/promises';
import { isWindows } from './index';

/**
 * `chmod` das pastas 0700 e arquivos 0600. No Windows as permissões vêm das ACLs do perfil do usuário (a pasta pessoal já é só do
 * dono) e o `chmod` só mexe no atributo "somente leitura": por isso é um no-op lá, em vez de trancar arquivos que o app reescreve.
 */
export async function restrictMode(path: string, mode: number): Promise<void> {
  if (isWindows()) return;
  await chmod(path, mode);
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * `rename` que sobrescreve o destino. No Windows ele falha com EPERM/EBUSY quando outro processo (antivírus, indexador) ou outra
 * escrita do próprio app tem o destino aberto por um instante: tenta de novo com espera curta. No Mac é o `rename` de sempre.
 */
export async function renameRetry(from: string, to: string, attempts = 10): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!isWindows() || !RETRYABLE.has(code) || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 15 * (i + 1)));
    }
  }
}
