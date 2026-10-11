export type UiLanguage = 'pt-BR' | 'en';
declare const api: {
  LANGUAGES: UiLanguage[];
  dictionaries: Record<UiLanguage, Record<string, string>>;
  add(language: UiLanguage, entries: Record<string, string>): void;
  setLanguage(language: string): UiLanguage;
  getLanguage(): UiLanguage;
  locale(language?: UiLanguage): string;
  fromSystemLocale(systemLocale: string | undefined): UiLanguage;
  t(key: string, vars?: Record<string, string | number>, language?: UiLanguage): string;
  applyDom(root?: ParentNode): void;
  isMine(raw: string): boolean;
  speaker(raw: string): string;
  tn(key: string, n: number, vars?: Record<string, string | number>, language?: UiLanguage): string;
};
export default api;
