// Aviso de consentimento: ao começar a gravar aparece um toast discreto, que NÃO bloqueia nada, com "Copiar aviso" (um texto pronto
// para colar no chat da reunião). Só UI: é disparado pelo evento de estado da sessão que já existe. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const VISIBLE_MS = 20_000;
  let node = null;
  let timer = null;

  function el(tag, props, children) {
    const n = Object.assign(document.createElement(tag), props);
    for (const child of children || []) n.append(child);
    return n;
  }

  function hide() {
    clearTimeout(timer);
    if (node) node.remove();
    node = null;
  }

  /** Pergunta ao main se deve avisar (opção ligada e aviso ainda não copiado nesta reunião) e mostra o toast. */
  async function offer(dir) {
    const rice = window.rice;
    if (!rice.consentNotice) return;
    let info;
    try {
      info = await rice.consentNotice(dir);
    } catch {
      return;
    }
    if (!info || info.show !== true) return;
    hide();
    const copy = el('button', { type: 'button', className: 'consent-copy', textContent: t('consent.copy') }, []);
    const close = el('button', { type: 'button', className: 'consent-close', title: t('consent.dismiss') }, [window.RiceIcons.icon('x')]);
    close.setAttribute('aria-label', t('consent.dismiss'));
    node = el('div', { className: 'consent-toast', role: 'status' }, [
      el('span', { className: 'consent-ico' }, [window.RiceIcons.icon('info')]),
      el('span', { className: 'consent-text', textContent: t('consent.toast') }, []),
      copy,
      close,
    ]);
    copy.onclick = async () => {
      try {
        if ((await rice.copyText(info.text)) !== true) return;
        await rice.consentMarkCopied(dir);
        copy.textContent = t('consent.copied');
        copy.disabled = true;
        clearTimeout(timer);
        timer = setTimeout(hide, 2200);
      } catch {
        // sem permissão de área de transferência: o aviso continua na tela
      }
    };
    close.onclick = hide;
    window.RiceToastStack.get().append(node); // na pilha da coluna principal, junto dos outros avisos
    timer = setTimeout(hide, VISIBLE_MS);
  }

  window.RiceConsent = { offer, hide };
})();
