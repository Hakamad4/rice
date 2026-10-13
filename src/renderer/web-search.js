// "Buscar na web" no chat: interruptor por conversa (desligado por padrão, nunca liga sozinho) e as fontes da resposta.
// Só createElement/textContent: nem o texto da IA nem o da web passa por innerHTML. Links abrem no navegador via `rice.openLink`.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const NOTE_KEY = 'rice.webNoteSeen';

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Só https, sem usuário/senha; devolve a URL ou null. */
  function safeUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 2048 || /\s/.test(raw)) return null;
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') ? u.href : null;
    } catch {
      return null;
    }
  }

  const domainOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  /** "Fontes da web: título · domínio …", discreto, como a linha de citações das reuniões. Fonte com URL inválida nem entra. */
  function sourcesBox(sources, onOpen) {
    const list = (Array.isArray(sources) ? sources : []).flatMap((s) => {
      const url = s && safeUrl(s.url);
      return url ? [{ url, title: typeof s.title === 'string' ? s.title : '' }] : [];
    });
    if (list.length === 0) return null;
    const box = el('div', { className: 'sources web-sources' }, [el('span', { className: 'sources-label', textContent: t('chat.web.sources') }, [])]);
    for (const s of list) {
      const domain = domainOf(s.url);
      const b = el('button', { type: 'button', className: 'source-link web-source' }, [
        el('span', { className: 'web-source-title', textContent: !s.title || s.title.replace(/^www\./i, '') === domain ? domain : s.title }, []),
        ...(s.title && s.title.replace(/^www\./i, '') !== domain ? [el('span', { className: 'web-source-domain', textContent: ` · ${domain}` }, [])] : []),
      ]);
      b.title = t('chat.web.open', { domain });
      b.onclick = () => onOpen(s.url);
      box.append(b);
    }
    return box;
  }

  const seen = () => {
    try {
      return localStorage.getItem(NOTE_KEY) === '1';
    } catch {
      return false;
    }
  };
  const markSeen = () => {
    try {
      localStorage.setItem(NOTE_KEY, '1');
    } catch {
      // sem armazenamento: o aviso volta na próxima vez
    }
  };

  /**
   * `button`: o interruptor do cabeçalho do chat; `note`: caixa do aviso da primeira vez; `keyOf()`: id da conversa atual
   * (a reunião aberta ou "global"; null = sem conversa); `status()`: { available, hint? } do provedor ativo.
   * O estado vive só na memória da janela e por conversa: abrir outra reunião mostra o dela, desligado se nunca ligou.
   */
  function create({ button, note, keyOf, status }) {
    const on = new Set();
    let support = { available: true, hint: '' };

    const isOn = () => {
      const key = keyOf();
      return support.available && key !== null && on.has(key);
    };

    function paint() {
      const active = isOn();
      button.replaceChildren(window.RiceIcons.icon('globe'), ...(active ? [el('span', { className: 'web-chip-text', textContent: t('chat.web.chip') }, [])] : []));
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !support.available;
      const label = !support.available ? `${t('chat.web.label')}: ${support.hint}` : active ? t('chat.web.title-on') : t('chat.web.title-off');
      button.title = label;
      button.setAttribute('aria-label', !support.available ? label : t('chat.web.label'));
      if (!active || !support.available) note.hidden = true;
    }

    async function refreshSupport() {
      try {
        const s = await status();
        support = { available: s.available === true, hint: s.hint || '' };
      } catch {
        support = { available: false, hint: t('chat.web.unavailable') };
      }
      paint();
    }

    function toggle() {
      const key = keyOf();
      if (key === null || !support.available) return;
      if (on.has(key)) on.delete(key);
      else {
        on.add(key);
        if (!seen()) {
          note.hidden = false;
          markSeen();
        }
      }
      paint();
    }

    button.addEventListener('click', toggle);
    note.querySelector('button')?.addEventListener('click', () => {
      note.hidden = true;
    });

    return {
      isOn,
      paint,
      refreshSupport,
      /** Nova conversa (ou conversa apagada): volta a desligado. */
      reset(key) {
        on.delete(key);
        paint();
      },
    };
  }

  window.RiceWebSearch = { create, sourcesBox, safeUrl, domainOf };
})();
