// Menu de ações em popover (⋯ da reunião, ⋯ e clique direito na lista, ⋯ da pasta), com submenus.
// Usa `.menu-popover`/`.menu-item`; só createElement/textContent.
(function () {
  let openMenu = null;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Botão discreto à direita da linha (ícone de linha e/ou texto muted pequeno): roda a própria ação sem escolher o item. */
  function trailButton(trail) {
    const b = el('button', { type: 'button', className: 'action-trail', disabled: Boolean(trail.disabled) }, [...(trail.icon ? [window.RiceIcons.icon(trail.icon)] : []), ...(trail.text ? [el('span', { textContent: trail.text }, [])] : [])]);
    if (trail.title) {
      b.title = trail.title;
      b.setAttribute('aria-label', trail.title);
    }
    b.onclick = (e) => {
      e.stopPropagation();
      if (trail.disabled) return;
      close(true);
      trail.onSelect();
    };
    return b;
  }

  function close(refocus) {
    if (!openMenu) return;
    const { panels, off, anchor } = openMenu;
    openMenu = null;
    for (const panel of panels) panel.node.remove();
    off();
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    if (refocus && anchor && anchor.focus) anchor.focus();
  }

  function closeSubmenus(parent) {
    if (!openMenu) return;
    for (const panel of openMenu.panels.filter((p) => p.parent === parent)) {
      closeSubmenus(panel);
      panel.node.remove();
      openMenu.panels = openMenu.panels.filter((p) => p !== panel);
      if (panel.entry) panel.entry.node.setAttribute('aria-expanded', 'false');
    }
  }

  /**
   * Abre o menu perto de `anchor` (botão) ou de `at` ({x, y}, clique direito). Só um menu aberto por vez.
   * `items`: { label, sub?, trail?: { icon?, text?, title, onSelect, disabled? } (botão discreto à direita da linha), hint? (texto muted à direita), icon?, onSelect(), danger?, disabled?, checked?, title?, submenu?: items } ou { separator: true }.
   * Posição `fixed`: não é cortado pela barra lateral. Submenu: clique, passar o mouse ou → abrem; ← e Esc voltam.
   */
  function open({ anchor, at, items, placement }) {
    close(false);
    openMenu = { panels: [], anchor, off: () => {} };

    function makePanel(panelItems, parent, entry) {
      const list = el('div', { className: 'action-list', tabIndex: -1 }, []);
      list.setAttribute('role', 'menu');
      const panel = { node: null, list, actionable: [], active: 0, parent, entry };
      const nodes = panelItems.map((item) => {
        if (item.heading) {
          return el('div', { className: 'menu-heading', textContent: item.heading }, []); // título de seção: não é item, ninguém foca nele
        }
        if (item.separator) {
          const sep = el('div', { className: 'menu-sep' }, []);
          sep.setAttribute('role', 'separator');
          return sep;
        }
        if (item.header !== undefined || item.note !== undefined) {
          // rótulo de grupo ou nota: texto, nunca um item (fora do teclado e do clique)
          const text = el('div', { className: item.header !== undefined ? 'menu-head' : 'menu-note', textContent: item.header !== undefined ? item.header : item.note }, []);
          text.setAttribute('role', 'presentation');
          return text;
        }
        const trailing = item.submenu ? [window.RiceIcons.icon('chevron-right')] : item.checked ? [window.RiceIcons.icon('check')] : [];
        const node = el('div', { className: 'menu-item action-item' + (item.muted ? ' muted' : '') + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '') + (item.submenu ? ' has-submenu' : '') }, [
          el('span', { className: 'action-icon' }, item.icon ? [window.RiceIcons.icon(item.icon)] : []),
          ...(item.sub
            ? [el('span', { className: 'action-text' }, [el('span', { className: 'action-label', textContent: item.label }, []), el('span', { className: 'action-sub', textContent: item.sub }, [])])]
            : [el('span', { className: 'action-label', textContent: item.label }, [])]),
          ...(item.trail ? [trailButton(item.trail)] : item.hint ? [el('span', { className: 'action-hint', textContent: item.hint }, [])] : []),
          el('span', { className: 'check' }, trailing),
        ]);
        node.setAttribute('role', 'menuitem');
        if (item.submenu) {
          node.setAttribute('aria-haspopup', 'menu');
          node.setAttribute('aria-expanded', 'false');
        }
        if (item.checked) node.setAttribute('aria-checked', 'true');
        if (item.disabled) node.setAttribute('aria-disabled', 'true');
        if (item.title) node.title = item.title;
        if (item.indent) node.style.paddingLeft = `${10 + item.indent * 14}px`; // árvore (pastas dentro de pastas)
        const entryRef = { node, item, panel };
        node.onclick = (e) => {
          e.stopPropagation();
          if (item.disabled) return;
          if (item.submenu) return openSub(entryRef);
          close(true);
          item.onSelect();
        };
        node.onmouseenter = () => {
          panel.active = panel.actionable.indexOf(entryRef);
          paint(panel);
          if (item.submenu && !item.disabled) openSub(entryRef);
          else closeSubmenus(panel);
        };
        panel.actionable.push(entryRef);
        return node;
      });
      list.append(...nodes);
      const node = el('div', { className: 'menu-popover action-menu' + (parent ? ' submenu' : '') }, [list]);
      panel.node = node;
      panel.active = Math.max(0, panel.actionable.findIndex((a) => !a.item.disabled));
      node.onkeydown = (e) => onKey(e, panel);
      document.body.append(node);
      openMenu.panels.push(panel);
      return panel;
    }

    function paint(panel) {
      panel.actionable.forEach((a, i) => a.node.classList.toggle('active', i === panel.active));
    }

    function openSub(entryRef) {
      const { panel, item, node } = entryRef;
      if (openMenu.panels.some((p) => p.entry === entryRef)) return;
      closeSubmenus(panel);
      const sub = makePanel(item.submenu, panel, entryRef);
      node.setAttribute('aria-expanded', 'true');
      const rect = node.getBoundingClientRect();
      const width = sub.node.offsetWidth || 220;
      const left = rect.right + 4 + width > window.innerWidth - 8 ? Math.max(8, rect.left - width - 4) : rect.right + 4;
      sub.node.style.left = `${left}px`;
      sub.node.style.top = `${Math.max(8, Math.min(rect.top - 7, window.innerHeight - 8 - (sub.node.offsetHeight || 0)))}px`;
      paint(sub);
      sub.list.focus();
    }

    function onKey(e, panel) {
      const { actionable } = panel;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (panel.parent) {
          closeSubmenus(panel.parent);
          panel.parent.list.focus();
        } else close(true);
      } else if (e.key === 'ArrowLeft' && panel.parent) {
        e.preventDefault();
        e.stopPropagation();
        closeSubmenus(panel.parent);
        panel.parent.list.focus();
      } else if (e.key === 'ArrowRight') {
        const current = actionable[panel.active];
        if (current && current.item.submenu && !current.item.disabled) {
          e.preventDefault();
          openSub(current);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        for (let n = 1; n <= actionable.length; n++) {
          const next = (panel.active + dir * n + actionable.length * 2) % actionable.length;
          if (!actionable[next].item.disabled) {
            panel.active = next;
            break;
          }
        }
        paint(panel);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const current = actionable[panel.active];
        if (current && !current.item.disabled) current.node.click();
      }
    }

    const root = makePanel(items, null, null);
    const popover = root.node;
    // posição: abaixo do âncora, alinhada à direita dele; dentro da janela
    const rect = anchor ? anchor.getBoundingClientRect() : { left: at.x, right: at.x, bottom: at.y, top: at.y };
    const width = popover.offsetWidth || 230;
    const left = Math.max(8, Math.min(anchor ? rect.right - width : rect.left, window.innerWidth - width - 8));
    popover.style.left = `${left}px`;
    // `placement: 'above'` (botão dentro do campo do chat): o menu abre acima do âncora, sem cobrir o campo
    popover.style.top = `${placement === 'above' ? Math.max(8, rect.top - 6 - (popover.offsetHeight || 0)) : Math.min(rect.bottom + 6, window.innerHeight - 8 - (popover.offsetHeight || 0))}px`;
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    paint(root);
    const outside = (e) => {
      if (!openMenu || !openMenu.panels.some((p) => p.node.contains(e.target))) close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    openMenu.off = () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
    root.list.focus();
    return { close: () => close(true) };
  }

  window.RiceActionMenu = { open, close: () => close(false), isOpen: () => openMenu !== null };
})();
