import { chmod } from 'node:fs/promises';
import { isWindows } from './index';

/**
 * `chmod` das pastas 0700 e arquivos 0600. No Windows as permissões vêm das ACLs do perfil do usuário (a pasta pessoal já é só do
 * dono) e o `chmod` só mexe no atributo "somente leitura": por isso é um no-op lá, em vez de trancar arquivos que o app reescreve.
 */
export async function restrictMode(path: string, mode: number): Promise<void> {
  if (isWindows()) return;
  await chmod(path, mode);
}
