// Padrão único de diálogo: cabeçalho (título 16px), corpo (campos com 14px entre si) e rodapé (botões à direita).
// Todo diálogo do app passa por aqui. Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Botão do rodapé: `primary` (preenchido), `ghost` (borda de 1px) ou `danger` (vermelho). */
  function button(text, kind, onclick) {
    const b = el('button', { type: 'button', textContent: text, className: kind || 'ghost' }, []);
    if (onclick) b.onclick = onclick;
    return b;
  }

  /** Campo: rótulo de 12px acima, controle abaixo. */
  function field(label, control) {
    const wrap = el('div', { className: 'dlg-field' }, []);
    const id = control.id || (control.id = `dlg-${Math.random().toString(36).slice(2, 8)}`);
    wrap.append(el('label', { className: 'dlg-label', textContent: label, htmlFor: id }, []), control);
    return wrap;
  }

  /** Linha de caixa de seleção: o rótulo fica NA MESMA LINHA e o clique nele marca. */
  function check(label, checked) {
    const input = el('input', { type: 'checkbox', checked: Boolean(checked) }, []);
    const row = el('label', { className: 'dlg-check' }, [input, el('span', { textContent: label }, [])]);
    return { row, input };
  }

  /** Troca o texto do botão por um instante ("Copiado") em vez de abrir aviso extra. */
  function flash(btn, text, ms) {
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = text;
    clearTimeout(btn._flash);
    btn._flash = setTimeout(() => (btn.textContent = old), ms || 1500);
  }

  /**
   * `fill(box, close)` monta o conteúdo: `box.body` (campos) e `box.foot` (botões). Pode devolver uma função de limpeza.
   * `opts`: { title (padrão = label), subtitle, enterConfirms (Enter num campo aciona o botão primário) }.
   * Esc fecha. O foco inicial vai para `[data-autofocus]`, senão o primeiro campo de texto, senão o primeiro botão.
   */
  function open(label, fill, opts) {
    const o = opts || {};
    const previous = document.activeElement;
    const overlay = el('div', { className: 'overlay' }, []);
    const box = el('div', { className: 'dialog', role: 'dialog' }, []);
    box.setAttribute('aria-label', label);
    box.setAttribute('aria-modal', 'true');
    const body = el('div', { className: 'dlg-body' }, []);
    const foot = el('div', { className: 'dlg-foot' }, []);
    box.append(el('h2', { className: 'dlg-title', textContent: o.title || label }, []));
    if (o.subtitle) box.append(el('p', { className: 'dlg-sub', textContent: o.subtitle }, []));
    box.append(body, foot);
    box.body = body;
    box.foot = foot;
    let cleanup = null;
    const close = () => {
      if (!overlay.isConnected) return;
      overlay.remove();
      if (typeof cleanup === 'function') cleanup();
      if (previous && previous.focus) previous.focus();
    };
    box.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && o.enterConfirms && !e.defaultPrevented && /^(INPUT)$/.test(e.target.tagName) && e.target.type !== 'checkbox') {
        const primary = foot.querySelector('button.primary:not(:disabled), button.danger:not(:disabled)');
        if (primary) {
          e.preventDefault();
          primary.click();
        }
      }
    };
    cleanup = fill(box, close);
    overlay.append(box);
    document.body.append(overlay);
    const first = box.querySelector('[data-autofocus]') || body.querySelector('input:not([type=checkbox]):not([readonly]), textarea') || foot.querySelector('button');
    if (first) first.focus();
    return { box, close };
  }

  window.RiceDialog = { open, button, field, check, flash };
})();
