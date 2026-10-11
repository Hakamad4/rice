// Seletores de idioma (do app e das reuniões) como controle segmentado, usados no tutorial e na tela de Configurações.
// Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /**
   * Controle segmentado (radiogroup): botões lado a lado, o ativo destacado.
   * Teclado: ←/→ (e ↑/↓) mudam a seleção; só o ativo entra na ordem do Tab.
   */
  function segmented({ name, label, options, value, onChange }) {
    const group = el('div', { className: 'segmented' }, []);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    const buttons = options.map(([v, text]) => {
      const b = el('button', { className: 'seg-btn', textContent: text, name, type: 'button' }, []);
      b.dataset.value = v;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === value));
      b.tabIndex = v === value ? 0 : -1;
      return b;
    });
    const select = (index, focus) => {
      const next = buttons[index];
      if (!next || next.dataset.value === value) {
        if (next && focus) next.focus();
        return;
      }
      value = next.dataset.value;
      buttons.forEach((b) => {
        const on = b === next;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (focus) next.focus();
      onChange(value);
    };
    buttons.forEach((b, i) => {
      b.onclick = () => select(i, true);
      b.onkeydown = (e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        select((i + step + buttons.length) % buttons.length, true);
      };
    });
    group.append(...buttons);
    return group;
  }

  function field(label, help, control) {
    return el('div', { className: 'setting-field' }, [
      el('div', { className: 'setting-label', textContent: label }, []),
      control,
      el('p', { className: 'hint', textContent: help }, []),
    ]);
  }

  /**
   * `settings`: { uiLanguage, transcriptionLanguage } vindos de `getSettings`. `onChange()` roda depois de salvar
   * (e o foco volta ao botão ativo do mesmo grupo). Trocar o idioma do app re-renderiza tudo (o main avisa as janelas);
   * o das reuniões vale a partir da próxima gravação.
   */
  function render({ settings, onChange }) {
    const rice = window.rice;
    const persist = (name, save) => async (value) => {
      await save(value);
      if (onChange) await onChange();
      const again = document.querySelector(`button[name="${name}"][aria-checked="true"]`);
      if (again && again !== document.activeElement) again.focus();
    };
    const app = segmented({
      name: 'ui-language',
      label: t('lang.app'),
      options: [['pt-BR', t('lang.app.pt-BR')], ['en', t('lang.app.en')]],
      value: settings.uiLanguage || 'pt-BR',
      onChange: persist('ui-language', (v) => rice.setUiLanguage(v)),
    });
    const meetings = segmented({
      name: 'transcription-language',
      label: t('lang.meetings'),
      options: [['pt', t('lang.tr.pt')], ['en', t('lang.tr.en')], ['auto', t('lang.tr.auto')]],
      value: settings.transcriptionLanguage || 'pt',
      onChange: persist('transcription-language', (v) => rice.setTranscriptionLanguage(v)),
    });
    return el('div', { className: 'lang-settings' }, [
      field(t('lang.app'), t('lang.app.help'), app),
      field(t('lang.meetings'), `${t('lang.tr.help')} ${t('lang.tr.auto-help')}`, meetings),
    ]);
  }

  /**
   * O mesmo par de seletores em "linhas" (rótulo + explicação à esquerda, controle à direita), para a tela de Configurações.
   * Devolve [linhaDoApp, linhaDasReuniões]; `row(label, help, control)` monta cada uma.
   */
  function rows({ settings, onChange, row }) {
    const rice = window.rice;
    const persist = (name, save) => async (value) => {
      await save(value);
      if (onChange) await onChange();
      const again = document.querySelector(`button[name="${name}"][aria-checked="true"]`);
      if (again && again !== document.activeElement) again.focus();
    };
    const app = segmented({
      name: 'ui-language',
      label: t('lang.app'),
      options: [['pt-BR', t('lang.app.pt-BR')], ['en', t('lang.app.en')]],
      value: settings.uiLanguage || 'pt-BR',
      onChange: persist('ui-language', (v) => rice.setUiLanguage(v)),
    });
    const meetings = segmented({
      name: 'transcription-language',
      label: t('lang.meetings'),
      options: [['pt', t('lang.tr.pt')], ['en', t('lang.tr.en')], ['auto', t('lang.tr.auto')]],
      value: settings.transcriptionLanguage || 'pt',
      onChange: persist('transcription-language', (v) => rice.setTranscriptionLanguage(v)),
    });
    return [row(t('lang.app'), t('lang.app.help'), app), row(t('lang.meetings'), `${t('lang.tr.help')} ${t('lang.tr.auto-help')}`, meetings)];
  }

  window.RiceLanguage = { render, rows, segmented };
})();
