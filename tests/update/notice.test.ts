import { describe, expect, it } from 'vitest';
import { createUpdateChecker, type FetchLike, type UpdateState } from '../../src/main/update/check';
import { bannerVisible, isDismissed, shouldNotify } from '../../src/main/update/notice';
import type { BuildInfo } from '../../src/main/update/build-info';

const SHA = 'e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3';
const SHA2 = 'f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d';
const H = 3_600_000;

describe('quando notificar', () => {
  it('uma vez por sha', () => {
    expect(shouldNotify({ available: true, state: { sha: SHA }, recording: false })).toBe(true);
    expect(shouldNotify({ available: true, state: { sha: SHA, notifiedSha: SHA }, recording: false })).toBe(false);
    expect(shouldNotify({ available: true, state: { sha: SHA2, notifiedSha: SHA }, recording: false })).toBe(true); // versão ainda mais nova: avisa de novo
  });
  it('nunca gravando; adiado até o fim da gravação', () => {
    const o = { available: true, state: { sha: SHA } };
    expect(shouldNotify({ ...o, recording: true })).toBe(false);
    expect(shouldNotify({ ...o, recording: false })).toBe(true); // o fim da gravação tenta de novo e agora passa
  });
  it('sem versão nova ou sem sha: nada', () => {
    expect(shouldNotify({ available: false, state: { sha: SHA }, recording: false })).toBe(false);
    expect(shouldNotify({ available: true, state: {}, recording: false })).toBe(false);
  });
});

describe('"Depois" na faixa', () => {
  const at = '2026-10-15T10:00:00.000Z';
  const t0 = Date.parse(at);
  const st: UpdateState = { sha: SHA, dismissedSha: SHA, dismissedAt: at };
  it('vale por 24 h', () => {
    expect(isDismissed(st, t0 + 23 * H)).toBe(true);
    expect(isDismissed(st, t0 + 24 * H)).toBe(false);
    expect(isDismissed(st, t0 - H)).toBe(false); // relógio voltou atrás
  });
  it('reabre para um sha novo', () => {
    expect(isDismissed({ ...st, sha: SHA2 }, t0 + H)).toBe(false);
    expect(isDismissed({ sha: SHA }, t0)).toBe(false);
  });
  it('o status do checker traz `dismissed` (persistido no updateCheck)', async () => {
    const info: BuildInfo = { commit: 'a1b2c3d', commitDate: '2026-10-01T10:00:00Z', date: '2026-10-01T12:00:00Z', remote: 'github.com/WalissonCF/rice', clonePath: '/x' };
    let state: UpdateState = { sha: SHA, date: '2026-10-10T10:00:00Z', dismissedSha: SHA, dismissedAt: at };
    let now = t0 + H;
    const c = createUpdateChecker({ info: () => info, enabled: async () => true, getState: async () => state, setState: async (s) => void (state = s), fetch: (async () => ({ ok: false, json: async () => ({}) })) as FetchLike, now: () => new Date(now), cloneUsable: () => true });
    expect(await c.status()).toMatchObject({ available: true, dismissed: true });
    now = t0 + 25 * H;
    expect(await c.status()).toMatchObject({ available: true, dismissed: false });
    state = { ...state, sha: SHA2, date: '2026-10-12T10:00:00Z' };
    now = t0 + H;
    expect(await c.status()).toMatchObject({ dismissed: false, to: SHA2.slice(0, 7) });
  });
});

describe('faixa na janela', () => {
  it('escondida enquanto grava, com "Depois" valendo ou sem versão nova', () => {
    expect(bannerVisible({ available: true, dismissed: false, recording: false })).toBe(true);
    expect(bannerVisible({ available: true, dismissed: false, recording: true })).toBe(false);
    expect(bannerVisible({ available: true, dismissed: true, recording: false })).toBe(false);
    expect(bannerVisible({ available: false, dismissed: false, recording: false })).toBe(false);
  });
});
