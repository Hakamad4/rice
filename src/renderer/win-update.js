// Windows: Configurações › Atualizações com "Nova versão X disponível" › "Baixar e instalar" (com progresso) › "Reiniciar e atualizar".
// Só aparece quando o main diz que há suporte (Windows instalado pelo NSIS, opção ligada, fora do Modo 100% local). Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const button = (text, onClick, primary) => {
    const b = el('button', { type: 'button', className: primary ? 'btn primary' : 'btn', textContent: text }, []);
    b.onclick = onClick;
    return b;
  };

  /** A caixa (escondida sem suporte). `api`: { download, install } do preload. */
  function create(api) {
    const node = el('div', { className: 'update-notice win-update', hidden: true }, []);
    const act = (fn) => async () => {
      try {
        paint(await fn());
      } catch {
        // o main nunca lança aqui; se lançar, a tela fica como está
      }
    };

    function paint(state) {
      const s = state || {};
      node.hidden = !s.supported;
      if (!s.supported) return node.replaceChildren();
      const version = VERSION.test(String(s.version)) ? s.version : '';
      const rows = [];
      if (s.phase === 'available') {
        rows.push(el('div', { className: 'update-line' }, [el('span', { className: 'update-text', textContent: t('winupdate.available', { version }) }, []), button(t('winupdate.download'), act(api.download), true)]));
        rows.push(el('p', { className: 'set-help', textContent: t('winupdate.help') }, []));
      } else if (s.phase === 'downloading') {
        const percent = Math.max(0, Math.min(100, Number(s.percent) || 0));
        const bar = el('progress', { className: 'win-update-bar', max: 100, value: percent }, []);
        bar.setAttribute('aria-label', t('winupdate.downloading', { version, percent }));
        rows.push(el('div', { className: 'update-line' }, [el('span', { className: 'update-text', textContent: t('winupdate.downloading', { version, percent }) }, [])]), bar);
      } else if (s.phase === 'downloaded') {
        rows.push(el('div', { className: 'update-line' }, [el('span', { className: 'update-text', textContent: t('winupdate.ready', { version }) }, []), button(t('winupdate.restart'), act(api.install), true)]));
        rows.push(el('p', { className: 'set-help', textContent: s.waitingForRecording ? t('winupdate.waiting') : t('winupdate.restart-help') }, []));
      } else {
        // ocioso: nada a mostrar aqui; a busca manual e a linha de datas ficam em RiceUpdateNow
        node.hidden = true;
        return node.replaceChildren();
      }
      if (s.error) rows.push(el('p', { className: 'set-help win-update-error', textContent: t('winupdate.error', { message: s.error }) }, []));
      node.replaceChildren(...rows);
    }

    return { node, paint };
  }

  /** O ponto discreto no item Configurações quando há versão para baixar ou instalar. */
  const hasNews = (state) => Boolean(state && state.supported && (state.phase === 'available' || state.phase === 'downloaded'));

  window.RiceWinUpdate = { create, hasNews };
})();
