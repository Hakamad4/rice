// Histórico de versões das notas: chip "Versões (3)" ao lado do chip do template e a faixa de leitura de uma versão antiga.
// A versão atual é sempre o notas.md; ver uma versão não muda nada até "Restaurar esta". Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /** "hoje 16:40", "ontem 09:10" ou "12 de out., 16:40" no idioma do app. */
  function when(iso, now = new Date()) {
    const d = new Date(iso);
    const locale = window.RiceI18n.locale();
    const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diff === 0) return `${t('versions.today')} ${time}`;
    if (diff === 1) return `${t('versions.yesterday')} ${time}`;
    return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`;
  }

  const nameOf = (v) => v.templateName || t('versions.previous');

  /**
   * Chip "Versões (N)". `versions`: da mais nova à mais antiga; `currentTitle`: nome do template das notas atuais;
   * `viewing`: arquivo da versão em leitura (ou null); `onView(version)` / `onCurrent()` escolhem o que aparece no lugar das notas.
   */
  function chip({ versions, currentTitle, viewing, onView, onCurrent }) {
    const node = el('button', { type: 'button', className: 'tpl-chip ver-chip' }, [
      window.RiceIcons.icon('history'),
      el('span', { textContent: t('versions.chip', { n: versions.length }) }, []),
      window.RiceIcons.icon('chevron-down'),
    ]);
    node.setAttribute('aria-haspopup', 'menu');
    node.onclick = () =>
      window.RiceActionMenu.open({
        anchor: node,
        items: [
          { label: `${currentTitle} · ${t('versions.current')}`, checked: !viewing, onSelect: () => onCurrent() },
          { separator: true },
          ...versions.map((v) => ({ label: `${nameOf(v)} · ${when(v.createdAt)}`, checked: viewing === v.file, onSelect: () => onView(v) })),
        ],
      });
    return node;
  }

  /** Faixa fina no topo da leitura: "Versão de 16:10 · Reunião geral — Voltar para a atual · Restaurar esta". */
  function strip({ version, onBack, onRestore }) {
    const back = el('button', { type: 'button', className: 'link-button', textContent: t('versions.back') }, []);
    const restore = el('button', { type: 'button', className: 'link-button strong', textContent: t('versions.restore') }, []);
    back.onclick = onBack;
    restore.onclick = async () => {
      restore.disabled = true;
      await onRestore();
    };
    return el('div', { className: 'ver-strip', role: 'status' }, [
      el('span', { className: 'ver-strip-text', textContent: t('versions.strip', { when: when(version.createdAt), name: nameOf(version) }) }, []),
      el('span', { className: 'ver-strip-actions' }, [back, restore]),
    ]);
  }

  window.RiceVersions = { chip, strip, when };
})();
