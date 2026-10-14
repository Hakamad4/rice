// Aviso de versão nova: ponto discreto em Configurações (barra lateral) e a linha com o botão em Configurações › Atualizações.
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

  /** A caixa do aviso (escondida sem versão nova): texto "Nova versão disponível (abc123 → def456)", botão e explicação. */
  function box(status, onRun) {
    const node = el('div', { className: 'update-notice', hidden: true }, []);
    paint(node, status, onRun);
    return node;
  }

  function paint(node, status, onRun) {
    const ok = status && status.available && SHA.test(String(status.from)) && SHA.test(String(status.to));
    node.hidden = !ok;
    if (!ok) return node.replaceChildren();
    const run = el('button', { type: 'button', className: 'btn primary', textContent: status.fromClone ? t('update.run') : t('update.download') }, []);
    run.onclick = onRun;
    node.replaceChildren(
      el('div', { className: 'update-line' }, [
        el('span', { className: 'update-text', textContent: t('update.available', { from: status.from, to: status.to }) }, []),
        run,
      ]),
      el('p', { className: 'set-help', textContent: status.fromClone ? t('update.run-help') : t('update.download-help') }, []),
    );
  }

  /** "Versão 0.4.0 · commit abc1234 · /Applications/Rice.app" (sem commit, quando o app não tem build-info). */
  function aboutText(about) {
    if (!about || !about.version) return '';
    return about.commit
      ? t('update.about', { version: about.version, commit: about.commit, path: about.appPath })
      : t('update.about.nocommit', { version: about.version, path: about.appPath });
  }

  window.RiceUpdate = { applyDot, box, paint, aboutText };
})();
