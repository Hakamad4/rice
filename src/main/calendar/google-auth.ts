import { t } from '../i18n';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { TokenCrypto } from '../ai/secrets';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FILE = 'google-oauth.bin';
const LOGIN_TIMEOUT_MS = 5 * 60_000;

type Stored = { clientId: string; clientSecret: string; refreshToken?: string };
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export type GoogleAuthDeps = {
  dir: string;
  crypto: TokenCrypto;
  fetch: FetchLike;
  openExternal: (url: string) => Promise<void> | void;
  now?: () => number;
  loginTimeoutMs?: number;
};

const b64url = (buf: Buffer) => buf.toString('base64url');

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

const page = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Rice</title><body style="font:16px -apple-system,sans-serif;text-align:center;margin-top:20vh"><h2>${msg}</h2>`;

/** OAuth local (PKCE) para o Google Agenda. Nunca registra tokens nem o secret. Emite 'disconnected' em invalid_grant. */
export class GoogleAuth extends EventEmitter {
  private access: { token: string; expiresAt: number } | null = null;

  constructor(private readonly deps: GoogleAuthDeps) {
    super();
  }

  private now = () => (this.deps.now ?? Date.now)();

  private async load(): Promise<Stored | null> {
    try {
      return JSON.parse(this.deps.crypto.decrypt(await readFile(join(this.deps.dir, FILE)))) as Stored;
    } catch {
      return null;
    }
  }

  private async store(data: Stored): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true });
    await writeFile(join(this.deps.dir, FILE), this.deps.crypto.encrypt(JSON.stringify(data)), { mode: 0o600 });
  }

  async status(): Promise<{ hasClient: boolean; connected: boolean }> {
    const s = await this.load();
    return { hasClient: Boolean(s?.clientId && s.clientSecret), connected: Boolean(s?.refreshToken) };
  }

  async saveClient(clientId: string, clientSecret: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const id = String(clientId ?? '').trim();
    const secret = String(clientSecret ?? '').trim();
    if (!id.endsWith('.apps.googleusercontent.com')) return { ok: false, message: t('google.err.client-id') };
    if (!secret) return { ok: false, message: t('google.err.secret') };
    const old = await this.load();
    this.access = null;
    await this.store({ clientId: id, clientSecret: secret, ...(old?.clientId === id && old.refreshToken ? { refreshToken: old.refreshToken } : {}) });
    return { ok: true };
  }

  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    const creds = await this.load();
    if (!creds?.clientId || !creds.clientSecret) return { ok: false, message: t('google.err.save-first') };
    const { verifier, challenge } = makePkce();
    const state = b64url(randomBytes(24));
    let server: Server | undefined;
    try {
      const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(t('google.err.timeout'))), this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS);
        const srv = createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/') {
            res.writeHead(404).end();
            return;
          }
          const error = url.searchParams.get('error');
          const got = url.searchParams.get('code');
          const okState = url.searchParams.get('state') === state;
          res.writeHead(okState && got && !error ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
          if (!okState) {
            res.end(page(t('google.page.invalid')));
            return; // estado errado: ignora e continua esperando o redirect legítimo
          }
          clearTimeout(timer);
          if (error || !got) {
            res.end(page(t('google.page.denied')));
            reject(new Error(error === 'access_denied' ? t('google.err.denied') : t('google.err.refused', { code: error ?? t('google.err.no-code') })));
            return;
          }
          res.end(page(t('google.page.done')));
          resolve({ code: got, redirect: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` });
        });
        server = srv;
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', async () => {
          const redirect = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
          const q = new URLSearchParams({
            client_id: creds.clientId,
            redirect_uri: redirect,
            response_type: 'code',
            scope: GOOGLE_SCOPE,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
            access_type: 'offline',
            prompt: 'consent',
          });
          try {
            await this.deps.openExternal(`${AUTH_URL}?${q}`);
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });
      });
      const res = await this.deps.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code.code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: code.redirect,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.refresh_token) return { ok: false, message: t('google.err.incomplete', { code: String(body.error ?? res.status) }) };
      await this.store({ ...creds, refreshToken: String(body.refresh_token) });
      this.access = body.access_token ? { token: String(body.access_token), expiresAt: this.now() + Number(body.expires_in ?? 3600) * 1000 } : null;
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    } finally {
      server?.close();
      server?.closeAllConnections?.();
    }
  }

  /** Access token válido (renova com 60 s de folga). Lança se desconectado; em invalid_grant apaga o refresh token. */
  async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - 60_000 > this.now()) return this.access.token;
    const creds = await this.load();
    if (!creds?.refreshToken) throw new Error(t('google.err.disconnected'));
    const res = await this.deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.error === 'invalid_grant') {
        this.access = null;
        await this.store({ clientId: creds.clientId, clientSecret: creds.clientSecret });
        this.emit('disconnected');
        throw new Error(t('google.err.expired'));
      }
      throw new Error(t('google.err.refresh', { detail: String(body.error ?? res.status) }));
    }
    this.access = { token: String(body.access_token), expiresAt: this.now() + Number(body.expires_in ?? 3600) * 1000 };
    return this.access.token;
  }

  async disconnect(): Promise<void> {
    const creds = await this.load();
    this.access = null;
    if (creds?.refreshToken) {
      await this.deps
        .fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: creds.refreshToken }).toString() })
        .catch(() => {});
    }
    await rm(join(this.deps.dir, FILE), { force: true });
  }
}
