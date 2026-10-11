import { t } from '../i18n';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasKeyField, type AiProvider, type KeyProvider } from './types';

/** Cripto injetável: em produção é o `safeStorage` do Electron. */
export type TokenCrypto = {
  encrypt: (plain: string) => Buffer;
  decrypt: (data: Buffer) => string;
};

const secretsDir = (userData: string) => join(userData, 'secrets');
const secretFile = (userData: string, provider: KeyProvider) => join(secretsDir(userData), `${provider}.bin`);
const LEGACY_FILE = 'claude-token.bin';

type Rule = { prefix: string; reject?: string };

const RULES: Record<KeyProvider, Rule> = {
  'claude-sub': { prefix: 'sk-ant-oat' },
  'claude-api': { prefix: 'sk-ant-api' },
  'openai-api': { prefix: 'sk-', reject: 'sk-ant' },
  'gemini-api': { prefix: 'AIza' },
};

export type KeyValidation = { ok: true; key: string } | { ok: false; message: string };

/** Valida o formato (sem testar na rede). Recusa espaços e caracteres de controle: a chave vai em cabeçalhos HTTP. */
export function validateKey(provider: AiProvider, raw: string): KeyValidation {
  if (!hasKeyField(provider)) return { ok: false, message: t('ai.key.no-field') };
  const key = String(raw ?? '').trim();
  const rule = RULES[provider];
  if (!key.startsWith(rule.prefix) || (rule.reject && key.startsWith(rule.reject))) return { ok: false, message: t(`ai.key.${provider}`) };
  if (/[\s\u0000-\u001f\u007f"'<>\\]/.test(key)) return { ok: false, message: t('ai.key.whitespace') };
  if (key.length < 20) return { ok: false, message: t('ai.key.short') };
  if (key.length > 400) return { ok: false, message: t('ai.key.long') };
  return { ok: true, key };
}

export async function saveSecret(userData: string, provider: KeyProvider, key: string, crypto: TokenCrypto): Promise<void> {
  await mkdir(secretsDir(userData), { recursive: true, mode: 0o700 });
  await writeFile(secretFile(userData, provider), crypto.encrypt(key), { mode: 0o600 });
}

export async function loadSecret(userData: string, provider: AiProvider, crypto: TokenCrypto): Promise<string | null> {
  if (!hasKeyField(provider)) return null;
  try {
    return crypto.decrypt(await readFile(secretFile(userData, provider))) || null;
  } catch {
    return null;
  }
}

export async function clearSecret(userData: string, provider: KeyProvider): Promise<void> {
  await rm(secretFile(userData, provider), { force: true });
}

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Leva o antigo `claude-token.bin` para `secrets/claude-sub.bin` sem perder o token (mover, não reescrever). */
export async function migrateLegacyToken(userData: string): Promise<boolean> {
  const legacy = join(userData, LEGACY_FILE);
  if (!(await exists(legacy))) return false;
  const target = secretFile(userData, 'claude-sub');
  if (await exists(target)) return false; // já migrado: não sobrescreve nada
  await mkdir(secretsDir(userData), { recursive: true, mode: 0o700 });
  await rename(legacy, target);
  return true;
}

/** O que o renderer pode saber de um segredo: nunca o valor, só se existe e os 4 últimos caracteres. */
export function describeSecret(key: string | null): { hasKey: boolean; last4?: string } {
  return key ? { hasKey: true, last4: key.slice(-4) } : { hasKey: false };
}
