import '../renderer/i18n.js';
import '../renderer/locales/pt-BR.js';
import '../renderer/locales/en.js';
import type api from '../renderer/i18n.js';

/** O motor e os dicionários são os mesmos do renderer (arquivos carregados acima registram `globalThis.RiceI18n`). */
const i18n = (globalThis as unknown as { RiceI18n: typeof api }).RiceI18n;

/** Textos do main (menu, notificações, erros que aparecem na UI). */
export const { t, tn, setLanguage, getLanguage, locale, fromSystemLocale } = i18n;
export type { UiLanguage } from '../renderer/i18n.js';
