import { t } from '../i18n';
import { isLocalHost } from '../ai/local-model';

/**
 * Modo 100% local: com ele ligado NADA sai do computador. Este módulo guarda o estado (lido pelo main a cada uso) e é a rede de
 * segurança de último recurso: o `fetch` global do main é trocado por um que só aceita localhost enquanto o modo está ligado.
 * Os recursos de rede também são bloqueados e explicados na interface, cada um no seu lugar (busca, ferramentas, agenda do Google…).
 */
let on = false;
export const isLocalMode = (): boolean => on;
export const setLocalMode = (next: boolean): void => {
  on = next;
};

export class LocalModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalModeError';
  }
}

/** A URL aponta para o próprio computador (127.0.0.1, localhost ou ::1)? Qualquer outra coisa, ou lixo, não. */
export function isLoopbackUrl(input: unknown): boolean {
  try {
    const raw = input instanceof URL ? input.href : typeof input === 'string' ? input : (input as { url?: string } | null)?.url;
    if (typeof raw !== 'string') return false;
    return isLocalHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/** Lança `LocalModeError` se o modo está ligado e o destino não é localhost. `what` = nome do recurso para a mensagem. */
export function assertNetworkAllowed(url: string, what?: string): void {
  if (on && !isLoopbackUrl(url)) throw new LocalModeError(what ? t('local.mode.blocked-feature', { feature: what }) : t('local.mode.blocked'));
}

type FetchFn = typeof fetch;

/** `fetch` com a guarda do modo local. Sem o modo, repassa tudo ao fetch original. */
export function guardedFetch(real: FetchFn): FetchFn {
  return ((input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    if (on && !isLoopbackUrl(input)) return Promise.reject(new LocalModeError(t('local.mode.blocked')));
    return real(input, init);
  }) as FetchFn;
}

/** Instala a guarda no `fetch` global (uma vez). Devolve o fetch original (testes e quem precisar do real). */
export function installNetworkGuard(target: { fetch: FetchFn } = globalThis as unknown as { fetch: FetchFn }): FetchFn {
  const real = target.fetch;
  target.fetch = guardedFetch(real);
  return real;
}
