// Passo "Agenda" do guia: duas opções em acordeão, no mesmo molde dos provedores de IA.
// (1) Calendário do macOS (recomendado: conta Google em Contas de Internet + acesso do EventKit) e (2) Google direto (avançado, recolhido).
// Só createElement/textContent; o Client secret digitado vai direto ao main e o campo é limpo.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  function button(text, onclick, className) {
    const b = el('button', { type: 'button', textContent: text, className: `btn ${className || 'ghost'}` }, []);
    b.onclick = onclick;
    return b;
  }

  /** Texto com `trechos` entre crases em <code> (URLs e nomes de API não se traduzem). */
  function rich(text) {
    const p = el('p', {}, []);
    text.split('`').forEach((part, i) => p.append(i % 2 ? el('code', { textContent: part }, []) : document.createTextNode(part)));
    return p;
  }

  function field(label, control) {
    return el('div', { className: 'ai-field' }, [el('label', { className: 'ai-field-label', textContent: label }, []), control]);
  }

  function status(tone, text) {
    return el('p', { className: 'ai-status' }, [el('span', { className: `state-dot tone-${tone}` }, []), document.createTextNode(text)]);
  }

  let carry; // qual opção estava aberta antes de reler o status

  /** Estado do passo para o título: { done, text }. */
  function summary({ google, eventKit }) {
    if (google && google.connected) return { done: true, text: t('guide.cal.state.google') };
    if (eventKit && eventKit.access === 'granted') return { done: true, text: t('guide.cal.state.macos') };
    return { done: false, text: t('guide.optional') };
  }

  function render({ google, eventKit, onChange }) {
    const rice = window.rice;
    google = google || {};
    const access = (eventKit && eventKit.access) || 'unknown';
    const noSystem = access === 'unsupported'; // Windows: sem Calendário do sistema, a agenda é só o Google
    let openId = carry !== undefined ? carry : noSystem ? 'google' : 'macos';
    carry = undefined;
    const cards = [];

    const setOpen = (id) => {
      openId = id;
      for (const card of cards) {
        const open = card.root.dataset.option === id;
        card.root.classList.toggle('open', open);
        card.head.setAttribute('aria-expanded', String(open));
        card.detail.inert = !open;
        card.detail.setAttribute('aria-hidden', String(!open));
      }
    };
    const changed = () => {
      carry = openId;
      return onChange();
    };

    const card = (id, title, stateText, active, blocks) => {
      const root = el('div', { className: 'ai-card' + (active ? ' active' : '') }, []);
      root.dataset.option = id;
      const head = el('button', { type: 'button', className: 'ai-head' }, [
        el('span', { className: 'cal-ico' }, [window.RiceIcons.icon(id === 'macos' ? 'calendar' : 'globe')]),
        el('strong', { textContent: title }, []),
        el('span', { className: `ai-card-state${active ? ' state-active' : ''}` }, [el('span', { className: 'state-dot' }, []), document.createTextNode(stateText)]),
        el('span', { className: 'ai-chevron' }, [window.RiceIcons.icon('chevron-down')]),
      ]);
      head.setAttribute('aria-controls', `cal-detail-${id}`);
      const detail = el('div', { className: 'ai-detail', id: `cal-detail-${id}`, role: 'region' }, [el('div', { className: 'ai-detail-inner' }, [el('div', { className: 'ai-pad' }, blocks)])]);
      detail.setAttribute('aria-label', title);
      root.append(head, detail);
      head.onclick = () => setOpen(openId === id ? null : id);
      cards.push({ root, head, detail });
      return root;
    };

    // 1) Calendário do macOS: uma linha de explicação, status real do acesso e as ações no rodapé
    const macStatus = {
      granted: ['ok', t('guide.cal.mac.granted')],
      denied: ['bad', t('guide.cal.mac.denied')],
      notDetermined: ['warn', t('guide.cal.mac.undetermined')],
      unknown: ['warn', t('guide.cal.mac.unknown')],
    }[access] || ['warn', t('guide.cal.mac.unknown')];
    const macActions = [button(t('guide.cal.mac.accounts'), () => rice.openInternetAccounts())];
    if (access === 'notDetermined') {
      const allow = button(t('guide.cal.mac.allow'), async () => {
        allow.disabled = true;
        await rice.eventKitRequest();
        for (let i = 0; i < 30 && allow.isConnected; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const now = await rice.eventKitStatus();
          if (now.access !== 'notDetermined') break;
        }
        if (allow.isConnected) await changed();
      }, 'primary');
      macActions.push(allow);
    } else if (access === 'denied') {
      macActions.push(button(t('guide.cal.mac.open-privacy'), () => rice.openCalendarPrivacy(), 'primary'));
    }
    const mac = noSystem ? null : card('macos', t('guide.cal.mac.title'), access === 'granted' ? t('guide.cal.on') : '', access === 'granted', [
      el('p', { className: 'ai-lead', textContent: t('guide.cal.mac.text') }, []),
      el('div', { className: 'ai-foot' }, [status(macStatus[0], macStatus[1]), el('div', { className: 'ai-actions' }, macActions)]),
    ]);

    // 2) Google direto: passos curtos, campos com rótulo acima, rodapé com status e "Conectar"
    const gId = el('input', { type: 'text', placeholder: t('guide.cal.google.id-ph'), autocomplete: 'off', spellcheck: false, id: 'google-client-id' }, []);
    const gSecret = el('input', { type: 'password', placeholder: t('guide.cal.google.secret-ph'), autocomplete: 'off', spellcheck: false, id: 'google-client-secret' }, []);
    const feedback = el('div', { className: 'feedback', id: 'google-feedback' }, []);
    const say = (text, ok) => {
      feedback.textContent = text;
      feedback.className = 'feedback ' + (ok ? 'ok' : 'bad');
    };
    const connect = button(t('guide.cal.google.connect'), async () => {
      connect.disabled = true;
      if (gId.value || gSecret.value) {
        const saved = await rice.googleSaveClient(gId.value, gSecret.value);
        if (!saved.ok) {
          connect.disabled = false;
          return say(saved.message, false);
        }
        gId.value = '';
        gSecret.value = '';
      }
      say(t('guide.gcal.continue'), true);
      const result = await rice.googleConnect();
      if (!result.ok) {
        connect.disabled = false;
        return say(result.message, false);
      }
      await changed();
    }, 'primary');
    const disconnect = button(t('guide.gcal.disconnect'), async () => {
      await rice.googleDisconnect();
      await changed();
    });
    disconnect.hidden = !google.connected && !google.hasClient;
    const statusText = google.connected ? window.RiceI18n.tn('guide.gcal.connected', google.calendars || 0) : google.hasClient ? t('guide.cal.google.saved') : t('guide.cal.google.none');
    const gBlocks = [
      el('ol', { className: 'ai-steps' }, [1, 2, 3, 4].map((n) =>
        el('li', { className: 'ai-step' }, [el('span', { className: 'ai-step-n', textContent: String(n) }, []), el('div', { className: 'ai-step-body' }, [rich(t(`guide.cal.google.${n}`))])]),
      )),
      field(t('guide.cal.google.id'), gId),
      field(t('guide.cal.google.secret'), gSecret),
      feedback,
    ];
    if (google.blocked) {
      connect.disabled = true; // Modo 100% local: o Google Agenda usa a internet
      connect.title = google.blocked;
      gBlocks.splice(gBlocks.length - 1, 0, el('p', { className: 'ai-note-line' }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]), el('span', { textContent: google.blocked }, [])]));
    }
    if (google.error) gBlocks.push(el('p', { className: 'hint', textContent: t('guide.gcal.last-error', { error: google.error }) }, []));
    gBlocks.push(el('div', { className: 'ai-foot' }, [status(google.connected ? 'ok' : google.hasClient ? 'warn' : 'none', statusText), el('div', { className: 'ai-actions' }, [disconnect, connect])]));
    const direct = card('google', t('guide.cal.google.title'), google.connected ? t('guide.cal.on') : '', Boolean(google.connected), gBlocks);

    setOpen(openId);
    return [el('div', { className: 'ai-cards' }, noSystem ? [direct] : [mac, direct]), el('p', { className: 'hint ai-note', textContent: t('guide.cal.privacy') }, [])];
  }

  window.RiceCalendarConnect = { render, summary };
})();
