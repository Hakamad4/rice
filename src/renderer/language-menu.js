// Chip único de idioma na faixa do topo (todas as telas): abre um menu em árvore com
// "Idioma do app ▸" (interface) e "Idioma das reuniões ▸" (transcrição: padrão e, numa reunião aberta, só esta). Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const LANGS = ['pt', 'en', 'auto'];
  const SHORT = { 'pt-BR': 'PT', en: 'EN' };

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Itens "Português · English · Automático" com ✓ no atual; `disabled` aplica a dica de sempre. */
  function meetingLanguageItems(current, disabled, onChoose) {
    return LANGS.map((language) => ({
      label: t(`lang.picker.opt-${language}`),
      checked: language === current,
      disabled,
      ...(disabled ? { title: t('lang.picker.disabled') } : {}),
      onSelect: () => (language === current ? undefined : onChoose(language)),
    }));
  }

  /** O menu em árvore. `state`: { ui, defaultLanguage, meetingLanguage (ou null fora de uma reunião), locked }. */
  function menuItems(state, on) {
    const appItems = ['pt-BR', 'en'].map((ui) => ({ label: t(`lang.name.${ui === 'en' ? 'en' : 'pt'}`), checked: ui === state.ui, onSelect: () => (ui === state.ui ? undefined : on.app(ui)) }));
    const defaults = meetingLanguageItems(state.defaultLanguage, false, on.defaultLanguage);
    const meetings = state.meetingLanguage
      ? [{ heading: t('langmenu.this') }, ...meetingLanguageItems(state.meetingLanguage, state.locked, on.meeting), { separator: true }, { heading: t('langmenu.default') }, ...defaults]
      : defaults;
    return [
      { icon: 'globe', label: t('langmenu.app'), submenu: appItems },
      { icon: 'mic', label: t('langmenu.meetings'), submenu: meetings },
      { separator: true },
      { icon: 'settings', label: t('langmenu.more'), onSelect: on.more },
    ];
  }

  /**
   * `getState()` devolve (ou promete) o estado atual; `on`: { app(ui), defaultLanguage(l), meeting(l), more() }.
   * Devolve { root, redraw, chip }.
   */
  function create({ getState, on }) {
    const chip = el('button', { id: 'lang-chip', className: 'lang-chip', type: 'button' }, []);
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    const redraw = () => {
      chip.replaceChildren(window.RiceIcons.icon('globe'), el('span', { className: 'lang-short', textContent: SHORT[window.RiceI18n.getLanguage()] || 'PT' }, []), window.RiceIcons.caret());
      chip.title = t('langmenu.title');
      chip.setAttribute('aria-label', t('langmenu.title'));
    };
    chip.onclick = async () => {
      const state = await getState();
      window.RiceActionMenu.open({ anchor: chip, items: menuItems(state, on) });
    };
    redraw();
    return { root: chip, chip, redraw };
  }

  window.RiceLanguageMenu = { create, menuItems };
})();
