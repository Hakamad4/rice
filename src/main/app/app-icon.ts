import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ícone do app: `out/icon.png` (copiado pelo `build:app`) ou, no repositório, `assets/icon/icon.png`.
 * `null` se nenhum existir (o app abre com o ícone padrão).
 */
export function findAppIcon(dir: string, exists: (path: string) => boolean = existsSync): string | null {
  return [join(dir, 'icon.png'), join(dir, '..', 'assets', 'icon', 'icon.png')].find(exists) ?? null;
}

/** Imagens "template" da barra de menus (preto + alfa, 16 e 32 px): ao lado do ícone do app em `out/` ou em `assets/icon/`. */
export function findTrayIcons(dir: string, exists: (path: string) => boolean = existsSync): { x1: string; x2: string } | null {
  for (const base of [dir, join(dir, '..', 'assets', 'icon')]) {
    const x1 = join(base, 'trayTemplate.png');
    const x2 = join(base, 'trayTemplate@2x.png');
    if (exists(x1) && exists(x2)) return { x1, x2 };
  }
  return null;
}

/** Windows: `icon.ico` (vários tamanhos) ao lado do `icon.png` em `out/` ou em `assets/icon/`; serve ao instalador e à bandeja. */
export function findWinIcon(dir: string, exists: (path: string) => boolean = existsSync): string | null {
  return [join(dir, 'icon.ico'), join(dir, '..', 'assets', 'icon', 'icon.ico')].find(exists) ?? null;
}

/**
 * Windows: ícone monocromático da bandeja que acompanha a barra de tarefas (preto na clara, branco na escura), com as variantes
 * @1.25x, @1.5x e @2x ao lado (o Electron escolhe pela escala da tela). `null` se não houver: o main usa o `icon.ico` colorido.
 */
export function findWinTrayIcon(dir: string, dark: boolean, exists: (path: string) => boolean = existsSync): string | null {
  const name = `trayWin-${dark ? 'dark' : 'light'}.png`;
  return [join(dir, name), join(dir, '..', 'assets', 'icon', name)].find(exists) ?? null;
}
