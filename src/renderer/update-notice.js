// Aviso de versão nova: ponto discreto em Configurações (barra lateral) e a faixa no topo da janela.
// Nada de atualizar sozinho: o botão só abre o Terminal (clone) ou a página de releases. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const SHA = /^[0-9a-f]{7}$/i;

  /** Ponto no item Configurações da barra lateral (e o aviso para leitores de tela). */
  function applyDot(node, status) {
    const on = Boolean(status && status.available);
    node.classList.toggle('has-update', on);
    if (on) node.title = t('update.dot');
    else node.removeAttribute('title');
    let hint = node.querySelector('.sr-only');
    if (on && !hint) {
      hint = el('span', { className: 'sr-only' }, []);
      node.append(hint);
    }
    if (hint) hint.textContent = on ? ` ${t('update.dot')}` : '';
  }

  /**
   * A faixa no topo da janela principal (Mac): "Nova versão disponível (abc1234 → def5678)" com "Atualizar agora" e "Depois".
   * Escondida sem versão nova, com o "Depois" valendo, durante a gravação e no Windows (lá o electron-updater tem a UI dele).
   * `opts`: { recording, windows, onRun, onLater }.
   */
  function banner(node, status, opts) {
    const ok = status && status.available && !status.dismissed && SHA.test(String(status.from)) && SHA.test(String(status.to));
    const show = Boolean(ok) && !opts.recording && !opts.windows;
    node.hidden = !show;
    if (!show) return node.replaceChildren();
    const icon = el('span', { className: 'ico' }, []);
    icon.append(window.RiceIcons.icon('download'));
    const now = el('button', { type: 'button', className: 'btn primary', textContent: t('update.banner.now') }, []);
    now.onclick = opts.onRun;
    const later = el('button', { type: 'button', className: 'btn', textContent: t('update.banner.later') }, []);
    later.onclick = opts.onLater;
    node.setAttribute('aria-label', t('update.banner.region'));
    node.replaceChildren(icon, el('span', { className: 'update-banner-text', textContent: t('update.available', { from: status.from, to: status.to }) }, []), el('span', { className: 'update-banner-actions' }, [now, later]));
  }

  window.RiceUpdate = { applyDot, banner };
})();
