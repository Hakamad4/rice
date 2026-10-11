// "Privacidade e segurança": o que fica no Mac e o que sai, em afirmações verificáveis (ver .superpowers/security-audit.md).
// Só createElement/textContent. `items(ai)` devolve as linhas; o provedor ativo vem de `rice.aiStatus()`.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const FREE_MODEL = /^opencode\/big-pickle$|^opencode\/.*free$|:free$/i;

  /** Uma linha: ícone de linha, título e texto curto. */
  function item(icon, title, text, extra, wide) {
    return el('div', { className: wide ? 'priv-item wide' : 'priv-item' }, [
      el('span', { className: 'priv-ico' }, [window.RiceIcons.icon(icon)]),
      el('div', { className: 'priv-body' }, [
        el('div', { className: 'priv-title', textContent: title }, []),
        el('p', { className: 'priv-text', textContent: text }, []),
        ...(extra || []),
      ]),
    ]);
  }

  /** Para onde vai o texto, com o provedor ativo nomeado ("Hoje: Claude (Anthropic)"). */
  function outgoing(ai) {
    const active = ai && ai.active;
    const extra = [];
    if (active) {
      extra.push(el('p', { className: 'priv-today', textContent: t('privacy.today', { provider: t(`privacy.vendor.${active}`) }) }, []));
      const model = ai.models && ai.models[active];
      if (active === 'opencode-sub' && model && FREE_MODEL.test(model)) extra.push(el('p', { className: 'priv-note' }, [window.RiceIcons.icon('info'), el('span', { textContent: t('privacy.free-warning') }, [])]));
    }
    return item('arrow-up-right', t('privacy.out.title'), t('privacy.out.text'), extra, true);
  }

  /** As linhas da seção. `ai` pode ser nulo (status ainda não chegou): aí não há a linha "Hoje". */
  function items(ai) {
    return [
      item('lock', t('privacy.local.title'), t('privacy.local.text'), [], true),
      outgoing(ai),
      item('mic', t('privacy.audio.title'), t('privacy.audio.text')),
      item('globe', t('privacy.calendar.title'), t('privacy.calendar.text')),
      item('download', t('privacy.downloads.title'), t('privacy.downloads.text')),
      item('shield', t('privacy.none.title'), t('privacy.none.text')),
      item('paperclip', t('privacy.attach.title'), t('privacy.attach.text'), [], true),
    ];
  }

  window.RicePrivacy = { items };
})();
