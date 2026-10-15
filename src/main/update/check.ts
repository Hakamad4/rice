import type { BuildInfo } from './build-info';
import { PUBLIC_REPO } from './build-info';

/** Consulta anônima: sem token, sem cabeçalho que identifique quem pergunta. */
export const COMMITS_URL = `https://api.github.com/repos/${PUBLIC_REPO.replace('github.com/', '')}/commits/main`;
export const RELEASES_URL = `https://${PUBLIC_REPO}/releases`;
export const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** `at`: última tentativa (segura o limite de 1 por dia); `lastCheckAt`: última consulta que deu certo (a linha "Última verificação" da tela). */
export type UpdateState = { at?: string; sha?: string; date?: string; lastCheckAt?: string };
export type UpdateStatus = {
  enabled: boolean;
  available: boolean;
  from?: string;
  to?: string;
  /** O app veio de um clone com o `update.sh` (o botão "Atualizar" roda lá); senão só a página de releases. */
  fromClone: boolean;
};

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** No máximo uma consulta por dia (o relógio voltar atrás não trava a verificação). */
export function dueForCheck(lastAt: string | undefined, now: Date): boolean {
  const last = lastAt ? Date.parse(lastAt) : NaN;
  return Number.isNaN(last) || last > now.getTime() || now.getTime() - last >= DAY_MS;
}

const short = (sha: string) => sha.slice(0, 7);

/** Há versão nova se o commit remoto é outro E mais recente que o do build (um build à frente do `main` não avisa). */
export function isNewer(local: Pick<BuildInfo, 'commit' | 'commitDate' | 'date'>, remote: { sha: string; date: string }): boolean {
  const a = local.commit.toLowerCase();
  const b = remote.sha.toLowerCase();
  if (b.startsWith(a) || a.startsWith(b)) return false;
  const localDate = Date.parse(local.commitDate ?? local.date ?? '');
  const remoteDate = Date.parse(remote.date);
  if (Number.isNaN(remoteDate)) return false;
  return Number.isNaN(localDate) || remoteDate > localDate;
}

export function parseCommit(body: unknown): { sha: string; date: string } | null {
  const o = body as { sha?: unknown; commit?: { committer?: { date?: unknown }; author?: { date?: unknown } } } | null;
  const date = o?.commit?.committer?.date ?? o?.commit?.author?.date;
  if (typeof o?.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(o.sha) || typeof date !== 'string' || Number.isNaN(Date.parse(date))) return null;
  return { sha: o.sha.toLowerCase(), date };
}

export type CheckerDeps = {
  info: () => BuildInfo | null;
  /** Opção "Procurar atualizações" (ligada por padrão). */
  enabled: () => Promise<boolean>;
  getState: () => Promise<UpdateState>;
  setState: (state: UpdateState) => Promise<void>;
  /** Instância de teste: nunca consulta nada. */
  disabled?: () => boolean;
  fetch?: FetchLike;
  now?: () => Date;
  /** O clone ainda existe e tem o `update.sh`. */
  cloneUsable: (path: string) => boolean;
  /** Modo 100% local: nem a busca manual consulta. */
  localMode?: () => Promise<boolean> | boolean;
};

export function createUpdateChecker(deps: CheckerDeps) {
  const now = () => deps.now?.() ?? new Date();
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);

  async function status(): Promise<UpdateStatus> {
    const enabled = await deps.enabled();
    const info = deps.info();
    const fromClone = Boolean(info?.clonePath && deps.cloneUsable(info.clonePath));
    if (!info || !info.remote || !enabled || deps.disabled?.()) return { enabled, available: false, fromClone };
    const state = await deps.getState();
    const available = Boolean(state.sha && state.date && isNewer(info, { sha: state.sha, date: state.date }));
    return { enabled, available, fromClone, ...(available ? { from: short(info.commit), to: short(state.sha!) } : {}) };
  }

  /** Consulta se já passou um dia; qualquer falha (rede, limite da API, resposta estranha) é silenciosa. Devolve o status atual. */
  async function maybeCheck(): Promise<UpdateStatus> {
    const info = deps.info();
    if (!info?.remote || deps.disabled?.() || !(await deps.enabled())) return status();
    const state = await deps.getState();
    if (!dueForCheck(state.at, now())) return status();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(COMMITS_URL, { headers: { accept: 'application/vnd.github+json' }, signal: controller.signal });
      const commit = res.ok ? parseCommit(await res.json()) : null;
      // a data da tentativa vale mesmo se falhar: sem martelar a API quando ela está fora do ar
      const at = now().toISOString();
      await deps.setState({ ...state, at, ...(commit ? { sha: commit.sha, date: commit.date, lastCheckAt: at } : {}) });
    } catch {
      await deps.setState({ ...state, at: now().toISOString() }).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
    return status();
  }

  /** Busca pedida pelo usuário: ignora a opção automática e o limite diário (quem limita é quem chama), mas nunca no Modo 100% local. */
  async function checkNow(): Promise<{ kind: 'local' | 'unavailable' | 'error' | 'done'; status: UpdateStatus }> {
    const enabled = await deps.enabled();
    const info = deps.info();
    const fromClone = Boolean(info?.clonePath && deps.cloneUsable(info.clonePath));
    const idle: UpdateStatus = { enabled, available: false, fromClone };
    if (await deps.localMode?.()) return { kind: 'local', status: idle };
    if (!info?.remote || deps.disabled?.()) return { kind: 'unavailable', status: idle };
    const state = await deps.getState();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(COMMITS_URL, { headers: { accept: 'application/vnd.github+json' }, signal: controller.signal });
      const commit = res.ok ? parseCommit(await res.json()) : null;
      if (!commit) throw new Error('resposta inesperada');
      const at = now().toISOString();
      await deps.setState({ ...state, at, sha: commit.sha, date: commit.date, lastCheckAt: at });
      const available = isNewer(info, commit);
      return { kind: 'done', status: { enabled, available, fromClone, ...(available ? { from: short(info.commit), to: short(commit.sha) } : {}) } };
    } catch {
      return { kind: 'error', status: idle };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status, maybeCheck, checkNow };
}
