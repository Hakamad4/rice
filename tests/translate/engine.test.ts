import { describe, expect, it } from 'vitest';
import { createOfflineTranslator } from '../../src/main/translate/engine';
import { OFFLINE_TRANSLATION } from '../../src/main/translate/flags';

describe('chave OFFLINE_TRANSLATION', () => {
  it('nesta release está desligada', () => {
    expect(OFFLINE_TRANSLATION).toBe(false);
  });

  it('desligada, o motor não é criado: só o substituto, nunca instalado', () => {
    const o = createOfflineTranslator(false);
    expect(o.status().packs.every((p) => !p.installed && p.downloadBytes === 0)).toBe(true);
  });
});
