/**
 * "Buscar atualização agora": um pedido explícito do usuário, então funciona mesmo com "Procurar atualizações" desligada;
 * só o Modo 100% local barra. Mac (clone/dmg): a consulta do commit; Windows instalado: o electron-updater. No máximo uma busca a cada 10 s.
 */
import type { UpdateStatus } from './check';
import type { WinUpdateState } from './win-updater';

export const MIN_GAP_MS = 10_000;

export type CheckNowResult = {
  /** `latest`: já está na mais recente; `available`: há versão nova; `error`: falhou; `local`: Modo 100% local (nada consultado). */
  phase: 'latest' | 'available' | 'error' | 'local';
  /** Versão nova (Windows) ou o commit remoto (Mac, no `status`). */
  newVersion?: string;
  /** Mac: o status completo, para o aviso de versão nova. */
  status?: UpdateStatus;
  /** `network`: sem conexão com o GitHub; `other`: outro erro (a mensagem vai junto). */
  error?: 'network' | 'other';
  message?: string;
  /** ISO da última consulta que deu certo. */
  lastCheckAt?: string;
};

export type CheckNowDeps = {
  localMode: () => Promise<boolean>;
  /** Windows instalado pelo NSIS: devolve o estado do updater; `null` quando este app não se atualiza assim. */
  win?: () => Promise<WinUpdateState | null>;
  commit: () => Promise<{ kind: 'local' | 'unavailable' | 'error' | 'done'; status: UpdateStatus }>;
  lastCheckAt: () => Promise<string | undefined>;
  /** Windows: a consulta deu certo agora. */
  markChecked: () => Promise<void>;
  now?: () => number;
};

const NETWORK = /net::|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|network|offline|internet|socket|timed? ?out|getaddrinfo/i;

export function createCheckNow(deps: CheckNowDeps) {
  const now = () => deps.now?.() ?? Date.now();
  let startedAt = -Infinity;
  let last: CheckNowResult | null = null;
  let running: Promise<CheckNowResult> | null = null;

  async function run(): Promise<CheckNowResult> {
    const win = deps.win ? await deps.win() : null;
    if (win) {
      if (win.error) return { phase: 'error', error: NETWORK.test(win.error) ? 'network' : 'other', message: win.error, lastCheckAt: await deps.lastCheckAt() };
      await deps.markChecked();
      const found = win.phase === 'available' || win.phase === 'downloading' || win.phase === 'downloaded';
      return { phase: found ? 'available' : 'latest', ...(found ? { newVersion: win.version } : {}), lastCheckAt: await deps.lastCheckAt() };
    }
    const r = await deps.commit();
    const lastCheckAt = await deps.lastCheckAt();
    if (r.kind === 'local') return { phase: 'local', lastCheckAt };
    if (r.kind === 'error') return { phase: 'error', error: 'network', status: r.status, lastCheckAt };
    if (r.kind === 'unavailable') return { phase: 'latest', status: r.status, lastCheckAt }; // build sem remoto público: nada a comparar
    return { phase: r.status.available ? 'available' : 'latest', status: r.status, ...(r.status.to ? { newVersion: r.status.to } : {}), lastCheckAt };
  }

  /** Dentro dos 10 s da busca anterior devolve o resultado dela (sem consultar de novo); busca em andamento é compartilhada. */
  async function checkNow(): Promise<CheckNowResult> {
    if (await deps.localMode()) return { phase: 'local', lastCheckAt: await deps.lastCheckAt() };
    if (running) return running;
    if (last && now() - startedAt < MIN_GAP_MS) return last;
    startedAt = now();
    running = run()
      .catch((): CheckNowResult => ({ phase: 'error', error: 'network' }))
      .then((r) => (last = r))
      .finally(() => (running = null));
    return running;
  }

  return { checkNow };
}
