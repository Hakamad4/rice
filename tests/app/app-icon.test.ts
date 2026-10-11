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

