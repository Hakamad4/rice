import { t } from '../i18n';
import { AiError, PROVIDER_LABEL, type AiProvider } from './types';

/** Tira qualquer segredo conhecido de um texto antes de ele virar mensagem de erro. */
export function redact(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join('***');
  return out;
}

const TAIL = 300;

/** Mensagem amigável por tipo de erro; `detail` (já sem segredos) entra em "other" e em "not-installed". */
export function friendlyMessage(provider: AiProvider, kind: AiError['kind'], detail?: string): string {
  const name = PROVIDER_LABEL[provider].replace(' (API)', '');
  switch (kind) {
    case 'auth':
      if (provider === 'chatgpt-sub' || provider === 'opencode-sub' || provider === 'agy-sub') return t(`ai.err.auth.${provider}`);
      return t(provider.endsWith('-api') ? 'ai.err.auth.api' : 'ai.err.auth.sub', { name });
    case 'rate-limit':
      return t('ai.err.rate-limit', { name });
    case 'network':
      return t('ai.err.network', { name });
    case 'cancelled':
      return t('ai.err.cancelled');
    case 'not-installed':
      return detail ?? t('ai.err.not-installed', { name });
    default:
      return detail ? t('ai.err.other-detail', { name, detail: detail.slice(0, TAIL) }) : t('ai.err.other', { name });
  }
}

export function aiError(provider: AiProvider, kind: AiError['kind'], detail?: string, secrets: readonly (string | null | undefined)[] = []): AiError {
  return new AiError(kind, friendlyMessage(provider, kind, detail === undefined ? undefined : redact(detail, secrets)));
}

/** Classifica uma resposta HTTP de erro de uma API (corpo já lido e sem segredos). */
export function classifyHttpStatus(status: number, body: string): AiError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 400 && /api[ _-]?key|authenticat|credential/i.test(body)) return 'auth';
  return 'other';
}

/** Classifica texto livre de erro (stderr de CLI, mensagem de evento). */
export function classifyMessage(message: string): AiError['kind'] {
  if (/401|unauthori[sz]ed|not logged in|log ?in required|login required|waiting for authentication|invalid api key|authentication|please (log|sign) ?in|credential/i.test(message)) return 'auth';
  if (/429|rate.?limit|usage limit|quota|too many requests|overloaded/i.test(message)) return 'rate-limit';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(message)) return 'network';
  return 'other';
}
