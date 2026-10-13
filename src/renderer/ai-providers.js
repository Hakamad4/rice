// Conectar a IA: cartões (Claude, ChatGPT, Google Gemini, OpenCode); os três primeiros têm "Assinatura" e "Chave de API", o OpenCode só login pelo terminal.
// Só createElement/textContent. A chave digitada vai direto ao main e o campo é limpo; o renderer nunca a recebe de volta.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }
  const p = (text, className) => el('p', { textContent: text, className: className || '' }, []);
  const li = (text) => el('li', { textContent: text }, []);

  function button(text, onclick, className) {
    const b = el('button', { textContent: text, className: className || '' }, []);
    b.onclick = onclick;
    return b;
  }

  const DEFAULT_MODEL = { 'claude-api': 'claude-sonnet-5-5', 'openai-api': 'gpt-5-mini', 'gemini-api': 'gemini-2.5-flash' };
  const API_NAME = { 'claude-api': 'Claude', 'openai-api': 'OpenAI', 'gemini-api': 'Gemini' };
  const PLACEHOLDER = { 'claude-sub': 'sk-ant-oat…', 'claude-api': 'sk-ant-api…', 'openai-api': 'sk-…', 'gemini-api': 'AIza…' };

  const VENDORS = [
    { id: 'claude', name: 'Claude', sub: 'claude-sub', api: 'claude-api' },
    { id: 'chatgpt', name: 'ChatGPT', sub: 'chatgpt-sub', api: 'openai-api' },
    { id: 'gemini', name: 'Google Gemini', sub: null, api: 'gemini-api' },
    { id: 'opencode', name: 'OpenCode', sub: 'opencode-sub', api: null },
    { id: 'agy', name: 'Antigravity', sub: 'agy-sub', api: null },
  ];

  /** Passo a passo de cada aba: texto + comandos (em `code`, com botão de copiar). Os comandos não se traduzem. */
  const STEPS = {
    'claude-sub': [['claude-sub.1', ['claude setup-token']], ['claude-sub.2']],
    'claude-api': [['claude-api.1'], ['claude-api.2']],
    'chatgpt-sub': [['chatgpt-sub.1', ['npm i -g @openai/codex', 'brew install codex']], ['chatgpt-sub.2', ['codex login']], ['chatgpt-sub.3']],
    'openai-api': [['openai-api.1'], ['openai-api.2']],
    'gemini-api': [['gemini-api.1'], ['gemini-api.2']],
    'agy-sub': [['agy-sub.1'], ['agy-sub.2', ['agy']], ['agy-sub.3']],
    'opencode-sub': [['opencode-sub.1', ['curl -fsSL https://opencode.ai/install | bash']], ['opencode-sub.2', ['opencode auth login']], ['opencode-sub.3']],
  };

  // Windows: sem Homebrew nem `curl | bash`; o npm instala os dois (o Claude Code tem instalador próprio, citado no texto do passo)
  if (window.rice && window.rice.platform === 'win32') {
    STEPS['chatgpt-sub'][0] = ['chatgpt-sub.1', ['npm i -g @openai/codex']];
    STEPS['opencode-sub'][0] = ['opencode-sub.1', ['npm i -g opencode-ai']];
  }

  /** Comando em `code` com um botão pequeno de copiar (o ícone muda para ✓ por um instante). */
  function commandLine(command) {
    const copy = el('button', { type: 'button', className: 'cmd-copy', title: t('ai.copy-command') }, [window.RiceIcons.icon('copy')]);
    copy.setAttribute('aria-label', t('ai.copy-command'));
    copy.onclick = async () => {
      try {
        if ((await window.rice.copyText(command)) !== true) return;
        copy.replaceChildren(window.RiceIcons.icon('check'));
        setTimeout(() => copy.replaceChildren(window.RiceIcons.icon('copy')), 1200);
      } catch {
        // sem permissão de área de transferência: o comando continua selecionável
      }
    };
    return el('div', { className: 'cmd-line' }, [el('code', { textContent: command }, []), copy]); // o botão fica DENTRO do bloco, à direita
  }

  function howTo(provider) {
    return (STEPS[provider] || STEPS['gemini-api']).map(([key, commands], i) =>
      el('li', { className: 'ai-step' }, [
        el('span', { className: 'ai-step-n', textContent: String(i + 1) }, []),
        el('div', { className: 'ai-step-body' }, [el('p', { textContent: t(`ai.howto.${key}`) }, []), ...(commands || []).map(commandLine)]),
      ]),
    );
  }

  const FREE_MODEL = 'opencode/big-pickle';
  const isFreeModel = (id) => id === FREE_MODEL || /^opencode\/.*free$/i.test(id || '') || /:free$/i.test(id || '');

  /** Campo com o rótulo ACIMA e controle em largura total (o mesmo molde para chave, token e modelo). */
  function field(label, control) {
    return el('div', { className: 'ai-field' }, [el('label', { className: 'ai-field-label', textContent: label }, []), control]);
  }

  /** Nota discreta com ícone de linha (aviso do modelo gratuito, custo da API). */
  function note(text) {
    return el('p', { className: 'ai-note-line' }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]), el('span', { textContent: text }, [])]);
  }

  /**
   * OpenCode: seletor de modelo (só os provedores autenticados na CLI) e a nota do gratuito logo abaixo, só quando ele está selecionado.
   * A instrução de login existe uma vez só, no passo 2; o estado ("Sem login · usando o gratuito") vai para o rodapé.
   * `onModel(id)` avisa o rodapé quando o modelo muda.
   */
  /** Antigravity: modelos que o próprio `agy models` lista (o padrão do agy fica como "Padrão"). */
  function agyField(info, status, rice) {
    const current = status.models['agy-sub'] || '';
    const itemsOf = (ids) => [{ value: '', label: t('ai.chip.default') }, ...(current && !ids.includes(current) ? [current] : []).concat(ids).map((id) => ({ value: id, label: id }))];
    const picker = window.RiceMenuSelect.create({
      items: itemsOf([]),
      value: current,
      ariaLabel: t('ai.model-label', { name: 'Antigravity' }),
      onChoose: (id) => rice.setAiModel('agy-sub', id),
    });
    if (info.installed) rice.listAiModels('agy-sub').then((r) => r.ok && picker.setItems(itemsOf(r.models), current)).catch(() => {});
    return [field(t('ai.model-title'), picker.root)];
  }

  function opencodeField(info, status, rice, onModel) {
    const current = status.models['opencode-sub'] || '';
    // o gratuito é sempre uma opção explícita e rotulada; o Automático só escolhe entre os autenticados
    const itemsOf = (ids) => {
      const paid = ids.filter((id) => !isFreeModel(id));
      const extra = current && !isFreeModel(current) && !paid.includes(current) ? [current] : [];
      return [{ value: '', label: t('ai.opencode.auto') }, ...[...extra, ...paid].map((id) => ({ value: id, label: id })), { value: FREE_MODEL, label: t('ai.opencode.free') }];
    };
    const warn = note(t('ai.opencode.free-warning'));
    warn.hidden = !isFreeModel(current);
    const picker = window.RiceMenuSelect.create({
      items: itemsOf([]),
      value: current,
      ariaLabel: t('ai.model-label', { name: 'OpenCode' }),
      onChoose: (id) => {
        warn.hidden = !isFreeModel(id);
        onModel(id);
        return rice.setAiModel('opencode-sub', id);
      },
    });
    if (info.installed) rice.listAiModels('opencode-sub').then((r) => r.ok && picker.setItems(itemsOf(r.models), current)).catch(() => {});
    return [field(t('ai.model-title'), picker.root), warn];
  }

  const trimDot = (text) => String(text || '').replace(/[.\s]+$/, '');

  /** Estado do provedor para o rodapé: { tone: ok | warn | bad, text }. */
  function statusLine(provider, info, status, model) {
    if (provider === 'opencode-sub') {
      if (!info.installed) return { tone: 'warn', text: trimDot(info.detail) };
      if (info.loggedIn) return { tone: info.verified === false ? 'bad' : 'ok', text: t('ai.st.connected-model', { model: model || t('ai.opencode.auto') }) };
      return { tone: 'warn', text: isFreeModel(model) ? t('ai.st.opencode-free') : t('ai.st.no-login') };
    }
    const api = provider.endsWith('-api');
    if (info.verified === false && !info.connected) return { tone: 'bad', text: t(api ? 'ai.state.rejected' : 'ai.state.expired') };
    if (info.connected) return { tone: 'ok', text: trimDot(info.detail) || t('ai.state.connected') };
    if (provider === 'claude-sub') return { tone: 'warn', text: t('ai.st.no-token') };
    if ((provider === 'chatgpt-sub' || provider === 'agy-sub') && info.installed) return { tone: 'warn', text: t('ai.st.untested') };
    return { tone: 'warn', text: trimDot(info.detail) || t('ai.state.none') };
  }

  /** Primeiro erro de login visto (no chat, por exemplo): na próxima vez que a lista abrir, o detalhe desse provedor já vem aberto. */
  let pendingOpen = null;
  /** A tela se redesenha depois de cada ação (salvar, testar, usar): o detalhe aberto passa para o desenho seguinte e só para ele. */
  let carry;
  const vendorOf = (provider) => (VENDORS.find((v) => v.sub === provider || v.api === provider) || {}).id || null;
  function markLoginError(provider) {
    pendingOpen = vendorOf(provider);
  }

  /** Estado de uma linha (texto secundário à direita): Ativo, Conectado, Login expirado, Chave recusada ou Não configurado. */
  function vendorState(vendor, status) {
    const infos = [vendor.sub, vendor.api].filter(Boolean);
    if (infos.every((id) => status.providers[id] && status.providers[id].unavailable)) return { key: 'none', text: t('ai.state.unavailable') };
    if (infos.includes(status.active)) return { key: 'active', text: t('ai.state.active') };
    if (infos.some((id) => status.providers[id] && status.providers[id].connected)) return { key: 'connected', text: t('ai.state.connected') };
    const failed = infos.find((id) => status.providers[id] && status.providers[id].verified === false);
    if (failed) return { key: 'failed', text: t(failed === vendor.sub ? 'ai.state.expired' : 'ai.state.rejected') };
    return { key: 'none', text: t('ai.state.none') };
  }

  /**
   * Lista compacta: uma linha por provedor (a IA ativa primeiro) e, ao clicar, o detalhe só daquele (acordeão).
   * `status` vem de `rice.aiStatus()`. `onChange()` roda depois de qualquer mudança (o guia relê o status, o “via …” do chat se atualiza).
   * Nota de segurança uma vez só, no rodapé.
   */
  function render({ status, onChange }) {
    const rice = window.rice;
    const ordered = [...VENDORS].sort((a, b) => Number([b.sub, b.api].includes(status.active)) - Number([a.sub, a.api].includes(status.active)));
    const anyConnected = ordered.some((v) => [v.sub, v.api].some((id) => status.providers[id] && status.providers[id].connected));
    const carried = carry;
    carry = undefined;
    let openId;
    if (carried !== undefined) openId = carried;
    else if (pendingOpen) openId = pendingOpen;
    else openId = anyConnected ? null : ordered[0].id; // nada configurado: o primeiro já abre
    pendingOpen = null;
    const changed = () => {
      carry = openId;
      return onChange();
    };
    const cards = [];

    const setOpen = (id) => {
      openId = id;
      for (const card of cards) {
        const open = card.root.dataset.vendor === id;
        card.root.classList.toggle('open', open);
        card.head.setAttribute('aria-expanded', String(open));
        card.detail.inert = !open;
        card.detail.setAttribute('aria-hidden', String(!open));
      }
    };

    for (const vendor of ordered) {
      let tab = vendor.api && (!vendor.sub || status.active === vendor.api) ? 'api' : 'sub'; // Gemini: só a chave de API, sem abas
      const state = vendorState(vendor, status);
      const root = el('div', { className: 'ai-card' + (state.key === 'active' ? ' active' : '') }, []);
      root.dataset.vendor = vendor.id;
      const head = el('button', { type: 'button', className: 'ai-head' }, [
        el('span', { className: `provider-logo logo-${vendor.id}`, role: 'img', ariaLabel: vendor.name }, []),
        el('strong', { textContent: vendor.name }, []),
        el('span', { className: `ai-card-state state-${state.key}` }, [el('span', { className: 'state-dot' }, []), document.createTextNode(state.text)]),
        el('span', { className: 'ai-chevron' }, [window.RiceIcons.icon('chevron-down')]),
      ]);
      head.setAttribute('aria-controls', `ai-detail-${vendor.id}`);
      const inner = el('div', { className: 'ai-detail-inner' }, []);
      const detail = el('div', { className: 'ai-detail', id: `ai-detail-${vendor.id}`, role: 'region' }, [inner]);
      detail.setAttribute('aria-label', vendor.name);
      root.append(head, detail);
      head.onclick = () => setOpen(openId === vendor.id ? null : vendor.id);
      cards.push({ root, head, detail });

      const draw = () => {
        const provider = tab === 'api' ? vendor.api : vendor.sub;
        const info = status.providers[provider] || { hasKey: false, detail: '' };
        const isActive = status.active === provider;
        if (info.unavailable) {
          inner.replaceChildren(el('div', { className: 'ai-pad' }, [note(info.detail)])); // Antigravity no Windows: só o motivo
          return;
        }
        const hasField = provider !== 'chatgpt-sub' && provider !== 'opencode-sub' && provider !== 'agy-sub';
        let model = status.models[provider] || '';
        const configured = provider === 'opencode-sub' ? Boolean(info.loggedIn) : Boolean(info.connected);

        // 0) abas no topo, com o mesmo recuo do resto
        const blocks = [];
        if (vendor.api && vendor.sub) {
          blocks.push(el('div', { className: 'ai-tabs', role: 'tablist' }, [
            ['sub', t('ai.tab.sub')],
            ['api', t('ai.tab.api')],
          ].map(([key, label]) => {
            const tabButton = button(label, () => {
              tab = key;
              draw();
            }, 'ai-tab' + (tab === key ? ' on' : ''));
            tabButton.setAttribute('role', 'tab');
            tabButton.setAttribute('aria-selected', String(tab === key));
            return tabButton;
          })));
        }

        // 1) passos: inteiros enquanto falta configurar; depois, uma linha discreta "Como configurar" que expande
        const steps = el('ol', { className: 'ai-steps' }, howTo(provider));
        if (configured) {
          blocks.push(el('details', { className: 'ai-fold' }, [el('summary', { textContent: t('ai.howto-title') }, []), steps]));
        } else {
          blocks.push(steps);
        }

        // 2) campos: rótulo acima, largura total
        const feedback = el('div', { className: 'feedback ai-status', role: 'status' }, []);
        const dot = el('span', { className: 'state-dot' }, []);
        const statusText = el('span', { className: 'ai-status-text' }, []);
        feedback.append(dot, statusText);
        const showStatus = (line) => {
          dot.className = `state-dot tone-${line.tone}`;
          statusText.textContent = line.text;
        };
        const say = (text, ok) => showStatus({ tone: ok ? 'ok' : 'bad', text });
        showStatus(statusLine(provider, info, status, model));

        if (hasField) {
          const input = el('input', { type: 'password', placeholder: PLACEHOLDER[provider], autocomplete: 'off', spellcheck: false, className: 'ai-key' }, []);
          input.setAttribute('aria-label', t('ai.key-label', { name: vendor.name }));
          const save = button(t('ai.save'), async () => {
            const result = await rice.saveAiKey(provider, input.value);
            input.value = ''; // o valor digitado não fica no renderer
            if (!result.ok) return say(result.message, false);
            await changed();
          }, 'primary');
          blocks.push(field(t('ai.key-label', { name: vendor.name }), el('div', { className: 'ai-input-row' }, [input, save])));
        }
        if (tab === 'api') {
          const current = status.models[provider] || DEFAULT_MODEL[provider];
          const itemsOf = (ids) => (ids.includes(current) ? ids : [current, ...ids]).map((id) => ({ value: id, label: id === DEFAULT_MODEL[provider] ? t('ai.default-suffix', { id }) : id }));
          const picker = window.RiceMenuSelect.create({
            items: itemsOf([DEFAULT_MODEL[provider]]),
            value: current,
            ariaLabel: t('ai.model-label', { name: API_NAME[provider] }),
            onChoose: (id) => rice.setAiModel(provider, id === DEFAULT_MODEL[provider] ? '' : id),
          });
          if (info.hasKey) rice.listAiModels(provider).then((r) => r.ok && r.models.length > 0 && picker.setItems(itemsOf(r.models), current)).catch(() => {});
          blocks.push(field(t('ai.model-title'), picker.root));
          blocks.push(note(t('ai.cost-warning')));
        }
        if (provider === 'agy-sub') {
          blocks.push(...agyField(info, status, rice));
          blocks.push(note(t('ai.agy.sandbox-note')));
        }
        if (provider === 'opencode-sub') {
          blocks.push(...opencodeField(info, status, rice, (id) => {
            model = id;
            showStatus(statusLine(provider, info, status, model));
          }));
        }

        // 3) rodapé: estado à esquerda; Testar conexão (secundário) e Usar este (primário, só se não for o ativo) à direita
        const actions = [];
        if (hasField && info.hasKey) {
          actions.push(button(t('ai.remove'), async () => {
            await rice.clearAiKey(provider);
            await changed();
          }, 'ghost'));
        }
        const test = button(t('ai.test'), async () => {
          test.disabled = true;
          say(t('ai.testing'), true);
          const result = await rice.testAi(provider);
          test.disabled = false;
          say(result.message, result.ok);
          if (result.ok) await changed();
        }, 'secondary');
        actions.push(test);
        if (!isActive) {
          actions.push(button(t('ai.use'), async () => {
            await rice.setAiProvider(provider);
            await changed();
          }, 'primary ai-use'));
        }
        blocks.push(el('div', { className: 'ai-foot' }, [feedback, el('div', { className: 'ai-actions' }, actions)]));
        inner.replaceChildren(el('div', { className: 'ai-pad' }, blocks));
      };
      draw();
    }
    setOpen(openId);
    // aviso de uma vez só (o main o apaga depois que a tela o mostra): o Gemini por assinatura foi descontinuado
    const notice = [];
    if (status.notice === 'gemini-discontinued') {
      notice.push(el('p', { className: 'ai-note-line ai-migrated', role: 'status' }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]), el('span', { textContent: t('ai.notice.gemini-discontinued') }, [])]));
      if (rice.dismissAiNotice) rice.dismissAiNotice();
    }
    return el('div', { className: 'ai-cards' }, [...notice, ...cards.map((c) => c.root), p(t('ai.keychain-note'), 'hint ai-note')]);
  }

  const VIA = { 'claude-sub': ['claude', 'Claude'], 'claude-api': ['claude', 'Claude (API)'], 'chatgpt-sub': ['chatgpt', 'ChatGPT'], 'openai-api': ['chatgpt', 'ChatGPT (API)'], 'gemini-api': ['gemini', 'Gemini (API)'], 'opencode-sub': ['opencode', 'OpenCode'], 'agy-sub': ['agy', 'Antigravity'] };

  /** Indicador discreto “via ChatGPT” (com o logo pequeno) para perto do chat. */
  function updateVia(node, active) {
    const [vendor, label] = VIA[active] || VIA['claude-sub'];
    node.replaceChildren(el('span', { className: `provider-logo small logo-${vendor}`, ariaHidden: 'true' }, []), document.createTextNode(t('ai.via', { label })));
    node.dataset.provider = active;
  }

  const label = (active) => (VIA[active] || VIA['claude-sub'])[1];

  window.RiceAiProviders = { commandLine, render, updateVia, label, markLoginError, VENDORS };
})();
