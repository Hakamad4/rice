import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildInfo } from './build-info';

/** Aspas simples do shell: `'` vira `'\''`. Nada de interpolação com `$`, crase ou espaço. */
export const shQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** O script do Terminal: só `cd <clone> && ./update.sh`, montado a partir do build-info (nunca de algo vindo do renderer). */
export function updateScript(clonePath: string): string {
  if (!clonePath.startsWith('/') || /[\0\r\n]/.test(clonePath)) throw new Error('invalid clone path');
  return `#!/bin/bash\ncd ${shQuote(clonePath)} && ./update.sh\n`;
}

/** Grava o `.command` temporário (pasta privada, chmod 700) e o abre no Terminal. `open` é injetável para testar. */
export async function openUpdateInTerminal(info: BuildInfo | null, open: (file: string) => Promise<void> | void, tmp = tmpdir()): Promise<{ ok: boolean; file?: string }> {
  if (!info?.clonePath) return { ok: false };
  const dir = await mkdtemp(join(tmp, 'rice-update-'));
  await chmod(dir, 0o700);
  const file = join(dir, 'Atualizar Rice.command');
  await writeFile(file, updateScript(info.clonePath), { mode: 0o700 });
  await chmod(file, 0o700);
  await open(file);
  return { ok: true, file };
}
