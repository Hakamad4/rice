import { describe, expect, it, vi } from 'vitest';
import { createCheckNow, MIN_GAP_MS, type CheckNowDeps } from '../../src/main/update/check-now';
import { createUpdateChecker, lastCheckOf, type FetchLike, type UpdateState } from '../../src/main/update/check';
import { createWinUpdater, type UpdaterLike } from '../../src/main/update/win-updater';
import type { BuildInfo } from '../../src/main/update/build-info';
import { EventEmitter } from 'node:events';

const SHA_NEW = 'e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3';
const info: BuildInfo = { commit: 'a1b2c3d', commitDate: '2026-10-01T10:00:00Z', date: '2026-10-01T12:00:00Z', remote: 'github.com/WalissonCF/rice', clonePath: '/Users/ana/rice' };

/** Mac: o checker real com um fetch falso, dentro do orquestrador. */
function mac(opts: { newer?: boolean; fail?: boolean; auto?: boolean; local?: boolean } = {}) {
  let state: UpdateState = {};
  let clock = 1_000_000;
  const fetch = vi.fn<FetchLike>(async () => {
    if (opts.fail) throw new Error('offline');
    return { ok: true, json: async () => ({ sha: opts.newer === false ? 'a1b2c3d' + '0'.repeat(33) : SHA_NEW, commit: { committer: { date: '2026-10-10T10:00:00Z' } } }) };
  });
  const checker = createUpdateChecker({
    info: () => info,
    enabled: async () => opts.auto !== false && !opts.local, // a opção automática (padrão ligada)
    getState: async () => state,
    setState: async (s) => void (state = s),
    fetch,
    now: () => new Date('2026-10-13T14:32:00Z'),
    cloneUsable: () => true,
    localMode: () => Boolean(opts.local),
  });
  const run = createCheckNow({ localMode: async () => Boolean(opts.local), commit: () => checker.checkNow(), lastCheckAt: async () => state.lastCheckAt, markChecked: async () => {}, now: () => clock });
  return { run, fetch, state: () => state, advance: (ms: number) => (clock += ms) };
}

describe('Buscar atualização agora (Mac)', () => {
  it('com versão nova: avisa e guarda lastCheckAt no updateCheck', async () => {
    const t = mac();
    const r = await t.run.checkNow();
    expect(r).toMatchObject({ phase: 'available', newVersion: 'e4f5a6b', lastCheckAt: '2026-10-13T14:32:00.000Z', status: { available: true, from: 'a1b2c3d', to: 'e4f5a6b' } });
    expect(t.state()).toMatchObject({ sha: SHA_NEW, lastCheckAt: '2026-10-13T14:32:00.000Z' });
  });

  it('sem novidade: "mais recente"', async () => {
    const r = await mac({ newer: false }).run.checkNow();
    expect(r).toMatchObject({ phase: 'latest', lastCheckAt: '2026-10-13T14:32:00.000Z' });
  });

  it('funciona com a verificação automática desligada (pedido explícito)', async () => {
    const t = mac({ auto: false });
    expect((await t.run.checkNow()).phase).toBe('available');
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('erro de rede: erro claro e lastCheckAt não muda', async () => {
    const t = mac({ fail: true });
    expect(await t.run.checkNow()).toMatchObject({ phase: 'error', error: 'network' });
    expect(t.state().lastCheckAt).toBeUndefined();
  });

  it('Modo 100% local: nada é consultado', async () => {
    const t = mac({ local: true });
    expect((await t.run.checkNow()).phase).toBe('local');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('no mínimo 10 s entre buscas: antes disso devolve o resultado anterior sem consultar; depois, consulta', async () => {
    const t = mac();
    await t.run.checkNow();
    t.advance(MIN_GAP_MS - 1);
    expect((await t.run.checkNow()).phase).toBe('available');
    expect(t.fetch).toHaveBeenCalledTimes(1);
    t.advance(2);
    await t.run.checkNow();
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it('cliques ao mesmo tempo dividem a mesma busca', async () => {
    const t = mac();
    await Promise.all([t.run.checkNow(), t.run.checkNow(), t.run.checkNow()]);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Buscar atualização agora (Windows)', () => {
  function win(opts: { version?: string | null; fail?: string; option?: boolean } = {}) {
    const ev = new EventEmitter();
    const feed = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: (n: string, f: (...a: any[]) => void) => ev.on(n, f),
      checkForUpdates: vi.fn(async () => {
        if (opts.fail) throw new Error(opts.fail);
        if (opts.version === null) ev.emit('update-not-available', {});
        else ev.emit('update-available', { version: opts.version ?? '0.5.1' });
      }),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    } as unknown as UpdaterLike;
    const u = createWinUpdater({ load: () => feed, supported: () => true, enabled: async () => opts.option !== false, allowed: async () => true, isRecording: () => false, onChange: () => {} });
    const marked = vi.fn(async () => {});
    const run = createCheckNow({ localMode: async () => false, win: async () => ((await u.status()).supported ? u.check(true) : null), commit: async () => { throw new Error('não deve rodar'); }, lastCheckAt: async () => '2026-10-13T14:32:00.000Z', markChecked: marked });
    return { run, feed, marked, u };
  }

  it('com versão nova (e com a opção automática desligada)', async () => {
    const t = win({ option: false });
    expect(await t.run.checkNow()).toMatchObject({ phase: 'available', newVersion: '0.5.1' });
    expect(t.marked).toHaveBeenCalledTimes(1);
    expect((await t.u.status()).phase).toBe('available'); // dá para baixar
  });

  it('a consulta automática continua respeitando a opção desligada', async () => {
    const t = win({ option: false });
    await t.u.check(false);
    expect(t.feed.checkForUpdates).not.toHaveBeenCalled();
  });

  it('sem novidade', async () => {
    expect(await win({ version: null }).run.checkNow()).toMatchObject({ phase: 'latest' });
  });

  it('erro de rede vira o erro claro; outro erro leva a mensagem; nada é gravado', async () => {
    const net = win({ fail: 'net::ERR_INTERNET_DISCONNECTED' });
    expect(await net.run.checkNow()).toMatchObject({ phase: 'error', error: 'network' });
    expect(net.marked).not.toHaveBeenCalled();
    expect(await win({ fail: 'Cannot parse latest.yml' }).run.checkNow()).toMatchObject({ phase: 'error', error: 'other', message: 'Cannot parse latest.yml' });
  });
});

describe('hora da última verificação', () => {
  it('lastCheckAt; em estado antigo com sha, a última tentativa; sem consulta nenhuma, nada', () => {
    expect(lastCheckOf({ lastCheckAt: '2026-10-15T09:41:00Z', at: '2026-10-14T08:00:00Z', sha: 'x' })).toBe('2026-10-15T09:41:00Z');
    expect(lastCheckOf({ at: '2026-10-14T08:00:00Z', sha: SHA_NEW })).toBe('2026-10-14T08:00:00Z');
    expect(lastCheckOf({ at: '2026-10-14T08:00:00Z' })).toBeUndefined(); // tentou mas nunca obteve resposta
    expect(lastCheckOf({})).toBeUndefined();
    expect(lastCheckOf(undefined)).toBeUndefined();
  });
});
