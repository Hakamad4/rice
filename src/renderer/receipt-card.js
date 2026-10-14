// Recibo de privacidade: "O que saiu deste computador" (ícone de escudo no ⋯ da reunião). Linhas só com metadados; exportável.
// Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Abre o cartão da reunião `dir`. */
  async function open(dir) {
    const rice = window.rice;
    let data;
    try {
      data = await rice.receiptGet(dir);
    } catch (err) {
      data = { ok: false, message: String((err && err.message) || err) };
    }
    window.RiceDialog.open(t('receipt.menu'), (box, close) => {
      if (!data || data.ok === false) {
        box.body.append(el('p', { className: 'set-help', textContent: (data && data.message) || '' }, []));
        box.foot.append(window.RiceDialog.button(t('receipt.close'), 'ghost', close));
        return;
      }
      box.body.append(
        el('p', { className: `receipt-summary${data.nothingLeft ? ' local' : ''}`, role: 'status' }, [window.RiceIcons.icon('shield'), el('span', { textContent: data.summary }, [])]),
        el('ul', { className: 'receipt-list' }, data.rows.map((row) => {
          const li = el('li', { className: `receipt-row${row.sent ? ' sent' : ''}` }, [el('span', { className: 'receipt-label', textContent: row.label }, []), el('span', { className: 'receipt-value', textContent: row.value }, [])]);
          li.dataset.row = row.id;
          return li;
        })),
        el('p', { className: 'receipt-note', textContent: t('receipt.note') }, []),
      );
      const feedback = el('span', { className: 'dlg-sub', role: 'status' }, []);
      const copy = window.RiceDialog.button(t('receipt.copy'), 'ghost', async () => {
        const result = await rice.receiptExport(dir, 'copy');
        if (result && result.ok) window.RiceDialog.flash(copy, t('receipt.copied'));
      });
      const pdf = window.RiceDialog.button(t('receipt.pdf'), 'ghost', async () => {
        pdf.disabled = true;
        const result = await rice.receiptExport(dir, 'pdf');
        pdf.disabled = false;
        feedback.textContent = result && result.ok ? t('receipt.saved', { path: result.display || result.path }) : (result && result.message) || '';
      });
      box.body.append(feedback);
      box.foot.append(copy, pdf, window.RiceDialog.button(t('receipt.close'), 'primary', close));
    }, { title: t('receipt.menu') });
  }

  window.RiceReceipt = { open };
})();
