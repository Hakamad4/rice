// Perguntas prontas do chat: um botão de ícone dentro do campo "Pergunte…" que abre um menu acima dele com as padrão e as salvas.
// As do usuário (até 8, `settings.savedPrompts`): "Salvar a última pergunta", "Adicionar pergunta pronta…" e "Remover pergunta salva" (submenu).
// Só createElement/textContent; o texto das perguntas nunca passa por innerHTML.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const MAX = 8;
  const MAX_LENGTH = 300;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const short = (text) => (text.length > 44 ? `${text.slice(0, 43)}…` : text);

  /**
   * `button`: o botão do campo; `defaults()`: [{ label, prompt }] do chat atual; `saved`: lista inicial das salvas;
   * `persist(list)`: grava e devolve a lista normalizada; `onSend(prompt)`: envia; `canSend()`: dá para enviar agora?;
   * `lastQuestion()`: a última pergunta enviada neste chat ('' se não houver).
   */
  function create({ button, defaults, saved, persist, onSend, canSend, lastQuestion }) {
    let list = Array.isArray(saved) ? saved.slice(0, MAX) : [];

    const canSave = (text) => {
      const value = String(text || '').trim();
      if (!value) return { ok: false, reason: t('chat.prompts.no-last') };
      if (list.some((p) => same(p, value))) return { ok: false, reason: t('chat.prompts.saved') };
      if (list.length >= MAX) return { ok: false, reason: t('chat.prompts.full', { n: MAX }) };
      return { ok: true, reason: '' };
    };

    async function save(text) {
      if (!canSave(text).ok) return false;
      list = await persist([...list, String(text).trim().slice(0, MAX_LENGTH)]);
      return true;
    }

    async function remove(text) {
      list = await persist(list.filter((p) => p !== text));
    }

    function openAdd() {
      window.RiceDialog.open(t('chat.prompts.add'), (box, close) => {
        const input = el('input', { type: 'text', maxLength: MAX_LENGTH, placeholder: t('chat.prompts.placeholder'), autocomplete: 'off' }, []);
        box.body.append(window.RiceDialog.field(t('chat.prompts.field'), input));
        const ok = window.RiceDialog.button(t('chat.prompts.save-button'), 'primary', async () => {
          if (await save(input.value)) close();
        });
        ok.disabled = true;
        input.addEventListener('input', () => (ok.disabled = !canSave(input.value).ok));
        box.foot.append(window.RiceDialog.button(t('common.cancel'), 'ghost', close), ok);
      }, { title: t('chat.prompts.add'), enterConfirms: true });
    }

    function items() {
      const sendable = canSend();
      const send = (prompt) => ({ onSelect: () => onSend(prompt), disabled: !sendable });
      const last = canSave(lastQuestion());
      const full = list.length >= MAX;
      return [
        ...defaults().map((d) => ({ label: d.label, icon: 'message-circle', title: d.prompt, ...send(d.prompt) })),
        ...(list.length > 0 ? [{ separator: true }, { heading: t('chat.prompts.yours') }, ...list.map((p) => ({ label: short(p), icon: 'message-circle', title: p, ...send(p) }))] : []),
        { separator: true },
        { label: t('chat.prompts.save-last'), icon: 'plus', disabled: !last.ok, ...(last.reason ? { title: last.reason } : {}), onSelect: () => save(lastQuestion()) },
        { label: t('chat.prompts.add-item'), icon: 'plus', disabled: full, ...(full ? { title: t('chat.prompts.full', { n: MAX }) } : {}), onSelect: openAdd },
        ...(list.length > 0 ? [{ label: t('chat.prompts.remove-saved'), icon: 'trash', submenu: list.map((p) => ({ label: short(p), title: p, danger: true, onSelect: () => remove(p) })) }] : []),
      ];
    }

    button.addEventListener('click', () => window.RiceActionMenu.open({ anchor: button, placement: 'above', items: items() }));

    return { set(next) { list = Array.isArray(next) ? next.slice(0, MAX) : []; }, save, remove, canSave, list: () => list.slice(), items };
  }

  window.RicePromptsMenu = { create, MAX };
})();
