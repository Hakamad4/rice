// Compartilhar: submenu do ⋯ da reunião, aviso discreto ("Notas copiadas"), diálogo do e-mail e do PDF.
// Só createElement/textContent; o texto das notas e do e-mail nunca passa por innerHTML.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const deps = { openDialog: null, warn: () => {} };
  let draftSeq = 1_000_000; // ids de cancelamento fora da faixa do chat
  let toastTimer = null;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Liga o que o renderer principal sabe fazer: abrir diálogo e mostrar aviso de erro. */
  function setup(options) {
    Object.assign(deps, options);
  }

  /** Aviso curto e discreto na base da janela, que some sozinho. */
  function toast(text) {
    let node = document.getElementById('toast');
    if (!node) {
      node = el('div', { id: 'toast', className: 'toast' }, []);
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      window.RiceToastStack.get().append(node);
    }
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2000);
  }

  async function copy(dir, kind) {
    const result = await (kind === 'markdown' ? window.rice.copyMarkdown(dir) : window.rice.copyNotes(dir));
    if (result.ok) toast(t(kind === 'markdown' ? 'share.toast.md' : 'share.toast.notes'));
    else deps.warn(result.message);
  }

  /** Tamanho do mailto como o main calcula (CRLF e %XX); o main confere de novo ao abrir. */
  function mailtoLength(to, subject, body) {
    const enc = (s) => encodeURIComponent(s.replace(/\r\n?|\n/g, '\r\n'));
    return 'mailto:'.length + to.join(',').length + '?subject='.length + enc(subject).length + '&body='.length + enc(body).length;
  }

  const splitRecipients = (text) => text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

  async function writeClipboard(text) {
    try {
      return (await window.rice.copyText(text)) === true; // pelo main: a página não tem permissão de clipboard
    } catch {
      return false;
    }
  }

  /** Caminho longo cortado no meio ("~/Documents/…/Reuniões"), para caber no campo. */
  function middle(text, max) {
    const limit = max || 38;
    if (text.length <= limit) return text;
    const head = Math.ceil((limit - 1) * 0.4);
    return `${text.slice(0, head)}…${text.slice(text.length - (limit - 1 - head))}`;
  }

  function emailDialog(dir) {
    const D = window.RiceDialog;
    deps.openDialog(t('share.email.title'), (box, close) => {
      const id = ++draftSeq;
      const status = el('p', { className: 'dlg-hint', textContent: t('share.email.writing') }, []);
      const closeBtn = D.button(t('common.cancel'), 'ghost', close);
      box.body.append(status);
      box.foot.append(closeBtn);
      window.rice.emailDraft(id, dir).then((result) => {
        if (!box.isConnected) return; // fechou enquanto a IA escrevia
        if (!result.ok) {
          status.textContent = result.message;
          status.classList.add('warn');
          closeBtn.textContent = t('share.email.close');
          return;
        }
        const to = el('input', { type: 'text', value: result.to.join(', '), placeholder: t('share.email.to-ph'), autocomplete: 'off', spellcheck: false }, []);
        const subject = el('input', { type: 'text', value: result.subject, autocomplete: 'off' }, []);
        const body = el('textarea', { value: result.body, spellcheck: false }, []);
        const hint = el('p', { className: 'dlg-hint warn', textContent: t('share.email.too-long'), hidden: true }, []);
        const copyBtn = D.button(t('share.email.copy'), 'ghost');
        const mailBtn = D.button(t('share.email.open'), 'primary');
        closeBtn.textContent = t('share.email.close');
        const sync = () => {
          const tooLong = mailtoLength(splitRecipients(to.value), subject.value, body.value) > result.mailtoLimit;
          mailBtn.hidden = tooLong;
          hint.hidden = !tooLong;
        };
        for (const input of [to, subject, body]) input.oninput = sync;
        copyBtn.onclick = async () => {
          if (await writeClipboard(`${t('share.email.subject')}: ${subject.value}\n\n${body.value}`)) D.flash(copyBtn, t('share.copied')); // o aviso fica no próprio botão
        };
        mailBtn.onclick = async () => {
          const opened = await window.rice.openMail({ to: splitRecipients(to.value), subject: subject.value, body: body.value });
          if (opened.ok) close();
          else (hint.textContent = opened.message, (hint.hidden = false));
        };
        box.body.replaceChildren(D.field(t('share.email.to'), to), D.field(t('share.email.subject'), subject), D.field(t('share.email.body'), body), hint);
        box.foot.replaceChildren(closeBtn, copyBtn, mailBtn);
        sync();
        // foco: em "Para" se estiver vazio; senão na mensagem, lendo do começo
        if (!to.value.trim()) to.focus();
        else {
          body.focus();
          body.setSelectionRange(0, 0);
          body.scrollTop = 0;
        }
      });
      return () => window.rice.cancel(id); // fechar o diálogo (Esc também) cancela a IA
    });
  }

  function pdfDialog(dir) {
    const D = window.RiceDialog;
    deps.openDialog(t('share.pdf.title'), (box, close) => {
      const transcript = D.check(t('share.pdf.transcript'), false);
      const folder = el('input', { type: 'text', readOnly: true, tabIndex: -1, value: '…' }, []);
      const change = D.button(t('share.pdf.change'), 'ghost');
      const name = el('input', { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: t('share.pdf.name-ph') }, []);
      const status = el('p', { className: 'dlg-hint', hidden: true }, []);
      const cancel = D.button(t('common.cancel'), 'ghost', close);
      const go = D.button(t('share.pdf.export'), 'primary');
      go.disabled = true;
      let timer = null;
      window.rice.exportInfo(dir).then((info) => {
        if (!box.isConnected || !info.ok) return;
        folder.value = middle(info.folder);
        folder.title = info.folder;
        name.value = info.fileName;
        go.disabled = false;
        name.focus();
        name.select();
      });
      change.onclick = async () => {
        const result = await window.rice.chooseExportDir();
        if (result && result.ok && box.isConnected) {
          folder.value = middle(result.folder);
          folder.title = result.folder;
        }
      };
      go.onclick = async () => {
        go.disabled = true;
        cancel.disabled = true;
        change.disabled = true;
        go.textContent = t('share.pdf.saving');
        const result = await window.rice.exportPdf(dir, { transcript: transcript.input.checked, fileName: name.value });
        if (!box.isConnected) return;
        cancel.disabled = false;
        if (!result.ok) {
          change.disabled = false;
          go.disabled = false;
          go.textContent = t('share.pdf.export');
          status.textContent = result.message;
          status.className = 'dlg-hint warn';
          status.hidden = false;
          return;
        }
        // salvou: o botão primário vira "Mostrar no Finder" por alguns segundos
        status.textContent = t('share.pdf.saved', { path: middle(result.display, 48) });
        status.className = 'dlg-hint';
        status.hidden = false;
        cancel.textContent = t('share.email.close');
        go.textContent = t('share.pdf.reveal');
        go.disabled = false;
        go.onclick = async () => {
          await window.rice.revealExport(result.path);
          close();
        };
        timer = setTimeout(close, 8000);
      };
      box.body.append(
        transcript.row,
        D.field(t('share.pdf.save-in'), el('div', { className: 'dlg-row' }, [folder, change])),
        D.field(t('share.pdf.name'), name),
        status,
      );
      box.foot.append(cancel, go);
      return () => clearTimeout(timer);
    }, { enterConfirms: true });
  }

  /** Itens do submenu "Compartilhar ▸". Os que dependem de notas ficam desabilitados, com a dica do motivo. */
  function items({ dir, hasNotes, isDraft }) {
    const noNotes = hasNotes ? {} : { disabled: true, title: t('share.no-notes') };
    return [
      { icon: 'copy', label: t('share.copy-notes'), ...noNotes, onSelect: () => copy(dir, 'rich') },
      { icon: 'file-text', label: t('share.copy-md'), ...noNotes, onSelect: () => copy(dir, 'markdown') },
      { separator: true },
      { icon: 'mail', label: t('share.email'), ...noNotes, onSelect: () => emailDialog(dir) },
      { icon: 'download', label: t('share.pdf'), ...(isDraft ? { disabled: true } : {}), onSelect: () => pdfDialog(dir) },
    ];
  }

  window.RiceShare = { setup, items, toast, mailtoLength };
})();
