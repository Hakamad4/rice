import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { clearSecret, describeSecret, loadSecret, migrateLegacyToken, saveSecret, validateKey, type TokenCrypto } from '../../src/main/ai/secrets';
import { makeTmpDir } from '../helpers/tmp';

const fake: TokenCrypto = {
  encrypt: (s) => Buffer.from(s.split('').reverse().join('')),
  decrypt: (b) => b.toString().split('').reverse().join(''),
};

const OAT = 'sk-ant-oat01-abcdefghijklmnopqrstu';
const ANT_API = 'sk-ant-api03-abcdefghijklmnopqrstu';
const OPENAI = 'sk-proj-abcdefghijklmnopqrstu';
const GEMINI = 'AIzaSyabcdefghijklmnopqrstuvwx';

test('validação de formato por provedor, com mensagens em pt-BR', () => {
  expect(validateKey('claude-sub', `  ${OAT}  `)).toEqual({ ok: true, key: OAT });
  expect(validateKey('claude-sub', ANT_API).ok).toBe(false);
  expect(validateKey('claude-api', ANT_API)).toEqual({ ok: true, key: ANT_API });
  expect(validateKey('claude-api', OAT).ok).toBe(false);
  expect(validateKey('openai-api', OPENAI)).toEqual({ ok: true, key: OPENAI });
  expect(validateKey('openai-api', ANT_API).ok).toBe(false); // sk-ant não vale como OpenAI
  expect(validateKey('gemini-api', GEMINI)).toEqual({ ok: true, key: GEMINI });
  expect(validateKey('gemini-api', OPENAI).ok).toBe(false);
  const bad = validateKey('gemini-api', 'xyz');
  expect(bad.ok === false && bad.message).toMatch(/AIza/);
});

test('recusa chave curta, com espaço/quebra de linha ou muito longa (vai em cabeçalho HTTP)', () => {
  expect(validateKey('claude-api', 'sk-ant-api03-curta').ok).toBe(false);
  expect(validateKey('claude-api', `${ANT_API} extra`).ok).toBe(false);
  expect(validateKey('claude-api', `${ANT_API}\nX-Evil: 1`).ok).toBe(false);
  expect(validateKey('openai-api', `sk-${'a'.repeat(500)}`).ok).toBe(false);
  expect(validateKey('chatgpt-sub', OPENAI).ok).toBe(false); // sem campo de chave
});

test('salva criptografado em secrets/<provedor>.bin (0600), carrega e limpa', async () => {
  const dir = await makeTmpDir();
  expect(await loadSecret(dir, 'claude-api', fake)).toBeNull();
  await saveSecret(dir, 'claude-api', ANT_API, fake);
  const file = join(dir, 'secrets', 'claude-api.bin');
  expect((await readFile(file)).toString()).not.toContain(ANT_API);
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600); // no Windows valem as ACLs do perfil
  expect(await loadSecret(dir, 'claude-api', fake)).toBe(ANT_API);
  expect(await loadSecret(dir, 'openai-api', fake)).toBeNull(); // cada provedor tem o seu arquivo
  await clearSecret(dir, 'claude-api');
  expect(await loadSecret(dir, 'claude-api', fake)).toBeNull();
  await clearSecret(dir, 'claude-api');
});

test('loadSecret devolve null se a decifragem falha ou o provedor não usa chave', async () => {
  const dir = await makeTmpDir();
  await saveSecret(dir, 'openai-api', OPENAI, fake);
  expect(await loadSecret(dir, 'openai-api', { encrypt: fake.encrypt, decrypt: () => { throw new Error('x'); } })).toBeNull();
  expect(await loadSecret(dir, 'chatgpt-sub', fake)).toBeNull();
});

test('migra claude-token.bin para secrets/claude-sub.bin sem perder o token', async () => {
  const dir = await makeTmpDir();
  await writeFile(join(dir, 'claude-token.bin'), fake.encrypt(OAT));
  expect(await migrateLegacyToken(dir)).toBe(true);
  expect(await loadSecret(dir, 'claude-sub', fake)).toBe(OAT);
  expect(await readdir(dir)).not.toContain('claude-token.bin');
  expect(await migrateLegacyToken(dir)).toBe(false); // idempotente
  expect(await loadSecret(dir, 'claude-sub', fake)).toBe(OAT);
});

test('migração não sobrescreve um segredo novo já existente', async () => {
  const dir = await makeTmpDir();
  await saveSecret(dir, 'claude-sub', OAT, fake);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'claude-token.bin'), fake.encrypt('sk-ant-oat01-outro-token-antigo-xx'));
  expect(await migrateLegacyToken(dir)).toBe(false);
  expect(await loadSecret(dir, 'claude-sub', fake)).toBe(OAT);
});

test('describeSecret nunca expõe o valor: só hasKey e os 4 últimos caracteres', () => {
  expect(describeSecret(null)).toEqual({ hasKey: false });
  const out = describeSecret(ANT_API);
  expect(out).toEqual({ hasKey: true, last4: ANT_API.slice(-4) });
  expect(JSON.stringify(out)).not.toContain(ANT_API);
});
