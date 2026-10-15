// Chip do microfone em uso, perto do botão Parar: ícone de microfone + nome curto; o `title` traz o nome completo e se é o padrão do sistema ou o
// escolhido. Sem informação, o chip não aparece. Ao trocar no meio da gravação, um aviso discreto "Microfone trocado para X". Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** `node`: o elemento do chip; `notice(text)`: aviso discreto (toast). */
  function create({ node, notice }) {
    let info = null;
    const paint = () => {
      node.hidden = !info;
      if (!info) return node.replaceChildren();
      const how = info.chosen ? t('mic.chosen') : t('mic.default');
      node.replaceChildren(window.RiceIcons.icon('mic'), el('span', { className: 'mic-chip-name', textContent: info.short || info.name }, []));
      node.title = `${info.name} · ${how}`;
      node.setAttribute('aria-label', `${t('mic.label')}: ${info.name} · ${how}`);
    };
    return {
      /** Chegou (ou mudou) o microfone: mostra o chip e, se foi uma troca no meio da gravação, avisa. */
      show(next) {
        if (!next || typeof next.name !== 'string' || !next.name) return this.hide();
        info = { name: next.name, short: typeof next.short === 'string' ? next.short : '', isDefault: next.isDefault === true, chosen: next.chosen === true };
        paint();
        if (next.switched && notice) notice(t('mic.switched', { name: info.short || info.name }));
      },
      hide() {
        info = null;
        paint();
      },
      repaint: paint,
    };
  }

  window.RiceMicChip = { create };
})();
