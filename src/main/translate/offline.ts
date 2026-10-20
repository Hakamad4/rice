/**
 * Contrato do motor de tradução OFFLINE (opção 2 da tradução ao vivo). O serviço (`service.ts`) só conhece esta interface; quem a
 * implementa (o Uirapuru) traz o modelo, o runtime e o download. Nada disso entra no instalador: o modelo é baixado sob demanda.
 *
 * Regras que toda implementação respeita:
 *  - desligado = custo zero: nada carregado (`status().state` fora de `loading`/`ready`) até `load()`;
 *  - `load()` é idempotente e `unload()` libera a RAM por completo;
 *  - os modelos vêm em PACOTES POR IDIOMA (OPUS-MT, CC-BY-4.0): `packs` diz o tamanho de cada um e o que está instalado. Traduz-se de A para B
 *    quando A, B e o inglês (pivô, a cargo do motor) estão instalados (`offlineReady`);
 *  - `download()` é retomável/cancelável, confere o hash e nunca deixa arquivo pela metade como "baixado";
 *  - o download é a ÚNICA rede do motor, e `isLocalMode()` (privacy/local-mode) o bloqueia como qualquer outro download;
 *  - `translate()` não toca a rede: só o computador do usuário.
 */
export type TranslateLang = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it';
export const TRANSLATE_LANGS: readonly TranslateLang[] = ['pt', 'en', 'es', 'fr', 'de', 'it'];
export const isTranslateLang = (value: unknown): value is TranslateLang => TRANSLATE_LANGS.includes(value as TranslateLang);

export type OfflineState =
  | 'not-installed' // nenhum pacote em disco
  | 'downloading'
  | 'installed' // ao menos um pacote em disco, nada na RAM
  | 'loading'
  | 'ready' // carregado: `translate()` responde
  | 'error'; // `error` tem a mensagem amigável

/** Um pacote de idioma: o tamanho do botão de download é a soma dos pacotes escolhidos. */
export type OfflinePack = { lang: TranslateLang; downloadBytes: number; diskBytes: number; installed: boolean };

export type OfflineStatus = {
  state: OfflineState;
  /** Um item por idioma suportado (inclusive o inglês, que é o pivô e precisa estar instalado). */
  packs: readonly OfflinePack[];
  /** RAM aproximada enquanto carregado (0 = descarregado). */
  ramBytes: number;
  /** Só `downloading`: soma dos pacotes pedidos. */
  progress?: { receivedBytes: number; totalBytes: number };
  error?: string;
};

export type OfflineTranslateOptions = {
  /** Idioma falado do trecho: obrigatório (o motor não detecta). */
  from: TranslateLang;
  to: TranslateLang;
  /** Trechos anteriores para coerência (o motor pode ignorar). */
  context?: readonly string[];
  signal?: AbortSignal;
};

export type DownloadProgress = { receivedBytes: number; totalBytes: number };

export interface OfflineTranslator {
  /** Estado atual, síncrono e barato (chamado a cada desenho das configurações). */
  status(): OfflineStatus;
  /** Sobe o modelo na RAM. Rejeita se não há pacote instalado ou há download em andamento. */
  load(): Promise<void>;
  /** Traduz um trecho de `from` para `to`. Carrega sozinho se preciso; rejeita se faltar pacote (ver `offlineReady`); respeita `signal` com `AbortError`. */
  translate(text: string, options: OfflineTranslateOptions): Promise<string>;
  /** Solta a RAM (os pacotes seguem em disco). Seguro chamar em qualquer estado. */
  unload(): Promise<void>;
  /** Baixa os pacotes dos idiomas pedidos (os já instalados são pulados). `onProgress` soma todos. Resolve quando todos estão instalados. */
  download(langs: readonly TranslateLang[], onProgress?: (p: DownloadProgress) => void): Promise<void>;
  /** Cancela o download em andamento (rejeita o `download()` com `AbortError`; apaga o parcial). */
  cancelDownload(): void;
  /** Apaga os pacotes dos idiomas pedidos (descarrega antes). */
  delete(langs: readonly TranslateLang[]): Promise<void>;
}

/** Pacotes que a tradução de `from` para `to` exige: os dois idiomas, menos o inglês (pivô sem pacote próprio, já vem com qualquer idioma). */
export const requiredPacks = (from: TranslateLang, to: TranslateLang): TranslateLang[] => [...new Set<TranslateLang>([from, to])].filter((l) => l !== 'en');

/** A tradução de `from` para `to` pode rodar offline? Os pacotes dos dois idiomas (exceto o inglês) precisam estar instalados. */
export function offlineReady(status: Pick<OfflineStatus, 'packs'>, from: TranslateLang, to: TranslateLang): boolean {
  if (from === to) return false;
  const installed = new Set(status.packs.filter((p) => p.installed).map((p) => p.lang));
  return requiredPacks(from, to).every((l) => installed.has(l));
}

/** Pacotes que faltam para traduzir de `from` para `to` offline (ex.: pt para fr: pt + fr; de/para o inglês, só o outro idioma). */
export function missingPacks(status: Pick<OfflineStatus, 'packs'>, from: TranslateLang, to: TranslateLang): TranslateLang[] {
  const installed = new Set(status.packs.filter((p) => p.installed).map((p) => p.lang));
  return requiredPacks(from, to).filter((l) => !installed.has(l));
}

/** Soma dos tamanhos de download dos pacotes (os já instalados não contam). */
export const downloadSize = (status: Pick<OfflineStatus, 'packs'>, langs: readonly TranslateLang[]): number =>
  status.packs.filter((p) => langs.includes(p.lang) && !p.installed).reduce((n, p) => n + p.downloadBytes, 0);

/** Sem motor real: todos os pacotes com tamanho 0 e nenhum instalado (a UI mostra "indisponível"). */
export const STUB_OFFLINE_STATUS: OfflineStatus = { state: 'not-installed', packs: TRANSLATE_LANGS.map((lang) => ({ lang, downloadBytes: 0, diskBytes: 0, installed: false })), ramBytes: 0 };

/** Substituto sem motor: nunca instalado, nunca traduz. Mantém o serviço, a UI e os testes funcionando até o Uirapuru plugar o real. */
export function createStubOfflineTranslator(): OfflineTranslator {
  const unavailable = () => Promise.reject(new Error('offline-translator-unavailable'));
  return {
    status: () => STUB_OFFLINE_STATUS,
    load: unavailable,
    translate: unavailable,
    unload: () => Promise.resolve(),
    download: unavailable,
    cancelDownload: () => {},
    delete: () => Promise.resolve(),
  };
}
