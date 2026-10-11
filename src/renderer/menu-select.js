// Seleção por popover (no lugar do <select> nativo): botão com o valor atual e menu `.menu-popover`. Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /**
   * `options`: { items: [{ value, label }], value, ariaLabel, onChoose(value) }.
   * Devolve { root, setItems(items, value?), setValue(value) }. Esc fecha, ↑/↓ navegam, Enter escolhe, clique fora fecha.
   */
  function create(options) {
    let items = options.items;
    let value = options.value;
    let popover = null;
    let active = 0;
    let offOutside = null;

    const root = el('div', { className: 'menu-select-root' }, []);
    const button = el('button', { className: 'menu-select-btn' }, []);
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    if (options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
    root.append(button);

    const labelOf = (v) => (items.find((i) => i.value === v) || { label: String(v) }).label;
    const draw = () => {
      button.replaceChildren(document.createTextNode(labelOf(value)), window.RiceIcons.caret());
    };

    function close(refocus) {
      if (!popover) return;
      popover.remove();
      popover = null;
      button.setAttribute('aria-expanded', 'false');
      if (offOutside) offOutside();
      offOutside = null;
      if (refocus) button.focus();
    }

    function choose(next) {
      const changed = next !== value;
      close(true);
      if (!changed) return;
      value = next;
      draw();
      options.onChoose(next);
    }

    function open() {
      active = Math.max(0, items.findIndex((i) => i.value === value));
      const list = el('div', { className: 'select-list', tabIndex: -1 }, []);
      list.setAttribute('role', 'listbox');
      if (options.ariaLabel) list.setAttribute('aria-label', options.ariaLabel);
      const nodes = items.map((item) => {
        const opt = el('div', { className: 'menu-item select-opt' }, [
          el('span', { textContent: item.label }, []),
          el('span', { className: 'check' }, item.value === value ? [window.RiceIcons.icon('check')] : []),
        ]);
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', String(item.value === value));
        opt.onclick = () => choose(item.value);
        return opt;
      });
      const paint = () => {
        nodes.forEach((n, i) => n.classList.toggle('active', i === active));
        if (nodes[active] && nodes[active].scrollIntoView) nodes[active].scrollIntoView({ block: 'nearest' });
      };
      list.append(...nodes);
      popover = el('div', { className: 'menu-popover select-popover' }, [list]);
      popover.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
          paint();
        } else if (e.key === 'Enter' && items[active]) {
          e.preventDefault();
          choose(items[active].value);
        }
      };
      paint();
      root.append(popover);
      button.setAttribute('aria-expanded', 'true');
      const outside = (e) => {
        if (!root.contains(e.target)) close(false);
      };
      document.addEventListener('mousedown', outside);
      offOutside = () => document.removeEventListener('mousedown', outside);
      list.focus();
    }

    button.onclick = () => (popover ? close(true) : open());
    draw();
    return {
      root,
      setItems(next, nextValue) {
        items = next;
        if (nextValue !== undefined) value = nextValue;
        draw();
      },
      setValue(next) {
        value = next;
        draw();
      },
    };
  }

  window.RiceMenuSelect = { create };
})();
