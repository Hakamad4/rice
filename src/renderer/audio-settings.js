// Configurações › Áudio: (1) Microfone — no Windows, seletor "Padrão do Windows (recomendado)" + as entradas; no Mac, a explicação de que vale a entrada
// padrão do macOS; (2) Modelo de transcrição em uso e o motivo (modo leve com pouca memória), com a opção de forçar. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** "Em uso: modelo leve (small; 8 GB de RAM, 4 núcleos)" etc., conforme o motivo que o main informa (vem do plano do transcritor). */
  function usingText(profile) {
    const key = { 'low-ram': 'audio.model.using.low-ram', 'forced-light': 'audio.model.using.forced-light', 'forced-full': 'audio.model.using.forced-full', 'enough-ram': 'audio.model.using.enough-ram', mac: 'audio.model.using.mac', override: 'audio.model.using.override' }[profile && profile.reason];
    return key ? t(key, { ram: profile.ramGb, cores: profile.cores, tier: profile.tier, threads: profile.threads }) : '';
  }

  /** Os nós da seção. `row(label, help, control)` é o do settings.js. */
  function nodes({ rice, settings, row }) {
    const out = [];
    const WIN = rice.platform === 'win32';

    // 1) microfone
    if (WIN && rice.listMicInputs && rice.setMic) {
      const feedback = el('p', { className: 'set-help mic-feedback' }, []);
      const hint = el('p', { className: 'set-help', hidden: true }, []);
      const select = window.RiceMenuSelect.create({
        items: [{ value: '', label: t('audio.mic.default') }],
        value: settings.micDevice || '',
        ariaLabel: t('audio.mic.label'),
        onChoose: async (value) => {
          select.setValue(value);
          const r = await rice.setMic(value).catch(() => null);
          feedback.textContent = r && r.ok ? t('audio.mic.saved') : '';
        },
      });
      const load = async () => {
        const list = await rice.listMicInputs().catch(() => ({ supported: false, inputs: [] }));
        const inputs = Array.isArray(list.inputs) ? list.inputs : [];
        const items = [{ value: '', label: t('audio.mic.default') }, ...inputs.map((i) => ({ value: String(i.id), label: i.isDefault ? `${i.name} (${t('audio.mic.is-default')})` : String(i.name) }))];
        const saved = settings.micDevice || '';
        if (saved && !inputs.some((i) => i.id === saved)) items.push({ value: saved, label: t('audio.mic.missing') }); // o escolhido não está conectado agora
        select.setItems(items, saved);
        hint.hidden = list.supported === true;
        hint.textContent = list.supported === true ? '' : t('audio.mic.no-list');
      };
      load();
      out.push(row(t('audio.mic.label'), t('audio.mic.help'), select.root), feedback, hint);
    } else if (!WIN) {
      // Mac: escolher o microfone sozinho ao gravar (ligado por padrão) e, opcionalmente, um microfone fixo
      const auto = el('input', { type: 'checkbox', id: 'mic-auto', className: 'switch', checked: settings.micAuto !== false }, []);
      auto.setAttribute('role', 'switch');
      auto.setAttribute('aria-label', t('audio.mic.auto.label'));
      auto.onchange = () => { if (rice.setMicAuto) rice.setMicAuto(auto.checked); };
      out.push(row(t('audio.mic.auto.label'), t('audio.mic.auto.help'), auto));
      if (rice.listMicInputs && rice.setMic) {
        const fixed = window.RiceMenuSelect.create({
          items: [{ value: '', label: t('audio.mic.fixed.none') }],
          value: settings.micDevice || '',
          ariaLabel: t('audio.mic.fixed.label'),
          onChoose: (value) => {
            fixed.setValue(value);
            rice.setMic(value).catch(() => {});
          },
        });
        rice.listMicInputs().then((list) => {
          const inputs = Array.isArray(list && list.inputs) ? list.inputs : [];
          const saved = settings.micDevice || '';
          const items = [{ value: '', label: t('audio.mic.fixed.none') }, ...inputs.map((i) => ({ value: String(i.id), label: i.isDefault ? `${i.name} (${t('audio.mic.is-default')})` : String(i.name) }))];
          if (saved && !inputs.some((i) => i.id === saved)) items.push({ value: saved, label: t('audio.mic.missing') });
          fixed.setItems(items, saved);
        }).catch(() => {});
        out.push(row(t('audio.mic.fixed.label'), t('audio.mic.fixed.help'), fixed.root));
      }
    }

    // 2) modelo de transcrição e o motivo; só o Windows deixa escolher (o Mac usa sempre o modelo grande quantizado)
    if (rice.audioProfile) {
      const using = el('p', { className: 'set-help audio-model-using' }, []);
      const note = el('p', { className: 'ai-note-line', hidden: true }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]), el('span', { textContent: t('audio.model.light-note') }, [])]);
      const paint = (p) => {
        using.textContent = usingText(p);
        note.hidden = !(p && p.light);
      };
      if (WIN && rice.setAsrModel) {
        const choice = window.RiceMenuSelect.create({
          items: [{ value: 'auto', label: t('audio.model.auto') }, { value: 'light', label: t('audio.model.light') }, { value: 'full', label: t('audio.model.full') }],
          value: settings.asrModel || 'auto',
          ariaLabel: t('audio.model.label'),
          onChoose: async (value) => {
            choice.setValue(value);
            paint(await rice.setAsrModel(value).catch(() => null));
          },
        });
        rice.audioProfile().then((p) => { if (p) choice.setValue(p.choice); paint(p); }).catch(() => {});
        out.push(row(t('audio.model.label'), t('audio.model.help'), choice.root), using, note);
      } else {
        rice.audioProfile().then(paint).catch(() => {});
        out.push(using);
      }
    }
    return out;
  }

  window.RiceAudioSettings = { nodes, usingText };
})();
