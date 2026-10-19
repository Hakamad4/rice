// Tradução ao vivo: botão (liga/desliga + menu de idioma e do modelo offline) ao lado das abas da reunião, a tradução em azul
// embaixo de cada fala (a original fica em itálico) e o controle do modelo offline (menu e Configurações). Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const num = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: n >= 10 ? 0 : 1 }).format(n);
  /** 1 GB = 1000 MB (o que o disco e o download mostram). */
  function size(bytes) {
    return bytes >= 1e9 ? t('translate.size.gb', { n: num(bytes / 1e9) }) : t('translate.size.mb', { n: num(Math.max(1, bytes / 1e6)) });
  }

  let rice = null;
  let follow = (fn) => fn();
  let isRecording = () => false;
  let redraw = () => {};
  let openSettings = () => {};
  let dir = null;
  let state = null; // { on, lang, langs, records }
  let offline = { state: 'not-installed', packs: [], ramBytes: 0, localMode: false };
  let notice = null;
  let translations = new Map(); // linha da transcrição -> texto (só o idioma escolhido)
  const rows = new Map(); // linha da transcrição -> <p>
  const offlineWatchers = new Set();

  /** Chave OFFLINE_TRANSLATION vinda do main: desligada, nada do modelo offline aparece (menu, Configurações, avisos). */
  const offlineOn = () => offline.enabled === true;
  const packs = () => offline.packs || [];
  const stub = () => packs().every((p) => !p.installed && p.downloadBytes === 0); // o motor offline ainda não existe nesta versão
  const installedLangs = () => packs().filter((p) => p.installed).map((p) => p.lang);
  const sumBytes = (langs) => packs().filter((p) => langs.includes(p.lang) && !p.installed).reduce((n, p) => n + p.downloadBytes, 0);
  const diskBytes = () => packs().filter((p) => p.installed).reduce((n, p) => n + p.diskBytes, 0);
  /** Pacotes que faltam para traduzir da língua da reunião para a escolhida offline (o inglês é o pivô e sempre entra). */
  const missing = () => {
    const have = installedLangs();
    return [...new Set([state ? state.from : 'pt', state ? state.lang : 'en', 'en'])].filter((l) => !have.includes(l));
  };
  const langName = (l) => t(`translate.lang.${l}`);
  const active = () => Boolean(state && (state.on || translations.size > 0));
  const percent = () => (offline.progress && offline.progress.totalBytes > 0 ? Math.min(100, Math.floor((offline.progress.receivedBytes / offline.progress.totalBytes) * 100)) : 0);

  function loadTranslations() {
    translations = new Map();
    if (state) for (const r of state.records) if (r.lang === state.lang) translations.set(r.key, r.text);
  }

  function paintRow(line, row) {
    row.querySelector('.t-tr')?.remove();
    row.classList.toggle('tr-orig', active());
    const text = translations.get(line);
    row.classList.toggle('has-tr', Boolean(text));
    if (text) row.append(el('span', { className: 't-tr', textContent: text }, []));
  }

  function paintRows() {
    for (const [line, row] of rows) paintRow(line, row);
  }

  async function download(langs) {
    notice = notice && notice.kind === 'download-failed' ? null : notice;
    const result = await rice.translateOfflineDownload(langs);
    if (!result.ok && !result.cancelled && result.message) notice = { kind: 'download-failed', message: result.message };
    paint();
  }
  const cancel = () => rice.translateOfflineCancel();
  const remove = (langs) => rice.translateOfflineDelete(langs);

  async function set(patch) {
    if (!dir) return;
    state = await rice.translateSet(dir, patch);
    loadTranslations();
    paintRows();
    if (patch.on === true) notice = null;
    paint();
    redraw();
  }

  /** Itens do menu da tradução: idioma de destino e os pacotes offline (tamanho de cada um; baixar, cancelar, apagar). */
  function menuItems() {
    const items = [{ heading: t('translate.menu.to') }];
    for (const l of state ? state.langs.filter((x) => x !== state.from) : []) items.push({ label: langName(l), checked: state.lang === l, onSelect: () => set({ lang: l, on: true }) });
    if (offlineOn()) items.push({ separator: true }, { heading: t('translate.offline.title') }, ...offlineItems(), { separator: true }, { label: t('translate.credits.title'), icon: 'info', onSelect: () => openSettings('translate') });
    return items;
  }

  function offlineItems() {
    if (stub()) return [{ note: t('translate.offline.unavailable') }];
    if (offline.state === 'downloading') return [{ note: t('translate.offline.downloading', { pct: percent() }) }, { label: t('translate.offline.cancel'), icon: 'x', onSelect: cancel }];
    const blocked = offline.localMode ? { disabled: true, title: t('local.mode.blocked-feature', { feature: t('translate.offline.title') }) } : {};
    const items = [{ note: t('translate.offline.pivot') }];
    const need = missing();
    if (need.length > 0 && state) items.push({ label: t('translate.offline.download-needed', { from: langName(state.from), to: langName(state.lang), size: size(sumBytes(need)) }), icon: 'download', ...blocked, onSelect: () => download(need) });
    for (const p of packs()) {
      items.push({
        label: langName(p.lang),
        hint: p.installed ? t('translate.offline.pack-installed') : size(p.downloadBytes),
        checked: p.installed,
        submenu: p.installed
          ? [{ label: t('translate.offline.delete-pack', { lang: langName(p.lang), size: size(p.diskBytes) }), icon: 'trash', danger: true, onSelect: () => remove([p.lang]) }]
          : [{ label: t('translate.offline.download-pack', { lang: langName(p.lang), size: size(p.downloadBytes) }), icon: 'download', ...blocked, onSelect: () => download([p.lang]) }],
      });
    }
    return items;
  }

  // ---- botão ao lado das abas ------------------------------------------------------------------------------------------
  // dois botões iguais: um dentro da linha das abas (janela larga) e outro abaixo dela (coluna estreita, onde a linha das abas rola); o CSS mostra um deles
  const splits = [];
  function makeSplit(where) {
    const toggleBtn = el('button', { type: 'button', className: 'tr-btn' }, []);
    const menuBtn = el('button', { type: 'button', className: 'tr-menu-btn' }, []);
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    const split = el('div', { className: `tr-split tr-split-${where}`, hidden: true }, [toggleBtn, menuBtn]);
    split.setAttribute('role', 'group');
    toggleBtn.onclick = () => set({ on: !(state && state.on) });
    menuBtn.onclick = () => window.RiceActionMenu.open({ anchor: menuBtn, items: menuItems() });
    splits.push({ split, toggleBtn, menuBtn });
    return split;
  }
  const split = makeSplit('wide');
  const narrow = makeSplit('narrow');
  const noteNode = el('div', { className: 'tr-note', hidden: true }, []);
  const below = el('div', { className: 'tr-below', hidden: true }, [narrow, noteNode]);

  function noteText() {
    if (notice && notice.kind === 'download-failed') return notice.message;
    if (offlineOn() && offline.state === 'downloading') return t('translate.offline.downloading', { pct: percent() });
    if (!notice) return '';
    return t(`translate.notice.${notice.kind}`);
  }

  function paint() {
    const show = Boolean(state && dir && isRecording(dir));
    below.hidden = !show;
    noteNode.hidden = true;
    for (const x of splits) x.split.hidden = !show;
    if (!show) return;
    const on = state.on;
    for (const { split: sp, toggleBtn, menuBtn } of splits) {
      toggleBtn.replaceChildren(window.RiceIcons.icon('languages'), el('span', { className: 'tr-label', textContent: t('translate.btn') }, []), ...(on ? [el('span', { className: 'tr-code', textContent: state.lang.toUpperCase() }, [])] : []));
      toggleBtn.setAttribute('aria-pressed', String(on));
      toggleBtn.setAttribute('aria-label', on ? t('translate.btn.on', { lang: state.lang.toUpperCase() }) : t('translate.btn'));
      toggleBtn.title = t('translate.btn.title');
      sp.classList.toggle('on', on);
      sp.setAttribute('aria-label', t('translate.btn'));
      menuBtn.replaceChildren(window.RiceIcons.caret());
      menuBtn.setAttribute('aria-label', t('translate.menu'));
      menuBtn.title = t('translate.menu');
    }
    const text = noteText();
    noteNode.hidden = !text;
    noteNode.replaceChildren();
    if (!text) return;
    noteNode.append(el('span', { className: 'tr-note-text', textContent: text }, []));
    const downloading = offlineOn() && offline.state === 'downloading';
    if (downloading) noteNode.append(button(t('translate.offline.cancel'), cancel));
    else if (offlineOn() && !stub() && !offline.localMode && notice && notice.kind !== 'download-failed' && missing().length > 0) noteNode.append(button(t('translate.offline.download-needed', { from: langName(state.from), to: langName(state.lang), size: size(sumBytes(missing())) }), () => download(missing())));
    if (!downloading) noteNode.append(button(t('translate.notice.dismiss'), () => { notice = null; paint(); }, true));
  }

  function button(text, onclick, quiet) {
    const b = el('button', { type: 'button', className: quiet ? 'btn ghost tr-note-btn quiet' : 'btn ghost tr-note-btn', textContent: text }, []);
    b.onclick = onclick;
    return b;
  }

  // ---- Configurações: pacotes de idioma do modelo offline e créditos -----------------------------------------------------
  /** Controle da linha "Modelo offline" das Configurações: um pacote por idioma (tamanho de cada um), escolha de quais baixar, soma, progresso, cancelar e apagar. */
  function offlineControl() {
    const selected = new Set(['en']);
    const status = el('div', { className: 'tr-off-status', role: 'status' }, []);
    const list = el('div', { className: 'tr-packs', role: 'group' }, []);
    list.setAttribute('aria-label', t('translate.offline.title'));
    const actions = el('div', { className: 'tr-off-actions' }, []);
    const box = el('div', { className: 'tr-off' }, [status, list, actions]);
    const draw = () => {
      list.replaceChildren();
      actions.replaceChildren();
      if (stub()) {
        status.textContent = t('translate.offline.unavailable');
        return;
      }
      const busy = offline.state === 'downloading';
      status.textContent = busy ? t('translate.offline.downloading', { pct: percent() }) : offline.state === 'error' ? offline.error || t('translate.offline.failed') : t('translate.offline.cost', { disk: size(diskBytes()), ram: size(offline.ramBytes) });
      for (const p of packs()) {
        const id = `tr-pack-${p.lang}`;
        const input = el('input', { type: 'checkbox', id, checked: p.installed || selected.has(p.lang), disabled: busy || offline.localMode }, []);
        input.onchange = () => {
          if (input.checked) selected.add(p.lang);
          else selected.delete(p.lang);
          draw();
        };
        list.append(el('label', { className: 'tr-pack', htmlFor: id }, [input, el('span', { className: 'tr-pack-name', textContent: langName(p.lang) }, []), el('span', { className: 'tr-pack-size', textContent: p.installed ? t('translate.offline.pack-installed') : size(p.downloadBytes) }, [])]));
      }
      list.append(el('p', { className: 'tr-pivot', textContent: t('translate.offline.pivot') }, []));
      if (busy) {
        actions.append(button(t('translate.offline.cancel'), cancel));
        return;
      }
      const pick = packs().filter((p) => !p.installed && selected.has(p.lang)).map((p) => p.lang);
      const go = button(pick.length > 0 ? t('translate.offline.download-selected', { size: size(sumBytes(pick)) }) : t('translate.offline.download-none'), () => download(pick));
      go.disabled = pick.length === 0 || offline.localMode;
      if (offline.localMode) go.title = t('local.mode.blocked-feature', { feature: t('translate.offline.title') });
      actions.append(go);
      const gone = packs().filter((p) => p.installed && selected.has(p.lang)).map((p) => p.lang);
      if (gone.length > 0) actions.append(button(t('translate.offline.delete-selected', { n: gone.length }), () => remove(gone)));
    };
    offlineWatchers.add(draw);
    draw();
    // limpa quando a tela de Configurações sai do DOM
    const gone = new MutationObserver(() => {
      if (!box.isConnected) {
        offlineWatchers.delete(draw);
        gone.disconnect();
      }
    });
    queueMicrotask(() => gone.observe(document.body, { childList: true, subtree: true }));
    rice.translateOfflineStatus().then((s) => { offline = s; draw(); }).catch(() => {});
    return box;
  }

  /** Créditos e licenças dos modelos (recolhido por padrão). */
  function credits() {
    return el('details', { className: 'tr-credits' }, [
      el('summary', { textContent: t('translate.credits.title') }, []),
      el('p', { textContent: t('translate.credits.body') }, []),
      el('p', { textContent: t('translate.credits.license') }, []),
    ]);
  }

  // ---- ciclo de vida ---------------------------------------------------------------------------------------------------
  function init(options) {
    rice = options.rice;
    follow = options.follow;
    isRecording = options.isRecording;
    redraw = options.redraw;
    openSettings = options.openSettings || (() => {});
    rice.on('translate:result', (r) => {
      if (r.dir !== dir || !state || r.lang !== state.lang) return;
      translations.set(r.key, r.text);
      const row = rows.get(r.key);
      if (row) follow(() => paintRow(r.key, row));
    });
    rice.on('translate:notice', (n) => {
      if (n.dir !== dir) return;
      notice = { kind: n.notice };
      paint();
    });
    rice.on('translate:offline', (s) => {
      offline = s;
      for (const w of offlineWatchers) w();
      paint();
    });
    rice.translateOfflineStatus().then((s) => { offline = s; paint(); }).catch(() => {});
    return { node: split, note: below };
  }

  /** Reunião aberta (ou null): relê o estado e as traduções salvas. As falas já na tela recebem a tradução quando ela chega. */
  async function setDir(next) {
    dir = next;
    state = null;
    notice = null;
    translations = new Map();
    rows.clear();
    paint();
    if (!next) return;
    try {
      const view = await rice.translateGet(next);
      if (dir !== next) return;
      state = view;
      offline = view.offline;
      loadTranslations();
    } catch {
      return; // sem tradução: a transcrição segue normal
    }
    paintRows();
    paint();
    redraw();
  }

  /** Cada linha da transcrição criada na tela se registra aqui (a chave é a própria linha). */
  function attach(line, row) {
    rows.set(line, row);
    paintRow(line, row);
  }

  window.RiceTranslate = { init, setDir, attach, offlineControl, credits, paint, size, offlineEnabled: offlineOn };
})();
