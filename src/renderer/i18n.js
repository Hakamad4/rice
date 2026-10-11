// i18n leve, sem dependências: dicionários por idioma e `t(chave, variáveis)`.
// O renderer carrega por <script>; o main importa o mesmo arquivo. Nos dois casos o motor fica em `globalThis.RiceI18n`.
(function (root, factory) {
  root.RiceI18n = factory();
})(globalThis, function () {
  const LANGUAGES = ['pt-BR', 'en'];
  const dictionaries = { 'pt-BR': {}, en: {} };
  let current = 'pt-BR';

  /** Registra (ou estende) o dicionário de um idioma. Os arquivos de `locales/` chamam isto. */
  function add(language, entries) {
    Object.assign(dictionaries[language], entries);
  }

  function setLanguage(language) {
    current = LANGUAGES.includes(language) ? language : 'pt-BR';
    return current;
  }

  const getLanguage = () => current;

  /** `pt-BR` → `pt-BR`; `en` → `en-US` (para `Intl`). */
  function locale(language) {
    return (language || current) === 'en' ? 'en-US' : 'pt-BR';
  }

  /** Idioma inicial a partir do locale do sistema (`app.getLocale()`): `pt…` → pt-BR, senão en. */
  function fromSystemLocale(systemLocale) {
    return String(systemLocale || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  }

  /**
   * Texto da chave no idioma atual (ou em `language`), com `{variável}` substituída.
   * Faltando no idioma, cai no pt-BR; faltando em todos, devolve a própria chave (aparece na tela e o teste de paridade pega).
   */
  function t(key, vars, language) {
    const lang = LANGUAGES.includes(language) ? language : current;
    let text = dictionaries[lang][key];
    if (text === undefined) text = dictionaries['pt-BR'][key];
    if (text === undefined) return key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  }

  /** Plural simples: usa `chave.one` quando n === 1, senão `chave.other`; `{n}` já vem preenchido. */
  function tn(key, n, vars, language) {
    return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...(vars || {}) }, language);
  }

  /**
   * Traduz o HTML estático: `data-i18n` (texto), `data-i18n-title`, `data-i18n-placeholder` e `data-i18n-aria` (atributos).
   * Chame de novo depois de trocar o idioma.
   */
  function applyDom(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return;
    if (!root && typeof document !== 'undefined') document.documentElement.lang = current === 'en' ? 'en' : 'pt-BR';
    for (const node of scope.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
    for (const [attr, target] of [['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label']]) {
      for (const node of scope.querySelectorAll(`[${attr}]`)) node.setAttribute(target, t(node.getAttribute(attr)));
    }
  }

  /** Rótulos gravados nos arquivos (Eu/Outros, Me/Others) → texto no idioma do app; só na exibição, o arquivo não muda. */
  const MINE = ['Eu', 'Me'];
  const OTHERS = ['Outros', 'Others'];
  const isMine = (raw) => MINE.includes(raw);
  /** `Pessoa N` (identificação de participantes) → número; nomes dados pelo usuário vêm em `names` (`{ "2": "Ana" }`). */
  const personId = (raw) => {
    const m = /^(?:Pessoa|Person) (\d+)$/.exec(raw);
    return m ? m[1] : null;
  };
  function speaker(raw, names) {
    if (MINE.includes(raw)) return t('transcript.me');
    if (OTHERS.includes(raw)) return t('transcript.others');
    const id = personId(raw);
    if (id) return (names && names[id]) || t('speaker.person', { n: id });
    return raw;
  }

  return { LANGUAGES, dictionaries, add, setLanguage, getLanguage, locale, fromSystemLocale, t, tn, applyDom, isMine, speaker, personId };
});
