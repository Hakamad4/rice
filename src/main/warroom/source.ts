import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { FactSource } from './store';

export type ResolvedSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };

/**
 * Para onde a fonte de um achado aponta. URL: só https. Arquivo (`caminho` ou `caminho:linha`): só se existir DENTRO da pasta de trabalho
 * (caminho real, sem escapar por `..` nem links simbólicos). Tudo o mais (ferramenta, áudio, texto qualquer) não é clicável.
 */
export async function resolveSource(source: FactSource, folder: string | null): Promise<ResolvedSource | null> {
  const ref = source.ref.trim();
  if (source.type === 'url') {
    try {
      const url = new URL(ref);
      return url.protocol === 'https:' ? { kind: 'url', url: url.toString() } : null;
    } catch {
      return null;
    }
  }
  if (source.type !== 'file' || !folder || !ref) return null;
  const withoutLine = ref.replace(/:\d+(?::\d+)?$/, '');
  const candidate = isAbsolute(withoutLine) ? withoutLine : join(folder, withoutLine);
  try {
    const realFolder = await realpath(folder);
    const real = await realpath(resolve(candidate));
    const inside = real === realFolder || real.startsWith(realFolder.endsWith(sep) ? realFolder : realFolder + sep);
    if (!inside) return null;
    await stat(real);
    return { kind: 'file', path: real };
  } catch {
    return null;
  }
}
