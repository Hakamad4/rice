import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalMode } from '../../src/main/privacy/local-mode';
import { createTranslate } from '../../src/main/translate/ipc';
import { createStubOfflineTranslator, type OfflineTranslator } from '../../src/main/translate/offline';
import { appendTranslation } from '../../src/main/translate/store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rice-tr-ipc-'));
});
afterEach(async () => {
  setLocalMode(false);
  await rm(dir, { recursive: true, force: true });
});

function rig(over: { meeting?: 'pt' | 'en'; last?: 'pt' | 'en' | 'es'; offline?: OfflineTranslator; offlineEnabled?: boolean } = {}) {
  const handlers = new Map<string, (...a: any[]) => any>();
  const sent: Array<[string, unknown]> = [];
  const remembered: string[] = [];
  createTranslate({
    handle: (c, fn) => handlers.set(c, fn),
    send: (c, p) => sent.push([c, p]),
    checkedDir: async (d) => String(d),
    ai: async () => null,
    offline: over.offline ?? createStubOfflineTranslator(),
    offlineEnabled: over.offlineEnabled ?? true,
    startedAt: async () => new Date(),
    meetingLanguage: async () => over.meeting ?? 'pt',
    lastLanguage: async () => over.last,
    rememberLanguage: async (l) => void remembered.push(l),
  });
  const call = (c: string, ...a: unknown[]) => handlers.get(c)!({}, ...a);
  return { call, sent, remembered };
}

describe('IPC da tradução', () => {
  it('idioma padrão: en se a reunião é pt, senão pt; o último escolhido vence', async () => {
    expect((await rig({ meeting: 'pt' }).call('translate:get', dir)).lang).toBe('en');
    expect((await rig({ meeting: 'en' }).call('translate:get', dir)).lang).toBe('pt');
    expect((await rig({ meeting: 'pt', last: 'es' }).call('translate:get', dir)).lang).toBe('es');
  });

  it('o destino nunca é o idioma da reunião, nem pelo último escolhido nem por pedido', async () => {
    expect((await rig({ meeting: 'pt', last: 'pt' }).call('translate:get', dir)).lang).toBe('en');
    expect((await rig({ meeting: 'en', last: 'en' }).call('translate:get', dir)).lang).toBe('pt');
    const r = rig({ meeting: 'pt' });
    const set = await r.call('translate:set', dir, { on: true, lang: 'pt' });
    expect(set.lang).toBe('en');
    expect(r.remembered).toEqual([]);
  });

  it('liga/desliga, lembra o idioma e devolve as traduções salvas', async () => {
    await appendTranslation(dir, { key: 'k', lang: 'en', text: 'hi', via: 'ai' });
    const r = rig();
    const on = await r.call('translate:set', dir, { on: true, lang: 'fr' });
    expect(on).toMatchObject({ on: true, lang: 'fr' });
    expect(r.remembered).toEqual(['fr']);
    expect(on.records).toHaveLength(1);
    expect(await r.call('translate:set', dir, { on: false })).toMatchObject({ on: false });
    expect((await r.call('translate:set', dir, { on: true, lang: 'xx' })).lang).not.toBe('xx'); // lixo é ignorado
  });

  it('Modo 100% local bloqueia o download do modelo (nenhuma chamada ao motor)', async () => {
    const offline = { ...createStubOfflineTranslator(), download: vi.fn(async () => {}) };
    setLocalMode(true);
    const result = await rig({ offline }).call('translate:offline-download', ['en']);
    expect(result.ok).toBe(false);
    expect(offline.download).not.toHaveBeenCalled();
  });

  it('download: progresso vira evento, cancelamento não é erro', async () => {
    const offline: OfflineTranslator = { ...createStubOfflineTranslator(), download: async (_l, cb) => { cb?.({ receivedBytes: 1, totalBytes: 2 }); const e = new Error('x'); e.name = 'AbortError'; throw e; } };
    const r = rig({ offline });
    expect(await r.call('translate:offline-download', ['en', 'xx'])).toMatchObject({ ok: false, cancelled: true });
    expect(r.sent.some(([c]) => c === 'translate:offline')).toBe(true);
  });

  it('chave OFFLINE_TRANSLATION desligada: o estado diz enabled=false e o download é recusado sem chamar o motor', async () => {
    const download = vi.fn(async () => {});
    const offline = { ...createStubOfflineTranslator(), download };
    const off = rig({ offline, offlineEnabled: false });
    expect((await off.call('translate:offline-status')).enabled).toBe(false);
    expect((await off.call('translate:get', dir)).offline.enabled).toBe(false);
    expect(await off.call('translate:offline-download', ['en'])).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
    expect((await rig({ offlineEnabled: true }).call('translate:offline-status')).enabled).toBe(true);
  });
});
