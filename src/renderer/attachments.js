// Anexos da reunião: bloco na aba Notas (cartões), arrastar-e-soltar, colar imagem e "Anexar arquivo…". Só createElement/textContent.
// O renderer nunca escreve no disco: manda caminhos (arrastar) ou bytes (colar) para o main, que copia para <reunião>/anexos/.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const size = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString(window.RiceI18n.locale(), { hour: '2-digit', minute: '2-digit' }) : '');
  const ICON = { image: 'image', pdf: 'file-text', text: 'file-text', other: 'file' };
  const hasFiles = (e) => Boolean(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));

  /** `deps`: { rice, warn(message), onChange?() }. Devolve { setDir(dir), node, onPaste(event), refresh() }. */
  function create(deps) {
    const { rice } = deps;
    let dir = null;
    let data = { items: [], images: { supported: true, provider: '' } };
    let thumbSeq = 0;

    const node = el('div', { className: 'attach-block' }, []);

    const report = (results) => {
      for (const r of results || []) if (r && r.ok === false) deps.warn(t('attach.err.failed', { name: r.name || '', message: r.message || '' }));
    };

    async function addFiles(files) {
      if (!dir || !files.length) return;
      const onDisk = [];
      for (const file of files) {
        if (rice.hasFilePath && rice.hasFilePath(file)) onDisk.push(file);
        else if (file.size > 0) report([await rice.attachData(dir, file.name || 'arquivo', await file.arrayBuffer())]); // veio de um navegador: sem caminho em disco
      }
      if (onDisk.length) report(await rice.attachFiles(dir, onDisk));
    }

    /** ⌘V com imagem nas anotações vira anexo (o texto colado segue o caminho normal). */
    function onPaste(event) {
      const files = [...((event.clipboardData && event.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
      if (!dir || files.length === 0) return;
      event.preventDefault();
      const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
      files.forEach(async (file, i) => {
        const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const r = await rice.attachData(dir, `${t('attach.pasted-image')} ${stamp}${i ? ` ${i + 1}` : ''}.${ext}`, await file.arrayBuffer());
        report([r]);
        if (r && r.ok && r.item && deps.onPasted) deps.onPasted(r.item.name || r.item.file);
      });
    }

    function card(item) {
      const thumb = el('span', { className: 'attach-thumb' }, [window.RiceIcons.icon(ICON[item.kind] || 'file')]);
      if (item.kind === 'image' && rice.attachThumb) {
        const seq = thumbSeq;
        rice.attachThumb(dir, item.file).then((url) => {
          if (url && seq === thumbSeq && thumb.isConnected) thumb.replaceChildren(el('img', { src: url, alt: '' }, []));
        }).catch(() => {});
      }
      const meta = [size(item.size), time(item.addedAt)].filter(Boolean).join(' · ');
      const more = el('button', { type: 'button', className: 'icon-btn attach-more', title: t('attach.more') }, [window.RiceIcons.icon('more')]);
      more.setAttribute('aria-label', t('attach.more'));
      more.setAttribute('aria-haspopup', 'menu');
      const open = () => rice.attachOpen(dir, item.file);
      more.onclick = (e) => {
        e.stopPropagation();
        window.RiceActionMenu.open({
          anchor: more,
          items: [
            { icon: 'file', label: t('attach.open'), onSelect: open },
            { icon: 'folder', label: t('attach.reveal'), onSelect: () => rice.attachReveal(dir, item.file) },
            { icon: 'trash', label: t('attach.remove'), danger: true, onSelect: async () => {
              const r = await rice.attachRemove(dir, item.file);
              if (r && r.ok === false) deps.warn(r.message);
            } },
          ],
        });
      };
      const c = el('div', { className: 'attach-card', title: item.name, tabIndex: 0 }, [
        thumb,
        el('div', { className: 'attach-text' }, [el('span', { className: 'attach-name', textContent: item.name }, []), el('small', { textContent: meta }, [])]),
        more,
      ]);
      c.onclick = open;
      c.onkeydown = (e) => {
        if (e.key === 'Enter') open();
      };
      return c;
    }

    function draw() {
      const add = el('button', { type: 'button', className: 'btn ghost attach-add' }, [window.RiceIcons.icon('paperclip'), el('span', { textContent: t('attach.add') }, [])]);
      add.onclick = async () => dir && report(await rice.attachPick(dir));
      const notes = [];
      if (data.items.some((a) => a.kind === 'image') && data.images && !data.images.supported) {
        const label = window.RiceAiProviders && data.images.provider ? window.RiceAiProviders.label(data.images.provider) : '';
        notes.push(el('p', { className: 'attach-note', textContent: t('attach.images-note', { provider: label }) }, []));
      }
      if (data.items.some((a) => a.note === 'pdf-unsupported')) notes.push(el('p', { className: 'attach-note', textContent: t('attach.pdf-note') }, []));
      thumbSeq++;
      node.replaceChildren(
        el('div', { className: 'attach-head' }, [add]),
        data.items.length === 0 ? el('p', { className: 'attach-empty', textContent: t('attach.empty') }, []) : el('div', { className: 'attach-grid' }, data.items.map(card)),
        ...notes,
      );
    }

    async function refresh() {
      if (!dir || !rice.attachList) return;
      try {
        data = await rice.attachList(dir);
      } catch {
        data = { items: [], images: { supported: true, provider: '' } };
      }
      draw();
      if (deps.onChange) deps.onChange();
    }

    // arrastar arquivos para qualquer ponto da página da reunião
    let depth = 0;
    const setOver = (on) => document.body.classList.toggle('attach-over', on);
    document.addEventListener('dragenter', (e) => {
      if (!dir || !hasFiles(e)) return;
      depth++;
      setOver(true);
    });
    document.addEventListener('dragover', (e) => {
      if (dir && hasFiles(e)) e.preventDefault();
    });
    document.addEventListener('dragleave', (e) => {
      if (!dir || !hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    });
    document.addEventListener('drop', (e) => {
      if (!dir || !hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      addFiles([...e.dataTransfer.files]);
    });
    rice.on('attachments:changed', (p) => {
      if (p && p.dir === dir) refresh();
    });

    return {
      node,
      onPaste,
      refresh,
      async setDir(next) {
        dir = next;
        data = { items: [], images: { supported: true, provider: '' } };
        draw();
        if (dir) await refresh();
      },
    };
  }

  window.RiceAttachments = { create };
})();
