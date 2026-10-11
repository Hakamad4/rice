// Chip "Claude · Sonnet" do cabeçalho do chat (reunião e "Todas as reuniões"): abre o menu para trocar a IA e o modelo.
// A escolha vale para o app inteiro (a mesma configuração de Configurações > IA), na próxima pergunta e nas próximas notas.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Ordem do menu: o ativo primeiro; depois os demais configurados na ordem de VENDORS (sub antes de api). */
  const FAMILY = [[/opus/i, 'Opus'], [/sonnet/i, 'Sonnet'], [/haiku/i, 'Haiku'], [/gemini.*pro/i, 'Pro'], [/gemini.*flash/i, 'Flash']];
  const DEFAULT_MODEL = { 'claude-api': 'claude-sonnet-5-5', 'openai-api': 'gpt-5-mini', 'gemini-api': 'gemini-2.5-flash' };

  /** Nome curto do modelo para o chip: família (Opus, Sonnet, Pro, Flash) ou o próprio id; sem escolha, o padrão. */
  function shortModel(provider, model) {
    const id = model || DEFAULT_MODEL[provider] || '';
    if (!id) return provider === 'opencode-sub' ? t('ai.opencode.auto') : t('ai.chip.default');
    if (provider === 'opencode-sub' && /^opencode\/.*free$|^opencode\/big-pickle$|:free$/.test(id)) return t('ai.chip.free');
    for (const [re, name] of FAMILY) if (re.test(id)) return name;
    return id;
  }

  /** Nome completo (tooltip): o do menu, sem abreviar. */
  function fullModel(provider, model) {
    if (provider === 'opencode-sub' && /^opencode\/.*free$|^opencode\/big-pickle$|:free$/.test(model || '')) return t('ai.opencode.free');
    return model ? model : shortModel(provider, model);
  }

  function vendorOf(provider) {
    return window.RiceAiProviders.VENDORS.find((v) => v.sub === provider || v.api === provider);
  }

  const isConfigured = (status, id) => {
    const info = status.providers[id];
    return Boolean(info && (id === 'opencode-sub' ? info.loggedIn || info.connected : info.connected));
  };

  /** Nome curto do modelo leve para a linha "Leve: Haiku" (claude-haiku-5-5 → Haiku). */
  const lightName = (id) => {
    const m = /(haiku|mini|flash|sonnet|opus)/i.exec(id);
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : id;
  };

  /** Rótulo do item de modelo no menu: o padrão do provedor fica "Padrão"; o resto vem do catálogo. */
  const modelLabel = (m) => (m.id === '' ? t('ai.chip.default') : m.id === 'opencode/big-pickle' ? t('ai.opencode.free') : m.label);

  /**
   * `deps`: { rice, node (o botão), onConfigure(), isBusy() }. `refresh()` relê o status e redesenha o chip.
   * Devolve { refresh, setBusy }.
   */
  function create({ rice, node, onConfigure, onSettings }) {
    let status = null;
    let busy = false;
    let toolsOn = false;

    const paint = () => {
      if (!status) return node.replaceChildren();
      const active = status.active;
      const vendor = vendorOf(active) || window.RiceAiProviders.VENDORS[0];
      node.replaceChildren(
        el('span', { className: `provider-logo small logo-${vendor.id}`, ariaHidden: 'true' }, []),
        el('span', { className: 'ai-chip-text', textContent: `${window.RiceAiProviders.label(active)} · ${shortModel(active, status.models[active])}` }, []),
        ...(toolsOn ? [el('span', { className: 'tools-on', title: t('chat-tools.chip'), ariaLabel: t('chat-tools.chip') }, [window.RiceIcons.icon('plug')])] : []),
        window.RiceIcons.icon('chevron-down'),
      );
      node.dataset.provider = active;
      node.disabled = busy;
      const full = `${window.RiceAiProviders.label(active)} · ${fullModel(active, status.models[active])}`;
      node.title = busy ? t('ai.chip.busy') : `${full} — ${t('ai.chip.title')}${toolsOn ? ` · ${t('chat-tools.chip')}` : ''}`;
      node.setAttribute('aria-label', `${t('ai.chip.title')}: ${full}`);
    };

    async function refresh() {
      try {
        const raw = await rice.aiStatus();
        status = { ...raw, models: raw.models || {}, providers: raw.providers || {} };
      } catch {
        status = null;
      }
      try {
        const tools = rice.aiToolsStatus ? await rice.aiToolsStatus() : null;
        toolsOn = Boolean(tools && tools.on && tools.available);
      } catch {
        toolsOn = false;
      }
      paint();
    }

    function setBusy(on) {
      busy = on;
      if (on && window.RiceActionMenu) window.RiceActionMenu.close();
      paint();
    }

    async function choose(provider, model) {
      await rice.setAiProvider(provider);
      const saved = status.models[provider] || '';
      if (saved !== model) await rice.setAiModel(provider, model);
      window.dispatchEvent(new CustomEvent('rice:ai-changed'));
      await refresh();
    }

    async function open() {
      if (busy || !status) return;
      const live = status;
      const all = window.RiceAiProviders.VENDORS.flatMap((v) => [v.sub, v.api]).filter(Boolean);
      const configured = all.filter((id) => isConfigured(live, id)).sort((a, b) => Number(b === live.active) - Number(a === live.active));
      const catalogs = await Promise.all(configured.map((id) => rice.aiModelCatalog(id).then((r) => (r && r.ok ? r.models : [])).catch(() => [])));
      const items = [{ note: t('ai.chip.note') }];
      configured.forEach((id, i) => {
        items.push({ header: window.RiceAiProviders.label(id) });
        const current = live.models[id] || '';
        const known = catalogs[i];
        // um modelo salvo que o catálogo não conhece (ex.: escolhido em Configurações) continua aparecendo, marcado
        const extra = current && !known.some((m) => m.id === current) ? [{ id: current, label: current }] : [];
        for (const m of [...extra, ...known]) {
          const effective = m.id === '' ? current === '' && id !== 'claude-api' && id !== 'openai-api' && id !== 'gemini-api' : current === m.id || (current === '' && DEFAULT_MODEL[id] === m.id);
          items.push({ label: modelLabel(m), checked: id === live.active && effective, onSelect: () => choose(id, m.id) });
        }
      });
      const selected = live.models[live.active] || '';
      if (live.active === 'opencode-sub' && /^opencode\/.*free$|^opencode\/big-pickle$|:free$/.test(selected)) items.push({ note: t('ai.opencode.free-warning') });
      if (live.lightModel && onSettings) items.push({ separator: true }, { label: t('ai.chip.light', { model: lightName(live.lightModel) }), muted: true, onSelect: onSettings });
      const missing = window.RiceAiProviders.VENDORS.filter((v) => ![v.sub, v.api].some((id) => id && isConfigured(live, id)));
      if (missing.length > 0) {
        items.push({ separator: true });
        for (const v of missing) items.push({ label: v.name, hint: t('ai.chip.configure'), muted: true, onSelect: onConfigure });
      }
      window.RiceActionMenu.open({ anchor: node, items });
    }

    node.onclick = open;
    return { refresh, setBusy };
  }

  window.RiceAiChip = { create, shortModel };
})();
