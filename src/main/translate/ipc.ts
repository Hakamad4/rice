import type { Segment } from '../../shared/types';
import { t } from '../i18n';
import { LocalModeError, isLocalMode } from '../privacy/local-mode';
import { isTranslateLang, TRANSLATE_LANGS, type OfflineTranslator, type TranslateLang } from './offline';
import { TranslateService, type AiAvailability, type TranslateNotice } from './service';
import { readTranslations } from './store';

export type TranslateHost = {
  handle: (channel: string, fn: (e: unknown, ...args: any[]) => unknown) => void;
  send: (channel: string, payload: unknown) => void;
  checkedDir: (dir: unknown) => Promise<string>;
  ai: () => Promise<AiAvailability>;
  offline: OfflineTranslator;
  /** Chave OFFLINE_TRANSLATION (padrão ligada só em testes antigos; o main passa o valor real). */
  offlineEnabled: boolean;
  startedAt: (dir: string) => Promise<Date>;
  /** Idioma falado da reunião ('pt' | 'en'): decide o destino padrão (en se a reunião é pt, senão pt). */
  meetingLanguage: (dir: string) => Promise<'pt' | 'en'>;
  lastLanguage: () => Promise<TranslateLang | undefined>;
  rememberLanguage: (lang: TranslateLang) => Promise<void>;
  onError?: (scope: string, err: unknown) => void;
};

export function createTranslate(host: TranslateHost) {
  const service = new TranslateService({
    ai: host.ai,
    offline: host.offline,
    offlineEnabled: host.offlineEnabled,
    startedAt: host.startedAt,
    onResult: (r) => host.send('translate:result', r),
    onNotice: (dir, notice: TranslateNotice) => host.send('translate:notice', { dir, notice }),
    onError: (err) => host.onError?.('translate', err),
  });

  const offlineView = () => ({ ...host.offline.status(), enabled: host.offlineEnabled, localMode: isLocalMode() });
  const emitOffline = () => host.send('translate:offline', offlineView());

  const view = async (dir: string) => {
    const meeting = await host.meetingLanguage(dir);
    // nunca o idioma da própria reunião: traduzir pt para pt não faz sentido
    const fallback: TranslateLang = meeting === 'pt' ? 'en' : 'pt';
    const wanted = service.language(dir) ?? (await host.lastLanguage());
    const lang = wanted && wanted !== meeting ? wanted : fallback;
    return { dir, on: service.isOn(dir), lang, from: meeting, langs: TRANSLATE_LANGS, offline: offlineView(), records: await readTranslations(dir) };
  };

  const { handle } = host;
  handle('translate:get', async (_e, rawDir: unknown) => view(await host.checkedDir(rawDir)));
  handle('translate:set', async (_e, rawDir: unknown, patch: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const p = (typeof patch === 'object' && patch !== null ? patch : {}) as { on?: unknown; lang?: unknown };
    const current = await view(dir);
    const from = current.from;
    const lang = isTranslateLang(p.lang) && p.lang !== current.from ? p.lang : current.lang;
    if (isTranslateLang(p.lang) && p.lang !== current.from) await host.rememberLanguage(lang);
    if (p.on === false) service.stop(dir);
    else if (p.on === true || service.isOn(dir)) service.start(dir, lang, from);
    return view(dir);
  });
  handle('translate:offline-status', () => offlineView());
  const langsOf = (raw: unknown): TranslateLang[] => (Array.isArray(raw) ? [...new Set(raw.filter(isTranslateLang))] : []);
  handle('translate:offline-download', async (_e, raw: unknown) => {
    if (!host.offlineEnabled) return { ok: false as const, message: '' };
    if (isLocalMode()) return { ok: false as const, message: t('local.mode.blocked-feature', { feature: t('translate.offline.title') }) };
    try {
      const langs = langsOf(raw);
      if (langs.length === 0) return { ok: false as const, message: '' };
      await host.offline.download(langs, () => emitOffline());
      emitOffline();
      return { ok: true as const };
    } catch (err) {
      emitOffline();
      if (err instanceof LocalModeError) return { ok: false as const, message: err.message };
      if ((err as Error).name === 'AbortError') return { ok: false as const, cancelled: true as const, message: '' };
      host.onError?.('translate-download', err);
      return { ok: false as const, message: t('translate.offline.failed') };
    }
  });
  handle('translate:offline-cancel', () => {
    host.offline.cancelDownload();
    emitOffline();
    return { ok: true as const };
  });
  handle('translate:offline-delete', async (_e, raw: unknown) => {
    await host.offline.delete(langsOf(raw));
    emitOffline();
    return { ok: true as const };
  });

  return {
    service,
    /** Assina o evento `segment` da sessão (trecho FINAL). */
    onSegment: (dir: string, segment: Segment) => service.onSegment(dir, segment),
    /** A gravação acabou: desliga tudo (sem sessão, nada fica na RAM). */
    onSessionIdle: () => service.stopAll(),
  };
}
