// Popover discreto para dar nome a "Pessoa N": campo de texto, nomes da agenda e sugestão da IA (só sugestão,
// nunca aplicada sozinha). Só createElement/textContent. Um por vez; Esc e clique fora fecham.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  let current = null;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  function close(refocus) {
    if (!current) return;
    const { node, anchor, off } = current;
    current = null;
    node.remove();
    off();
    anchor.setAttribute('aria-expanded', 'false');
    if (refocus) anchor.focus();
  }

  /**
   * `label`: o rótulo atual ("Pessoa 2" ou o nome). `name`: nome salvo ('' se não há). `participants`: nomes da agenda.
   * `suggest()`: Promise<string[]> opcional (sugestão da IA). `onSave(name)`: '' remove o nome.
   */
  function open({ anchor, label, name, participants, suggest, onSave }) {
    close(false);
    const input = el('input', { type: 'text', value: name || '', placeholder: t('speaker.name-ph'), maxLength: 40, spellcheck: false }, []);
    input.setAttribute('aria-label', t('speaker.rename', { label }));
    const save = (value) => {
      close(true);
      onSave(value.trim());
    };
    const chips = (names) => names.map((n) => {
      const b = el('button', { className: 'chip', textContent: n, type: 'button' }, []);
      b.onclick = () => save(n);
      return b;
    });
    const body = el('div', { className: 'speaker-pop' }, [
      el('div', { className: 'speaker-pop-row' }, [
        input,
        (() => {
          const ok = el('button', { className: 'icon-btn', type: 'button', title: t('speaker.save') }, [window.RiceIcons.icon('check')]);
          ok.setAttribute('aria-label', t('speaker.save'));
          ok.onclick = () => save(input.value);
          return ok;
        })(),
      ]),
    ]);
    const known = (participants || []).filter((n) => n && n !== name);
    if (known.length > 0) body.append(el('p', { className: 'speaker-pop-label', textContent: t('speaker.from-calendar') }, []), el('div', { className: 'speaker-pop-chips' }, chips(known.slice(0, 8))));
    const slot = el('div', { className: 'speaker-pop-suggest' }, []);
    if (suggest) {
      const ask = el('button', { className: 'link-button', type: 'button', textContent: t('speaker.suggest') }, []);
      ask.onclick = async () => {
        slot.replaceChildren(el('p', { className: 'speaker-pop-label', textContent: t('speaker.suggesting') }, []));
        let names = [];
        try {
          names = await suggest();
        } catch {
          names = [];
        }
        if (!current || current.node !== body) return;
        slot.replaceChildren(
          names.length > 0
            ? el('div', {}, [el('p', { className: 'speaker-pop-label', textContent: t('speaker.suggested') }, []), el('div', { className: 'speaker-pop-chips' }, chips(names))])
            : el('p', { className: 'speaker-pop-label', textContent: t('speaker.suggest-none') }, []),
        );
      };
      slot.append(ask);
    }
    body.append(slot);
    if (name) {
      const clear = el('button', { className: 'link-button', type: 'button', textContent: t('speaker.clear') }, []);
      clear.onclick = () => save('');
      body.append(clear);
    }
    document.body.append(body);
    const r = anchor.getBoundingClientRect();
    body.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - body.offsetWidth - 8))}px`;
    body.style.top = `${Math.min(r.bottom + 6, window.innerHeight - body.offsetHeight - 8)}px`;
    const onKey = (e) => {
      if (e.key === 'Escape') close(true);
      else if (e.key === 'Enter' && document.activeElement === input) save(input.value);
    };
    const onDown = (e) => {
      if (!body.contains(e.target) && e.target !== anchor) close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    anchor.setAttribute('aria-expanded', 'true');
    current = { node: body, anchor, off: () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true); } };
    input.focus();
    input.select();
  }

  window.RiceSpeakerPopover = { open, close };
})();
