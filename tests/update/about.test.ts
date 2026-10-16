import { describe, expect, it } from 'vitest';
import { appAbout, bundlePath } from '../../src/main/update/about';

describe('appAbout', () => {
  it('o caminho do pacote vem do executável, em qualquer pasta (inclusive com espaços)', () => {
    expect(bundlePath('/Applications/Rice.app/Contents/MacOS/Rice')).toBe('/Applications/Rice.app');
    expect(bundlePath('/Users/x/Downloads/Rice.app/Contents/MacOS/Rice')).toBe('/Users/x/Downloads/Rice.app');
    expect(bundlePath('/Users/x/My Apps/Rice.app/Contents/MacOS/Rice')).toBe('/Users/x/My Apps/Rice.app');
    expect(bundlePath('/opt/rice/electron')).toBe('/opt/rice/electron'); // sem .app: o próprio caminho
  });

  it('versão, commit curto e caminho; commit ausente ou inválido vira null', () => {
    expect(appAbout({ version: '0.4.0', commit: 'abc1234def', exePath: '/Applications/Rice.app/Contents/MacOS/Rice' })).toEqual({ version: '0.4.0', commit: 'abc1234', commitFull: 'abc1234def', appPath: '/Applications/Rice.app' });
    expect(appAbout({ version: '0.4.0', commit: null, exePath: '/x/Rice.app/Contents/MacOS/Rice' }).commit).toBeNull();
    expect(appAbout({ version: '0.4.0', commit: 'não é sha', exePath: '/x/Rice.app/Contents/MacOS/Rice' }).commit).toBeNull();
  });
});
