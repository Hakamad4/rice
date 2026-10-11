import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { GoogleAuth, makePkce, type FetchLike } from '../../src/main/calendar/google-auth';
import { makeTmpDir } from '../helpers/tmp';

const realFetch = globalThis.fetch;
const crypto = { encrypt: (s: string) => Buffer.from(`enc:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^enc:/, '') };
const ID = 'abc.apps.googleusercontent.com';
const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

async function setup(opts: { fetch?: FetchLike; callback?: (auth: URL) => Promise<void> | void } = {}) {
  const dir = await makeTmpDir();
  const opened: URL[] = [];
  const fetchFake = opts.fetch ?? vi.fn(async () => json({ refresh_token: 'RT', access_token: 'AT', expires_in: 3600 }));
  const auth = new GoogleAuth({
    dir, crypto, fetch: fetchFake as FetchLike,
    openExternal: async (u) => {
      const url = new URL(u);
      opened.push(url);
      setTimeout(() => void opts.callback?.(url), 0);
    },
  });
  await auth.saveClient(ID, 'SECRET');
  return { auth, dir, opened, fetchFake: fetchFake as ReturnType<typeof vi.fn> };
}
const redirect = (url: URL, params: Record<string, string>) =>
  realFetch(`${url.searchParams.get('redirect_uri')}/?${new URLSearchParams(params)}`);

test('PKCE: challenge é o S256 do verifier', () => {
  const { verifier, challenge } = makePkce();
  expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  expect(verifier.length).toBeGreaterThanOrEqual(43);
});

test('saveClient valida o Client ID e guarda criptografado', async () => {
  const { auth, dir } = await setup();
  expect(await auth.saveClient('x', 's')).toMatchObject({ ok: false });
  expect(await auth.saveClient(ID, '')).toMatchObject({ ok: false });
  expect(await auth.status()).toEqual({ hasClient: true, connected: false });
  const raw = (await readFile(join(dir, 'google-oauth.bin'))).toString();
  expect(raw.startsWith('enc:')).toBe(true);
});

test('connect: URL com PKCE/state/escopo, troca o code e guarda o refresh token', async () => {
  let state = '';
  const { auth, opened, fetchFake } = await setup({
    callback: async (u) => {
      state = u.searchParams.get('state')!;
      const r = await redirect(u, { code: 'CODE', state });
      expect(await r.text()).toContain('Pronto, pode voltar ao Rice');
    },
  });
  expect(await auth.connect()).toEqual({ ok: true });
  const u = opened[0]!;
  expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
  expect(u.searchParams.get('access_type')).toBe('offline');
  expect(u.searchParams.get('prompt')).toBe('consent');
  expect(u.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const [url, init] = fetchFake.mock.calls[0]!;
  expect(url).toBe('https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(init.body);
  expect(body.get('code')).toBe('CODE');
  expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(u.searchParams.get('code_challenge'));
  expect(await auth.status()).toEqual({ hasClient: true, connected: true });
});

test('connect: state inválido é rejeitado (400) e o login legítimo ainda conclui', async () => {
  const { auth } = await setup({
    callback: async (u) => {
      const bad = await redirect(u, { code: 'EVIL', state: 'errado' });
      expect(bad.status).toBe(400);
      await redirect(u, { code: 'CODE', state: u.searchParams.get('state')! });
    },
  });
  expect(await auth.connect()).toEqual({ ok: true });
});

test('connect: acesso negado e timeout viram erro', async () => {
  const denied = await setup({ callback: (u) => void redirect(u, { error: 'access_denied', state: u.searchParams.get('state')! }) });
  expect(await denied.auth.connect()).toEqual({ ok: false, message: 'Você não autorizou o acesso.' });

  const dir = await makeTmpDir();
  const auth = new GoogleAuth({ dir, crypto, fetch: vi.fn() as never, openExternal: () => {}, loginTimeoutMs: 30 });
  await auth.saveClient(ID, 'S');
  expect(await auth.connect()).toMatchObject({ ok: false, message: expect.stringContaining('Tempo esgotado') });
});

test('connect sem client salvo pede para salvar', async () => {
  const auth = new GoogleAuth({ dir: await makeTmpDir(), crypto, fetch: vi.fn() as never, openExternal: () => {} });
  expect(await auth.connect()).toMatchObject({ ok: false });
});

test('accessToken: renova com refresh token e reutiliza até perto de expirar', async () => {
  let t = 1_000_000;
  const fetchFake = vi.fn(async (_u: string, init?: any) => {
    const b = new URLSearchParams(init.body);
    if (b.get('grant_type') === 'authorization_code') return json({ refresh_token: 'RT', expires_in: 3600 }); // sem access token
    return json({ access_token: `AT${fetchFake.mock.calls.length}`, expires_in: 3600 });
  });
  const dir = await makeTmpDir();
  const auth = new GoogleAuth({
    dir, crypto, fetch: fetchFake as never, now: () => t,
    openExternal: (u) => void setTimeout(() => void redirect(new URL(u), { code: 'C', state: new URL(u).searchParams.get('state')! }), 0),
  });
  await auth.saveClient(ID, 'S');
  await auth.connect();
  const first = await auth.accessToken();
  expect(await auth.accessToken()).toBe(first);
  expect(fetchFake).toHaveBeenCalledTimes(2);
  const body = new URLSearchParams(fetchFake.mock.calls[1]![1].body);
  expect(body.get('grant_type')).toBe('refresh_token');
  expect(body.get('refresh_token')).toBe('RT');
  t += 3_600_000;
  expect(await auth.accessToken()).not.toBe(first);
});

test('invalid_grant marca desconectado, emite aviso e apaga o refresh token', async () => {
  const dir = await makeTmpDir();
  let phase = 0;
  const fetchFake = vi.fn(async () => (phase++ === 0 ? json({ refresh_token: 'RT' }) : json({ error: 'invalid_grant' }, false, 400)));
  const auth = new GoogleAuth({
    dir, crypto, fetch: fetchFake as never,
    openExternal: (u) => void setTimeout(() => void redirect(new URL(u), { code: 'C', state: new URL(u).searchParams.get('state')! }), 0),
  });
  await auth.saveClient(ID, 'S');
  await auth.connect();
  const onDisc = vi.fn();
  auth.on('disconnected', onDisc);
  await expect(auth.accessToken()).rejects.toThrow('Conecte de novo');
  expect(onDisc).toHaveBeenCalledOnce();
  expect(await auth.status()).toEqual({ hasClient: true, connected: false });
});

test('disconnect revoga e apaga o arquivo', async () => {
  const dir = await makeTmpDir();
  const fetchFake = vi.fn(async (_url: string, _init?: unknown) => json({ refresh_token: 'RT' }));
  const auth = new GoogleAuth({
    dir, crypto, fetch: fetchFake as never,
    openExternal: (u) => void setTimeout(() => void redirect(new URL(u), { code: 'C', state: new URL(u).searchParams.get('state')! }), 0),
  });
  await auth.saveClient(ID, 'S');
  await auth.connect();
  await auth.disconnect();
  expect(fetchFake.mock.calls.at(-1)![0]).toBe('https://oauth2.googleapis.com/revoke');
  expect(await auth.status()).toEqual({ hasClient: false, connected: false });
});
