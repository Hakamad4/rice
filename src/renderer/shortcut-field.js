// Campo do atalho global de gravar/parar (Configurações › Atalhos): mostra ⌥⌘R, captura o novo atalho e avisa de conflito.
// Só createElement/textContent. O main valida e registra; aqui só se monta o texto e se captura a tecla.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const ORDER = ['Control', 'Alt', 'Shift', 'Command'];
  const MAC_GLYPH = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' };
  const WIN_NAME = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Command: 'Win' };

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** "Alt+Command+R" -> "⌥⌘R" no Mac; "Control+Alt+R" -> "Ctrl+Alt+R" no Windows. */
  function format(accelerator, win) {
    if (!accelerator) return t('settings.shortcut.none');
    const parts = String(accelerator).split('+');
    const key = parts.pop();
    const mods = ORDER.filter((m) => parts.includes(m));
    return win ? [...mods.map((m) => WIN_NAME[m]), key].join('+') : `${mods.map((m) => MAC_GLYPH[m]).join('')}${key}`;
  }

  /** Atalho do KeyboardEvent: 'cancel' (Esc), 'invalid' (sem modificador), null (ainda só modificador ou tecla sem suporte) ou o atalho. */
  function fromEvent(e, win) {
    if (e.key === 'Escape') return 'cancel';
    const m = /^Key([A-Z])$/.exec(e.code || '') || /^Digit(\d)$/.exec(e.code || '') || /^(F(?:[1-9]|1\d|2[0-4]))$/.exec(e.code || '');
    if (!m) return null;
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', !win && e.metaKey && 'Command'].filter(Boolean);
    if (!mods.some((x) => x === 'Control' || x === 'Alt' || x === 'Command')) return 'invalid';
    return [...ORDER.filter((x) => mods.includes(x)), m[1]].join('+');
  }

  /** `rice`: a API do preload; `initial`: { accelerator, state, defaultAccelerator } do main. Devolve { root, paint(status) }. */
  function create({ rice, initial }) {
    const win = window.rice.platform === 'win32';
    let status = initial || { accelerator: null, state: 'none', defaultAccelerator: '' };
    let listening = false;
    let message = '';

    const field = el('button', { type: 'button', className: 'shortcut-key btn ghost' }, []);
    field.setAttribute('aria-label', t('settings.shortcut.label'));
    const clear = el('button', { type: 'button', className: 'btn ghost', textContent: t('settings.shortcut.clear') }, []);
    const reset = el('button', { type: 'button', className: 'btn ghost', textContent: t('settings.shortcut.reset') }, []);
    const note = el('p', { className: 'set-help shortcut-note' }, []);
    const root = el('div', { className: 'shortcut-field' }, [el('div', { className: 'shortcut-buttons' }, [field, clear, reset]), note]);

    function paint() {
      const shown = status.state === 'conflict' && !listening ? status.accelerator : status.accelerator;
      field.textContent = listening ? t('settings.shortcut.listening') : status.accelerator ? format(shown, win) : t('settings.shortcut.none');
      field.classList.toggle('listening', listening);
      field.title = t('settings.shortcut.capture');
      clear.hidden = !status.accelerator;
      reset.hidden = status.accelerator === status.defaultAccelerator && status.state === 'registered';
      note.classList.toggle('warn', Boolean(message));
      note.textContent = message || (listening ? t('settings.shortcut.hint') : !status.accelerator ? t('settings.shortcut.off') : '');
      note.hidden = !note.textContent;
    }

    async function apply(choice, attempted) {
      listening = false;
      message = '';
      const res = await rice.setRecordShortcut(choice);
      status = { accelerator: res.accelerator, state: res.state, defaultAccelerator: res.defaultAccelerator };
      if (res.invalid) message = t('settings.shortcut.invalid');
      else if (!res.ok) message = t('settings.shortcut.conflict', { keys: format(attempted || res.accelerator, win) });
      paint();
    }

    function stop() {
      listening = false;
      field.removeEventListener('keydown', onKey, true);
      field.removeEventListener('blur', stop);
      paint();
    }
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      const got = fromEvent(e, win);
      if (got === null) return; // só um modificador apertado: segue ouvindo
      field.removeEventListener('keydown', onKey, true);
      field.removeEventListener('blur', stop);
      if (got === 'cancel') return stop();
      if (got === 'invalid') {
        listening = false;
        message = t('settings.shortcut.invalid');
        return paint();
      }
      apply(got, got);
    }
    field.onclick = () => {
      if (listening) return stop();
      listening = true;
      message = '';
      paint();
      field.addEventListener('keydown', onKey, true);
      field.addEventListener('blur', stop);
      field.focus();
    };
    clear.onclick = () => apply('none');
    reset.onclick = () => apply('default', status.defaultAccelerator);

    if (status.state === 'conflict') message = t('settings.shortcut.conflict', { keys: format(status.accelerator, win) });
    paint();
    return { root, paint, status: () => status };
  }

  window.RiceShortcut = { create, format, fromEvent };
})();
