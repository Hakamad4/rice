import { homedir } from 'node:os';
import { dirname, delimiter } from 'node:path';

/** Credenciais que o Rice nunca deixa vazar do ambiente do usuário para um processo filho. */
export const SENSITIVE_ENV = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
] as const;

/**
 * Qualquer variável cujo NOME indique segredo (…_API_KEY, …_TOKEN, …_SECRET, …_PASSWORD, credenciais, chaves privadas, AWS_*, o
 * agente SSH…) também não passa para os filhos: um CLI de IA ou o whisper-server não precisam das credenciais do seu shell.
 */
const SECRET_NAME = /(^|_)(API_?KEYS?|ACCESS_?KEYS?|AUTH_?TOKEN|TOKEN|SECRETS?|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_?KEY|SESSION_?KEY)(_|$)|^(AWS|AZURE|GCP|GITHUB|GH|GITLAB|NPM|YARN|PYPI|DOCKER|SSH_AUTH)(_|$)/i;

export const isSecretEnvName = (name: string): boolean => (SENSITIVE_ENV as readonly string[]).includes(name) || SECRET_NAME.test(name);

/** App aberto pelo Finder herda um PATH mínimo; os CLIs são scripts `#!/usr/bin/env node` e precisam achar o `node`. */
function extendedPath(current: string | undefined, binary?: string): string {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', `${homedir()}/.local/bin`];
  if (binary && binary.includes('/')) extra.unshift(dirname(binary));
  const parts = [...(current ?? '').split(delimiter).filter(Boolean), ...extra];
  return [...new Set(parts)].join(delimiter);
}

/**
 * Ambiente do processo filho: apaga as credenciais herdadas e injeta só as do provedor ativo (`inject`).
 * `binary` (opcional) entra no PATH para o `env node` dos CLIs funcionar.
 */
export function buildChildEnv(base: NodeJS.ProcessEnv, inject: Record<string, string> = {}, binary?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of Object.keys(env)) if (isSecretEnvName(name)) delete env[name];
  env.PATH = extendedPath(env.PATH, binary);
  return { ...env, ...inject };
}
