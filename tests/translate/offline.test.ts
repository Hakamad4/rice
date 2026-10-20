import { describe, expect, it } from 'vitest';
import { createStubOfflineTranslator, downloadSize, isTranslateLang, missingPacks, offlineReady, type OfflineStatus } from '../../src/main/translate/offline';

describe('OfflineTranslator (stub)', () => {
  it('nunca instalado e nunca traduz', async () => {
    const stub = createStubOfflineTranslator();
    expect(stub.status().state).toBe('not-installed');
    await expect(stub.translate('oi', { from: 'pt', to: 'en' })).rejects.toThrow('offline-translator-unavailable');
    await expect(stub.download(['en'])).rejects.toThrow();
    await expect(stub.unload()).resolves.toBeUndefined();
    await expect(stub.delete(['en'])).resolves.toBeUndefined();
  });
  it('valida idiomas', () => {
    expect(isTranslateLang('pt')).toBe(true);
    expect(isTranslateLang('xx')).toBe(false);
  });
  it('pacotes: pronto só com origem e destino instalados; o inglês é pivô sem pacote', () => {
    const packs = (installed: string[]): OfflineStatus['packs'] => (['pt', 'en', 'es', 'fr', 'de', 'it'] as const).map((lang) => ({ lang, downloadBytes: 100, diskBytes: 150, installed: installed.includes(lang) }));
    expect(offlineReady({ packs: packs(['pt']) }, 'pt', 'en')).toBe(true); // de/para o inglês: só o outro idioma
    expect(offlineReady({ packs: packs(['fr']) }, 'en', 'fr')).toBe(true);
    expect(missingPacks({ packs: packs([]) }, 'pt', 'en')).toEqual(['pt']);
    expect(offlineReady({ packs: packs(['pt']) }, 'pt', 'es')).toBe(false); // falta o es
    expect(missingPacks({ packs: packs(['pt']) }, 'pt', 'es')).toEqual(['es']);
    expect(missingPacks({ packs: packs([]) }, 'pt', 'fr')).toEqual(['pt', 'fr']);
    expect(offlineReady({ packs: packs(['pt', 'es']) }, 'pt', 'es')).toBe(true);
    expect(offlineReady({ packs: packs(['pt', 'es']) }, 'pt', 'pt')).toBe(false);
    expect(downloadSize({ packs: packs(['es']) }, ['pt', 'es', 'fr'])).toBe(200); // o instalado não conta
  });
});
