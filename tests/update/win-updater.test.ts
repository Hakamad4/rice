import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWinUpdater, nsisInstall, type UpdaterLike, type WinUpdateState } from '../../src/main/update/win-updater';
import { makeTmpDir } from '../helpers/tmp';

/** Feed falso: se comporta como o autoUpdater do electron-updater (eventos, sem rede). */
function fakeFeed(opts: { version?: string | null; failCheck?: boolean; failDownload?: boolean } = {}) {
  const ev = new EventEmitter();
  const calls: string[] = [];
  const feed = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: (name: string, fn: (...a: any[]) => void) => ev.on(name, fn),
    checkForUpdates: vi.fn(async () => {
      calls.push('check');
      if (opts.failCheck) throw new Error('net::ERR_INTERNET_DISCONNECTED');
      if (opts.version === null) ev.emit('update-not-available', {});
      else ev.emit('update-available', { version: opts.version ?? '0.5.0' });
    }),
    downloadUpdate: vi.fn(async () => {
      calls.push('download');
      if (opts.failDownload) throw new Error('sha512 checksum mismatch');
      ev.emit('download-progress', { percent: 12.4 });
      ev.emit('download-progress', { percent: 100 });
      ev.emit('update-downloaded', { version: opts.version ?? '0.5.0' });
    }),
    quitAndInstall: vi.fn(() => calls.push('install')),
  } as unknown as UpdaterLike;
  return { feed, calls };
}

function setup(over: { feed?: ReturnType<typeof fakeFeed>; supported?: boolean; enabled?: boolean; recording?: boolean } = {}) {
  const f = over.feed ?? fakeFeed();
  const states: WinUpdateState[] = [];
  const flags = { supported: over.supported ?? true, enabled: over.enabled ?? true, recording: over.recording ?? false };
  const load = vi.fn(() => f.feed);
  const u = createWinUpdater({ load, supported: () => flags.supported, enabled: async () => flags.enabled, isRecording: () => flags.recording, onChange: (s) => states.push(s) });
  return { u, f, flags, states, load };
}

describe('atualização automática no Windows', () => {
  it('procura, baixa só quando o usuário pede (com progresso) e instala ao reiniciar', async () => {
    const t = setup();
    expect((await t.u.status()).supported).toBe(true);
    const found = await t.u.check(true);
    expect(found).toMatchObject({ phase: 'available', version: '0.5.0' });
    expect(t.f.feed.autoDownload).toBe(false); // nunca baixa sozinho
    expect(t.f.feed.autoInstallOnAppQuit).toBe(false); // nem instala ao fechar
    expect(t.f.calls).toEqual(['check']);
    const done = await t.u.download();
    expect(done.phase).toBe('downloaded');
    expect(t.states.filter((s) => s.phase === 'downloading').map((s) => s.percent)).toEqual([0, 12, 100]);
    expect(await t.u.install()).toEqual({ ok: true });
    expect(t.f.feed.quitAndInstall).toHaveBeenCalledWith(false, true); // o instalador roda e reabre o Rice
  });

  it('sem versão nova: volta a ocioso, sem erro', async () => {
    const t = setup({ feed: fakeFeed({ version: null }) });
    expect(await t.u.check(true)).toMatchObject({ phase: 'idle', supported: true });
    expect((await t.u.status()).error).toBeUndefined();
  });

  it('opção "Procurar atualizações" desligada ou Modo 100% local: nada é consultado nem baixado', async () => {
    const off = setup({ enabled: false });
    expect(await off.u.check(true)).toMatchObject({ supported: false, phase: 'idle' });
    expect(await off.u.download()).toMatchObject({ supported: false });
    expect(off.load).not.toHaveBeenCalled();
    expect(off.f.calls).toEqual([]);
  });

  it('desligar a opção no meio do caminho zera o estado', async () => {
    const t = setup();
    await t.u.check(true);
    t.flags.enabled = false;
    expect(await t.u.status()).toMatchObject({ supported: false, phase: 'idle' });
    expect((await t.u.download()).phase).toBe('idle');
    expect(t.f.calls).toEqual(['check']);
  });

  it('app que não é o instalado pelo NSIS (Mac, dev, portátil): sem suporte, a biblioteca nem é carregada', async () => {
    const t = setup({ supported: false });
    expect(await t.u.check(true)).toMatchObject({ supported: false });
    expect(t.load).not.toHaveBeenCalled();
  });

  it('NUNCA instala no meio de uma gravação: espera acabar e então instala', async () => {
    const t = setup({ recording: true });
    await t.u.check(true);
    await t.u.download();
    expect(await t.u.install()).toEqual({ ok: true, waiting: true });
    expect(t.f.feed.quitAndInstall).not.toHaveBeenCalled();
    expect(await t.u.status()).toMatchObject({ phase: 'downloaded', waitingForRecording: true });
    t.u.recordingEnded(); // ainda gravando: nada
    expect(t.f.feed.quitAndInstall).not.toHaveBeenCalled();
    t.flags.recording = false;
    t.u.recordingEnded();
    await vi.waitFor(() => expect(t.f.feed.quitAndInstall).toHaveBeenCalledTimes(1));
  });

  it('gravação que termina sem pedido de instalação não instala nada', async () => {
    const t = setup();
    await t.u.check(true);
    await t.u.download();
    t.u.recordingEnded();
    expect(t.f.feed.quitAndInstall).not.toHaveBeenCalled();
  });

  it('falha na consulta automática é silenciosa; na do usuário mostra o erro', async () => {
    const t = setup({ feed: fakeFeed({ failCheck: true }) });
    const auto = await t.u.check(false);
    expect(auto.error).toBeUndefined();
    expect(auto.phase).toBe('idle');
    const manual = await t.u.check(true);
    expect(manual.error).toContain('ERR_INTERNET_DISCONNECTED');
  });

  it('download que falha (checksum): volta a "disponível" com o erro, sem instalar', async () => {
    const t = setup({ feed: fakeFeed({ failDownload: true }) });
    await t.u.check(true);
    const r = await t.u.download();
    expect(r).toMatchObject({ phase: 'available' });
    expect(r.error).toContain('checksum');
    expect(await t.u.install()).toEqual({ ok: false });
  });

  it('instalar sem ter baixado não faz nada', async () => {
    const t = setup();
    expect(await t.u.install()).toEqual({ ok: false });
    await t.u.check(true);
    expect(await t.u.install()).toEqual({ ok: false });
    expect(t.f.feed.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe('nsisInstall', () => {
  it('só no Windows, empacotado e com o app-update.yml do instalador NSIS', async () => {
    const dir = await makeTmpDir();
    expect(nsisInstall({ platform: 'win32', packaged: true, resourcesPath: dir })).toBe(false);
    writeFileSync(join(dir, 'app-update.yml'), 'provider: github\n');
    expect(nsisInstall({ platform: 'win32', packaged: true, resourcesPath: dir })).toBe(true);
    expect(nsisInstall({ platform: 'darwin', packaged: true, resourcesPath: dir })).toBe(false); // Mac: nada muda
    expect(nsisInstall({ platform: 'win32', packaged: false, resourcesPath: dir })).toBe(false);
    mkdirSync(join(dir, 'x'));
  });
});
