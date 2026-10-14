// Interruptor "Ferramentas e MCPs no chat": o MESMO controle em Configurações e no passo opcional do guia
// (mesma confirmação "Ativar mesmo assim", mesmo efeito). Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  /**
   * `settings`: configurações já lidas; `confirm(messages, label)`: diálogo de confirmação do app; `onChange()`: avisa quem mostra "via …".
   * Devolve o `input` (switch) e `status()`: { on, text, hint } para o estado ("Ligado · 3 MCPs") e a dica do provedor.
   */
  function create({ settings, confirm, onChange, onStatus, id }) {
    const rice = window.rice;
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', id: id || 'chat-tools', checked: settings.chatTools === true, className: 'switch' });
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', t('chat-tools.label'));

    const status = async () => {
      const st = input.checked && rice.aiToolsStatus ? await rice.aiToolsStatus().catch(() => null) : null;
      const count = st && typeof st.servers === 'number' ? st.servers : null;
      const text = !input.checked ? t('chat-tools.state.off') : count === null ? t('chat-tools.state.on') : count === 0 ? t('chat-tools.state.none') : window.RiceI18n.tn('chat-tools.state.count', count);
      return { on: input.checked, text, hint: st && st.hint ? st.hint : '' };
    };

    input.onchange = async () => {
      if (input.checked && !(await confirm([t('chat-tools.warn1'), t('chat-tools.warn2'), t('chat-tools.warn3')], t('chat-tools.confirm')))) {
        input.checked = false;
        return;
      }
      const saved = await rice.setChatTools(input.checked);
      if (saved && saved.ok === false) {
        input.checked = false; // Modo 100% local: o main recusa
        if (onStatus) onStatus({ on: false, text: '', hint: saved.message });
        return;
      }
      if (onChange) onChange();
      if (onStatus) onStatus(await status());
    };
    return { input, status };
  }

  window.RiceChatTools = { create };
})();
