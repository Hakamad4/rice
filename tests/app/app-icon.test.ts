import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findAppIcon } from '../../src/main/app/app-icon';

const p = (path: string): string => join(path); // separador do sistema

it('prefere out/icon.png, cai em assets/icon/icon.png e devolve null sem nenhum', () => {
  expect(findAppIcon('/app/out', () => true)).toBe(p('/app/out/icon.png'));
  expect(findAppIcon('/app/out', (p) => p.includes('assets'))).toBe(p('/app/assets/icon/icon.png'));
  expect(findAppIcon('/app/out', () => false)).toBeNull();
});

import { findTrayIcons } from '../../src/main/app/app-icon';

it('ícones da barra de menus: par 16/32 px em out/ ou em assets/icon/, ou null se faltar um deles', () => {
  expect(findTrayIcons('/app/out', () => true)).toEqual({ x1: p('/app/out/trayTemplate.png'), x2: p('/app/out/trayTemplate@2x.png') });
  expect(findTrayIcons('/app/out', (p) => p.includes('assets'))).toEqual({ x1: p('/app/assets/icon/trayTemplate.png'), x2: p('/app/assets/icon/trayTemplate@2x.png') });
  expect(findTrayIcons('/app/out', (p) => !p.includes('@2x'))).toBeNull();
});

it('os arquivos do logo existem: ícone 1024 com alfa, .icns, fonte svg e imagens template', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  for (const f of ['icon.png', 'Rice.icns', 'rice-icon.svg', 'tray-template.svg', 'trayTemplate.png', 'trayTemplate@2x.png']) expect(existsSync(`assets/icon/${f}`), f).toBe(true);
  const png = readFileSync('assets/icon/icon.png');
  expect(png.readUInt32BE(16)).toBe(1024); // largura
  expect(png.readUInt8(25)).toBe(6); // RGBA: margem transparente do squircle
  expect(readFileSync('assets/icon/rice-icon.svg', 'utf8')).toContain('#F4F1EA');
});


import { existsSync, readFileSync } from 'node:fs';
import { findWinTrayIcon } from '../../src/main/app/app-icon';

it('Windows: o ícone da bandeja acompanha a barra de tarefas (preto na clara, branco na escura), ou null sem ele', () => {
  expect(findWinTrayIcon('/app/out', false, () => true)).toBe(p('/app/out/trayWin-light.png'));
  expect(findWinTrayIcon('/app/out', true, () => true)).toBe(p('/app/out/trayWin-dark.png'));
  expect(findWinTrayIcon('/app/out', true, (x) => x.includes('assets'))).toBe(p('/app/assets/icon/trayWin-dark.png'));
  expect(findWinTrayIcon('/app/out', false, () => false)).toBeNull();
});

it('os ícones da bandeja do Windows existem em 16, 20, 24 e 32 px (100%, 125%, 150% e 200% de escala) e o .ico tem todos os tamanhos', () => {
  const dims = (file: string) => {
    const b = readFileSync(file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  for (const theme of ['light', 'dark']) {
    for (const [suffix, size] of [['', 16], ['@1.25x', 20], ['@1.5x', 24], ['@2x', 32]] as const) {
      const file = `assets/icon/trayWin-${theme}${suffix}.png`;
      expect(existsSync(file), file).toBe(true);
      expect(dims(file)).toEqual([size, size]);
    }
  }
  const ico = readFileSync('assets/icon/icon.ico');
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
  expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]); // a barra de título, o Alt+Tab, a barra de tarefas e o instalador pegam cada um o seu
});
