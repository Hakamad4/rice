// Parte do `npm run build:app`: copia os preloads e os ícones para out/. Em Node (não em `cp`) para funcionar no cmd.exe do Windows.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

mkdirSync('out', { recursive: true });
for (const f of ['preload.cjs', 'nub-preload.cjs', 'alert-preload.cjs']) copyFileSync(join('src/main/app', f), join('out', f));
// ícones: opcionais (a ausência não quebra o build; o app abre com o ícone padrão)
for (const f of ['icon.png', 'icon.ico', 'trayTemplate.png', 'trayTemplate@2x.png', ...['light', 'dark'].flatMap((t) => ['', '@1.25x', '@1.5x', '@2x'].map((s) => `trayWin-${t}${s}.png`))]) {
  const src = join('assets/icon', f);
  if (existsSync(src)) copyFileSync(src, join('out', basename(f)));
}
