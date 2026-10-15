// Configurações › Atualizações: o botão "Buscar atualização agora" (Mac e Windows) e a linha "Última verificação · Próxima".
// Só createElement/textContent. O main decide o que consultar; aqui só o estado do botão e os textos (datas relativas no idioma do app).
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

  /** A linha discreta: "Última verificação: hoje às 14:32 · Próxima: amanhã (automático, 1x por dia)"; automático desligado troca a 2ª parte. */
  function lineText(lastCheckAt, autoOn, now) {
    const last = lastCheckAt && !Number.isNaN(Date.parse(lastCheckAt)) ? lastCheckAt : null;
    const first = last ? t('updatenow.last', { when: whenText(last, now) }) : t('updatenow.never');
    if (!autoOn) return `${first} · ${t('updatenow.autooff')}`;
    // a consulta automática acontece ao abrir o app, no máximo 1x por dia: a próxima é 1 dia depois da última (ou hoje, se já venceu / nunca houve)
    const nextAt = last ? Math.max(Date.parse(last) + DAY_MS, now.getTime()) : now.getTime();
    return `${first} · ${t('updatenow.next', { day: dayText(new Date(nextAt), now) })}`;
  }

  /** O texto do resultado da busca (vazio = nada a dizer). `version`: a versão deste app. */
  function resultText(result, version) {
    if (!result) return '';
    if (result.phase === 'latest') return t('updatenow.latest', { version: version || '' });
    if (result.phase === 'available') return t('updatenow.available');
    if (result.phase === 'error') return result.error === 'network' || !result.message ? t('updatenow.error.network') : t('updatenow.error.other', { message: String(result.message).slice(0, 160) });
    return '';
  }

  /**
   * `api`: { checkNow, lastCheck } do preload. `opts`: { autoOn, local, version, now }.
   * Devolve { node, setAuto(on) }.
   */
  function create(api, opts) {
    const now = () => (opts.now ? opts.now() : new Date());
    let autoOn = Boolean(opts.autoOn) && !opts.local;
    let lastCheckAt = null;
    let busy = false;
    let cooling = false;
    let result = null;

    const button = el('button', { type: 'button', className: 'btn ghost', textContent: t('updatenow.button') }, []);
    const status = el('span', { className: 'update-now-status set-help', textContent: '' }, []);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const line = el('p', { className: 'set-help update-now-line' }, []);
    const node = el('div', { className: 'update-now' }, [el('div', { className: 'update-line' }, [status, button]), line]);

    function paint() {
      button.disabled = Boolean(opts.local) || busy || cooling;
      button.title = opts.local ? t('local.mode.blocked.updates') : '';
      button.textContent = busy ? t('updatenow.checking') : t('updatenow.button');
      status.textContent = opts.local ? t('local.mode.blocked.updates') : busy ? t('updatenow.checking') : resultText(result, opts.version);
      status.classList.toggle('update-now-error', !busy && Boolean(result) && result.phase === 'error');
      line.textContent = lineText(lastCheckAt, autoOn, now());
    }

    button.onclick = async () => {
      if (button.disabled) return;
      busy = true;
      cooling = true;
      paint();
      setTimeout(() => { cooling = false; paint(); }, MIN_GAP_MS);
      try {
        result = await api.checkNow();
        if (result && result.lastCheckAt) lastCheckAt = result.lastCheckAt;
      } catch {
        result = { phase: 'error', error: 'network' };
      }
      busy = false;
      paint();
    };

    paint();
    if (api.lastCheck) api.lastCheck().then((at) => { lastCheckAt = at || null; paint(); }).catch(() => {});
    return { node, setAuto: (on) => { autoOn = Boolean(on) && !opts.local; paint(); }, setVersion: (v) => { opts.version = v; paint(); } };
  }

  window.RiceUpdateNow = { create, lineText, whenText, dayText, resultText };
})();
