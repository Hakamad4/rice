// Seletor de template: chip + popover com busca, lista agrupada e prévia das seções. Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const tr = (key, vars) => window.RiceI18n.t(key, vars);
  const tplIcon = (tpl) => window.RiceIcons.icon(tpl.icon || 'file-text');
  const firstLine = (text) => String(text || '').split('\n')[0];
  let uid = 0;

  /**
   * `options`: { templates, selectedId, onChoose(id), onManage?() }.
   * Devolve { root, setSelected(id) }; `setSelected` só atualiza o chip (não chama onChoose).
   */
  function create(options) {
    const { templates, onChoose, onManage } = options;
    const id = `tpl-picker-${++uid}`;
    let selectedId = options.selectedId;
    let popover = null;
    let visible = [];
    let active = 0;
    let offOutside = null;

    const root = el('div', { className: 'tpl-picker-root' }, []);
    const chip = el('button', { className: 'tpl-chip' }, []);
    chip.setAttribute('aria-haspopup', 'listbox');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-label', tr('tpl.picker.label'));
    root.append(chip);

    const selected = () => templates.find((t) => t.id === selectedId) || templates[0] || null;
    const drawChip = () => {
      const tpl = selected();
      chip.replaceChildren(...(tpl ? [tplIcon(tpl)] : []), document.createTextNode(`${options.labelPrefix ? `${options.labelPrefix} ` : ''}${tpl ? tpl.title : tr('tpl.picker.none')}`), window.RiceIcons.caret());
    };

    function close(refocus) {
      if (!popover) return;
      popover.remove();
      popover = null;
      chip.setAttribute('aria-expanded', 'false');
      if (offOutside) offOutside();
      offOutside = null;
      if (refocus) chip.focus();
    }

    function choose(template) {
      const changed = template.id !== selectedId;
      close(true);
      if (!changed) return;
      selectedId = template.id;
      drawChip();
      onChoose(template.id);
    }

    function open() {
      const search = el('input', { type: 'search', className: 'tpl-search', placeholder: tr('tpl.picker.search'), autocomplete: 'off' }, []);
      search.setAttribute('aria-label', tr('tpl.picker.search-label'));
      search.setAttribute('aria-controls', `${id}-list`);
      const list = el('div', { className: 'tpl-list', id: `${id}-list` }, []);
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', tr('tpl.picker.list'));
      const preview = el('div', { className: 'tpl-popover-preview' }, []);
      const children = [search, list, preview];
      if (onManage) {
        const manage = el('button', { className: 'tpl-manage', textContent: tr('tpl.picker.manage') }, []);
        manage.onclick = () => {
          close(false);
          onManage();
        };
        children.push(manage);
      }
      popover = el('div', { className: `menu-popover tpl-popover${options.kind === 'ideas' ? ' compact-list' : ''}` }, children);

      const showPreview = () => {
        const t = visible[active];
        preview.replaceChildren(...(t ? [window.RiceTemplatePreview.render(t, { compact: true, kind: options.kind })] : []));
        preview.hidden = !t;
      };
      const setActive = (index) => {
        active = Math.max(0, Math.min(index, visible.length - 1));
        [...list.querySelectorAll('[role=option]')].forEach((node, i) => node.classList.toggle('active', i === active));
        const node = list.querySelectorAll('[role=option]')[active];
        if (node) search.setAttribute('aria-activedescendant', node.id);
        else search.removeAttribute('aria-activedescendant');
        showPreview();
      };
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        visible = templates.filter((t) => !q || `${t.title} ${t.description}`.toLowerCase().includes(q));
        const nodes = [];
        for (const [label, builtin] of [[tr('tpl.picker.builtin'), true], [tr('tpl.picker.mine'), false]]) {
          const items = visible.filter((t) => Boolean(t.builtin) === builtin);
          if (items.length === 0) continue;
          nodes.push(el('div', { className: 'tpl-group', textContent: label }, []));
          for (const t of items) {
            const isCurrent = t.id === selectedId;
            const option = el('div', { className: 'menu-item tpl-opt', id: `${id}-${t.id}`, tabIndex: -1 }, [
              el('span', { className: 'tpl-opt-symbol tpl-ico' }, [tplIcon(t)]),
              el('span', { className: 'tpl-opt-main' }, [
                el('span', { className: 'tpl-opt-title' }, [t.title, ...(t.customized ? [el('span', { className: 'tpl-edited', textContent: tr('tpl.edited') }, [])] : [])]),
                el('span', { className: 'tpl-opt-desc', textContent: firstLine(t.description) }, []),
              ]),
              el('span', { className: 'check tpl-opt-check' }, isCurrent ? [window.RiceIcons.icon('check')] : []),
            ]);
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(isCurrent));
            option.onclick = () => choose(t);
            option.onmouseover = () => setActive(visible.indexOf(t));
            nodes.push(option);
          }
        }
        if (visible.length === 0) nodes.push(el('p', { className: 'tpl-empty', textContent: tr('tpl.picker.empty') }, []));
        list.replaceChildren(...nodes);
      };
      draw();
      active = Math.max(0, visible.findIndex((t) => t.id === selectedId));
      search.oninput = () => {
        draw();
        setActive(0);
      };
      popover.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
        } else if (e.key === 'Enter' && e.target === search) {
          e.preventDefault();
          if (visible[active]) choose(visible[active]);
        }
      };
      root.append(popover);
      chip.setAttribute('aria-expanded', 'true');
      setActive(active);
      // cabe na coluna: o menu nunca passa da borda direita da coluna do conteúdo (nem do chat, quando ele está por cima),
      // e a prévia só vai ao lado se couber; senão vai abaixo da lista
      const rect = chip.getBoundingClientRect();
      const column = root.closest('#detail');
      const col = column ? column.getBoundingClientRect() : { left: 0, right: window.innerWidth };
      const chatEl = document.getElementById('chat');
      const scrim = document.getElementById('chat-scrim');
      const overlayChat = chatEl && scrim && document.body.classList.contains('chat-open') && getComputedStyle(scrim).display !== 'none';
      const limit = Math.min(col.right, overlayChat ? chatEl.getBoundingClientRect().left : Infinity, window.innerWidth) - 8;
      const width = Math.max(220, Math.min(320, limit - col.left - 8));
      popover.style.width = `${width}px`;
      const shift = Math.max(0, rect.left + width - limit); // desloca para a esquerda o quanto faltar, sem passar da borda esquerda da coluna
      const left = -Math.min(shift, Math.max(0, rect.left - col.left - 8));
      popover.style.left = `${left}px`;
      popover.classList.toggle('preview-below', rect.left + left + width + 280 > limit);
      const outside = (e) => {
        if (!root.contains(e.target)) close(false);
      };
      document.addEventListener('mousedown', outside);
      offOutside = () => document.removeEventListener('mousedown', outside);
      search.focus();
    }

    chip.onclick = () => (popover ? close(true) : open());
    drawChip();
    return {
      root,
      setSelected(next) {
        selectedId = next;
        drawChip();
      },
    };
  }

  window.RiceTemplatePicker = { create };
})();
