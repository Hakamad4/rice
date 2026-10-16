// Chip do microfone em uso, perto do botão Parar: ícone de microfone + nome curto; o `title` traz o nome completo e se é o padrão do sistema ou o
// escolhido. Sem informação, o chip não aparece. Ao trocar no meio da gravação, um aviso discreto "Microfone trocado para X". Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /**
   * `node`: o elemento do chip; `notice(text)`: aviso discreto (toast). `api` (Mac, opcional): { micInputs, micSwitch, micMuteIgnore } para o menu
   * de troca na hora e o aviso de "microfone mudo".
   */
  function create({ node, notice, api }) {
    let info = null;
    let mute = null;
    let currentId = null;
    const interactive = Boolean(api && api.micInputs && api.micSwitch);
    if (interactive) {
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.setAttribute('aria-haspopup', 'menu');
      node.setAttribute('aria-expanded', 'false');
    }
    const paint = () => {
      node.hidden = !info;
      if (!info) return node.replaceChildren();
      const how = info.chosen ? t('mic.chosen') : info.detected ? t('mic.detected') : t('mic.default');
      node.replaceChildren(window.RiceIcons.icon('mic'), el('span', { className: 'mic-chip-name', textContent: info.short || info.name }, []), ...(info.detected ? [el('span', { className: 'mic-chip-tag', textContent: t('mic.detected') }, [])] : []));
      node.title = interactive ? `${info.name} · ${how} · ${t('mic.menu.label')}` : `${info.name} · ${how}`;
      node.setAttribute('aria-label', `${t('mic.label')}: ${info.name} · ${how}`);
    };

    /** Menu para trocar na hora: Padrão do macOS, as entradas reais e a atual marcada. */
    async function openMenu() {
      let list = { inputs: [], currentId: null };
      try {
        list = (await api.micInputs()) || list;
      } catch {
        // sem lista: o menu só oferece o padrão
      }
      currentId = list.currentId;
      const choose = async (id) => {
        node.setAttribute('aria-expanded', 'false');
        try {
          await api.micSwitch(id);
        } catch {
          // a troca falhou: o chip continua como está
        }
      };
      node.setAttribute('aria-expanded', 'true');
      window.RiceActionMenu.open({
        anchor: node,
        items: [
          { label: t('mic.menu.default'), checked: Boolean(info && info.isDefault && !info.chosen && !info.detected), onSelect: () => choose('') },
          { separator: true },
          ...(list.inputs || []).map((i) => ({ label: i.short || i.name, title: i.name, checked: i.id === currentId, onSelect: () => choose(i.id) })),
        ],
      });
    }
    if (interactive) {
      node.addEventListener('click', () => { if (info) openMenu(); });
      node.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && info) {
          e.preventDefault();
          openMenu();
        }
      });
    }

    /** "Seu microfone parece mudo. Trocar para X?" com Trocar e Ignorar (some ao trocar, ignorar, parar ou depois de 30 s). */
    function hideMute() {
      if (mute) mute.remove();
      mute = null;
    }
    function showMute(next) {
      hideMute();
      if (!next || typeof next.id !== 'string' || typeof next.name !== 'string' || !next.name || !interactive) return;
      const swap = el('button', { type: 'button', className: 'consent-copy', textContent: t('mic.mute.switch') }, []);
      const ignore = el('button', { type: 'button', className: 'consent-copy ghost', textContent: t('mic.mute.ignore') }, []); // secundário (contorno), como os outros pares de ação
      mute = el('div', { className: 'consent-toast mic-mute-toast', role: 'status' }, [
        el('span', { className: 'consent-ico' }, [window.RiceIcons.icon('mic')]),
        el('span', { className: 'consent-text', textContent: t('mic.mute', { name: next.short || next.name }) }, []),
        swap,
        ignore,
      ]);
      swap.onclick = async () => {
        hideMute();
        try {
          await api.micSwitch(next.id);
        } catch {
          // a troca falhou: o aviso já foi dispensado
        }
      };
      ignore.onclick = () => {
        hideMute();
        if (api.micMuteIgnore) api.micMuteIgnore().catch(() => {});
      };
      window.RiceToastStack.get().append(mute);
      setTimeout(() => { if (mute && mute.isConnected && mute.querySelector('.consent-text')) hideMute(); }, 30000);
    }
    return {
      /** Chegou (ou mudou) o microfone: mostra o chip e, se foi uma troca no meio da gravação, avisa. */
      show(next) {
        if (!next || typeof next.name !== 'string' || !next.name) return this.hide();
        info = { name: next.name, short: typeof next.short === 'string' ? next.short : '', isDefault: next.isDefault === true, chosen: next.chosen === true, detected: next.detected === true };
        paint();
        if (next.switched && notice) notice(t('mic.switched', { name: info.short || info.name }));
      },
      hide() {
        info = null;
        hideMute();
        paint();
      },
      mute: showMute,
      repaint: paint,
    };
  }

  window.RiceMicChip = { create };
})();
