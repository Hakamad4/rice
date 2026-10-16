// Configurações › Atualizações (Mac e Windows): cartão de versão (selo de estado + UMA ação), linha da opção automática e detalhes técnicos recolhidos.
// Só createElement/textContent. O main decide o que consultar; aqui só o estado e os textos (datas relativas no idioma do app).
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const MIN_GAP_MS = 10000; // mesmo intervalo mínimo do main: o botão fica desabilitado até lá
  const DAY_MS = 24 * 60 * 60 * 1000;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  /** "hoje" / "ontem" / "amanhã" / "13 de outubro" (October 13) para o dia de `date`, contado em dias do calendário local. */
  function dayText(date, now) {
    const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
    if (diff === 0) return t('updatenow.day.today');
    if (diff === -1) return t('updatenow.day.yesterday');
    if (diff === 1) return t('updatenow.day.tomorrow');
    const loc = window.RiceI18n.locale();
    const opts = date.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
    return new Intl.DateTimeFormat(loc, opts).format(date);
  }

  /** "hoje às 14:32" / "ontem às 09:05" / "13 de outubro às 18:00". */
  function whenText(iso, now) {
    const date = new Date(iso);
    const time = new Intl.DateTimeFormat(window.RiceI18n.locale(), { hour: '2-digit', minute: '2-digit' }).format(date);
    return t('updatenow.when', { day: dayText(date, now), time });
  }

  const SHA = /^[0-9a-f]{7}$/i;
  const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

  /** "Última verificação: hoje às 09:41" (ou "Ainda não verificou"). */
  function lastText(lastCheckAt, now) {
    const last = lastCheckAt && !Number.isNaN(Date.parse(lastCheckAt)) ? lastCheckAt : null;
    return last ? t('updatenow.last', { when: whenText(last, now) }) : t('updatenow.never');
  }

  /** Caminho longo cortado no meio (uma linha, sem quebrar palavra); o completo vai no tooltip. */
  function middle(text, max) {
    if (text.length <= max) return text;
    const head = Math.ceil((max - 1) * 0.4);
    return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
  }

  /**
   * O que o cartão mostra, a partir do estado (função pura, testada):
   * { kind, badge, tone, sub, action, help, percent, error }.
   * kind: local | checking | downloading | ready | available | offline | failed | latest | unknown.
   * action: { id: 'check'|'run'|'download'|'install', label, primary, disabled }.
   */
  function view(s) {
    const win = s.win && s.win.supported ? s.win : null;
    const status = s.status || {};
    const version = VERSION.test(String(win && win.version)) ? win.version : '';
    const macAvailable = !win && Boolean(status.available) && SHA.test(String(status.from)) && SHA.test(String(status.to));
    const check = { id: 'check', label: t('updatenow.button'), primary: false, disabled: Boolean(s.busy || s.cooling || s.local) };
    const v = { kind: 'latest', badge: t('updatepage.state.latest'), tone: 'ok', sub: '', action: check, help: '', percent: null, error: '' };
    if (s.local) return { ...v, kind: 'local', badge: t('updatepage.state.local'), tone: 'muted', help: t('local.mode.blocked.updates') };
    if (s.busy) return { ...v, kind: 'checking', badge: t('updatepage.state.checking'), tone: 'muted' };
    if (win && win.phase === 'downloading') {
      const percent = Math.max(0, Math.min(100, Number(win.percent) || 0));
      return { ...v, kind: 'downloading', badge: t('updatepage.state.downloading', { percent }), tone: 'accent', sub: t('winupdate.available', { version }), action: null, percent };
    }
    if (win && win.phase === 'downloaded') return { ...v, kind: 'ready', badge: t('updatepage.state.ready'), tone: 'accent', sub: t('winupdate.available', { version }), action: { id: 'install', label: t('winupdate.restart'), primary: true }, help: win.waitingForRecording ? t('winupdate.waiting') : t('winupdate.restart-help') };
    if (win && win.phase === 'available') return { ...v, kind: 'available', badge: t('updatepage.state.available'), tone: 'accent', sub: t('winupdate.available', { version }), action: { id: 'download', label: t('winupdate.download'), primary: true }, help: t('winupdate.help'), error: win.error ? t('winupdate.error', { message: win.error }) : '' };
    if (macAvailable) return { ...v, kind: 'available', badge: t('updatepage.state.available'), tone: 'accent', sub: `${t('updatepage.commit', { commit: status.from })} → ${status.to}`, action: { id: 'run', label: status.fromClone ? t('update.banner.now') : t('update.download'), primary: true }, help: status.fromClone ? t('updatepage.run-help') : t('update.download-help') };
    const r = s.result;
    if (r && r.phase === 'error') {
      const network = r.error === 'network' || !r.message;
      return { ...v, kind: network ? 'offline' : 'failed', badge: t(network ? 'updatepage.state.offline' : 'updatepage.state.failed'), tone: 'warn', help: network ? t('updatenow.error.network') : t('updatenow.error.other', { message: String(r.message).slice(0, 160) }) };
    }
    if (win && win.error) return { ...v, kind: 'failed', badge: t('updatepage.state.failed'), tone: 'warn', help: t('winupdate.error', { message: win.error }) };
    if (!s.lastCheckAt) return { ...v, kind: 'unknown', badge: t('updatepage.state.unknown'), tone: 'muted' };
    return v;
  }

  /**
   * `api`: { checkNow, lastCheck, updateStatus, about, winStatus, run, download, install, dismiss? } (preload).
   * `opts`: { platform, local, autoRow (a linha da opção automática, do settings.js), autoToggle, now }.
   * Devolve { node, setVersion }; ouve rice:update-changed e rice:winupdate-changed (e sai quando a tela é refeita).
   */
  function create(api, opts) {
    const now = () => (opts.now ? opts.now() : new Date());
    const state = { status: null, win: null, about: null, lastCheckAt: null, busy: false, cooling: false, result: null, local: Boolean(opts.local) };

    const badge = el('span', { className: 'upd-badge' }, []);
    const title = el('span', { className: 'upd-title-text' }, []);
    const sub = el('div', { className: 'upd-sub' }, []);
    const act = el('div', { className: 'upd-act' }, []);
    const bar = el('progress', { className: 'upd-bar', max: 100, hidden: true }, []);
    const help = el('p', { className: 'set-help upd-help' }, []);
    const last = el('p', { className: 'set-help upd-last' }, []);
    const card = el('div', { className: 'upd-card' }, [
      el('div', { className: 'upd-top' }, [el('div', { className: 'upd-id' }, [el('div', { className: 'upd-title' }, [title, badge]), sub]), act]),
      bar, help, last,
    ]);
    card.setAttribute('role', 'status');

    const pathLine = el('div', { className: 'upd-path' }, []);
    const commitLine = el('div', { className: 'upd-mono' }, []);
    const howLine = el('p', { className: 'set-help upd-how' }, []);
    const fold = el('details', { className: 'ai-fold upd-fold' }, [
      el('summary', { textContent: t('updatepage.details') }, []),
      el('div', { className: 'upd-detail' }, [el('span', { className: 'set-label', textContent: t('updatepage.path') }, []), pathLine]),
      el('div', { className: 'upd-detail' }, [el('span', { className: 'set-label', textContent: t('updatepage.commit-full') }, []), commitLine]),
      el('div', { className: 'upd-detail' }, [el('span', { className: 'set-label', textContent: t('updatepage.how') }, []), howLine]),
    ]);
    const node = el('div', { className: 'upd-page' }, [card, opts.autoRow, fold]);

    const actions = {
      check: () => runCheck(),
      run: () => api.run && api.run(),
      download: async () => { if (api.download) { state.win = await api.download(); paint(); } },
      install: async () => { if (api.install) await api.install(); },
    };

    function paint() {
      const v = view({ ...state, status: state.status });
      const about = state.about || {};
      card.dataset.kind = v.kind;
      title.textContent = about.version ? t('updatepage.title', { version: about.version }) : 'Rice';
      badge.textContent = v.badge;
      badge.className = `upd-badge tone-${v.tone}`;
      const dot = el('span', { className: 'upd-dot' }, []);
      badge.prepend(dot);
      sub.textContent = v.sub || (about.commit ? t('updatepage.commit', { commit: about.commit }) : '');
      sub.hidden = !sub.textContent;
      if (v.action) {
        const b = el('button', { type: 'button', className: v.action.primary ? 'btn primary' : 'btn ghost', textContent: state.busy ? t('updatenow.checking') : v.action.label }, []);
        b.disabled = Boolean(v.action.disabled);
        if (state.local) b.title = t('local.mode.blocked.updates');
        b.onclick = () => { if (!b.disabled) actions[v.action.id](); };
        act.replaceChildren(b);
      } else act.replaceChildren();
      bar.hidden = v.percent === null;
      if (v.percent !== null) { bar.value = v.percent; bar.setAttribute('aria-label', v.badge); }
      help.textContent = v.error || v.help;
      help.hidden = !help.textContent;
      help.classList.toggle('upd-warn', v.tone === 'warn' || Boolean(v.error));
      // com versão nova houve consulta: nunca diz "Ainda não verificou" (sem a hora, a linha some)
      const known = ['available', 'ready', 'downloading'].includes(v.kind);
      last.textContent = state.local || (known && !state.lastCheckAt) ? '' : lastText(state.lastCheckAt, now());
      last.hidden = !last.textContent;
      pathLine.textContent = about.appPath ? middle(about.appPath, 52) : '—';
      pathLine.title = about.appPath || '';
      commitLine.textContent = about.commitFull || about.commit || '—';
      howLine.textContent = opts.platform === 'win32' && state.win && state.win.supported ? t('winupdate.help') : state.status && state.status.fromClone ? t('update.run-help') : t('update.download-help');
    }

    async function runCheck() {
      if (state.busy || state.cooling || state.local) return;
      state.busy = true;
      state.cooling = true;
      paint();
      setTimeout(() => { state.cooling = false; paint(); }, MIN_GAP_MS);
      try {
        state.result = await api.checkNow();
        if (state.result && state.result.lastCheckAt) state.lastCheckAt = state.result.lastCheckAt;
        if (state.result && state.result.status) state.status = state.result.status;
      } catch {
        state.result = { phase: 'error', error: 'network' };
      }
      state.busy = false;
      paint();
    }

    const onStatus = (e) => {
      if (!node.isConnected) return window.removeEventListener('rice:update-changed', onStatus);
      state.status = e.detail;
      paint();
    };
    const onWin = (e) => {
      if (!node.isConnected) return window.removeEventListener('rice:winupdate-changed', onWin);
      state.win = e.detail;
      paint();
    };
    window.addEventListener('rice:update-changed', onStatus);
    window.addEventListener('rice:winupdate-changed', onWin);
    if (opts.autoToggle) opts.autoToggle.addEventListener('change', paint);

    paint();
    if (api.updateStatus) api.updateStatus().then((s) => { state.status = s; paint(); }).catch(() => {});
    if (api.about) api.about().then((a) => { state.about = a; paint(); }).catch(() => {});
    if (api.lastCheck) api.lastCheck().then((at) => { state.lastCheckAt = at || null; paint(); }).catch(() => {});
    if (api.winStatus && opts.platform === 'win32') api.winStatus().then((w) => { state.win = w; paint(); }).catch(() => {});
    return { node };
  }

  window.RiceUpdatePage = { create, view, lastText, whenText, dayText, middle };
})();
