/**
 * Atualização automática no Windows (electron-updater + GitHub Releases), só no app instalado pelo NSIS.
 * Regras: nada é consultado nem baixado com "Procurar atualizações" desligada ou no Modo 100% local; nada é instalado no meio de uma
 * gravação (a instalação espera a gravação acabar); o usuário decide baixar e reiniciar. No Mac este módulo nunca liga: lá o app vem do install.sh.
 * A biblioteca real entra por `load`, então os testes usam um feed falso.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type WinUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
export type WinUpdateState = {
  /** Este app sabe se atualizar sozinho (Windows + instalado pelo NSIS + opção ligada + fora do Modo 100% local). */
  supported: boolean;
  phase: WinUpdatePhase;
  version?: string;
  /** 0 a 100, só em `downloading`. */
  percent?: number;
  /** Com a gravação rolando, a instalação fica esperando: o botão mostra isso. */
  waitingForRecording?: boolean;
  /** Mensagem curta (só após uma ação do usuário; falhas das consultas automáticas são silenciosas). */
  error?: string;
};

/** O pedaço da API do `autoUpdater` do electron-updater que usamos. */
export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease?: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

export type WinUpdaterDeps = {
  /** A biblioteca real (ou um feed falso nos testes); null se não carregar. */
  load: () => UpdaterLike | null;
  /** Windows + app empacotado + `app-update.yml` do NSIS ao lado do app. */
  supported: () => boolean;
  /** Opção "Procurar atualizações" e Modo 100% local (a consulta automática só roda com isto). */
  enabled: () => Promise<boolean>;
  /** Só o Modo 100% local fora (busca manual, baixar e instalar funcionam com a opção automática desligada); padrão: `enabled`. */
  allowed?: () => Promise<boolean>;
  isRecording: () => boolean;
  onChange: (state: WinUpdateState) => void;
};

/** electron-updater lê `resources/app-update.yml` (gerado pelo electron-builder quando há `publish`): sem ele, não há de onde atualizar. */
export function nsisInstall(opts: { platform: string; packaged: boolean; resourcesPath: string }): boolean {
  return opts.platform === 'win32' && opts.packaged && existsSync(join(opts.resourcesPath, 'app-update.yml'));
}

const clean = (message: unknown): string => String(message ?? '').replace(/\s+/g, ' ').slice(0, 160);

export function createWinUpdater(deps: WinUpdaterDeps) {
  let updater: UpdaterLike | null = null;
  let state: WinUpdateState = { supported: false, phase: 'idle' };
  let installRequested = false;
  let manual = false; // a última ação veio do usuário (só então um erro aparece)

  const set = (patch: Partial<WinUpdateState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };

  function lib(): UpdaterLike | null {
    if (updater) return updater;
    const u = deps.load();
    if (!u) return null;
    u.autoDownload = false; // quem baixa é o usuário, no botão
    u.autoInstallOnAppQuit = false; // quem instala é o "Reiniciar e atualizar" (e nunca durante uma gravação)
    u.allowPrerelease = false;
    u.on('update-available', (info: { version?: string }) => set({ phase: 'available', version: String(info?.version ?? ''), percent: undefined, error: undefined }));
    u.on('update-not-available', () => set({ phase: 'idle', version: undefined, percent: undefined }));
    u.on('download-progress', (p: { percent?: number }) => set({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0))) }));
    u.on('update-downloaded', (info: { version?: string }) => {
      set({ phase: 'downloaded', percent: undefined, version: String(info?.version ?? state.version ?? '') });
      if (installRequested) void install();
    });
    u.on('error', (err: unknown) => {
      if (manual) set({ phase: state.version ? 'available' : 'idle', percent: undefined, error: clean((err as Error)?.message) });
      else set({ phase: state.phase === 'downloading' ? 'available' : state.phase, percent: undefined });
    });
    updater = u;
    return u;
  }

  /** Estado para a tela: `supported` reflete as regras de agora (opção ligada, fora do Modo 100% local, instalado pelo NSIS). */
  async function status(): Promise<WinUpdateState> {
    const supported = deps.supported() && (await (deps.allowed ?? deps.enabled)());
    if (supported !== state.supported) state = { ...state, supported };
    if (!supported && state.phase !== 'idle') state = { supported, phase: 'idle' };
    return { ...state, waitingForRecording: installRequested && deps.isRecording() };
  }

  /** Procura versão nova. `byUser`: se falhar, mostra o erro; automática: falha em silêncio. */
  async function check(byUser = false): Promise<WinUpdateState> {
    manual = byUser;
    if (!(await status()).supported || (!byUser && !(await deps.enabled()))) return status();
    if (state.phase === 'downloading' || state.phase === 'downloaded') return status();
    const u = lib();
    if (!u) return status();
    set({ phase: 'checking', error: undefined });
    try {
      await u.checkForUpdates();
    } catch (err) {
      set({ phase: 'idle', error: byUser ? clean((err as Error)?.message) : undefined });
    }
    if (state.phase === 'checking') set({ phase: 'idle' });
    return status();
  }

  /** "Baixar e instalar": baixa e, ao terminar, fica pronto para o "Reiniciar e atualizar". */
  async function download(): Promise<WinUpdateState> {
    manual = true;
    if (!(await status()).supported || state.phase !== 'available') return status();
    const u = lib();
    if (!u) return status();
    set({ phase: 'downloading', percent: 0, error: undefined });
    try {
      await u.downloadUpdate();
    } catch (err) {
      set({ phase: 'available', percent: undefined, error: clean((err as Error)?.message) });
    }
    return status();
  }

  /** "Reiniciar e atualizar": com gravação em andamento só marca o pedido e espera (nunca interrompe). */
  async function install(): Promise<{ ok: boolean; waiting?: boolean }> {
    if (state.phase !== 'downloaded' || !updater || !(await status()).supported) return { ok: false };
    installRequested = true;
    if (deps.isRecording()) {
      set({ waitingForRecording: true });
      return { ok: true, waiting: true };
    }
    installRequested = false;
    updater.quitAndInstall(false, true); // o instalador roda e reabre o Rice
    return { ok: true };
  }

  /** Chamar quando uma gravação termina: se o usuário já tinha pedido para reiniciar, é agora. */
  function recordingEnded(): void {
    if (installRequested && state.phase === 'downloaded' && !deps.isRecording()) void install();
  }

  return { status, check, download, install, recordingEnded };
}
