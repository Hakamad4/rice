// "Ideias" e "Investigação" (War room): abas da PÁGINA da reunião. Este módulo guarda o estado (rice.warRoomGet) e desenha o conteúdo de cada aba. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const INTERVALS = [2, 5, 10, 15];

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  function switchInput(checked, label, onchange) {
    const input = el('input', { type: 'checkbox', checked: Boolean(checked), className: 'switch' }, []);
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', label);
    input.onchange = () => onchange(input);
    return input;
  }

  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(window.RiceI18n.locale(), { hour: '2-digit', minute: '2-digit' }) : '');
  const TOOLS_SHOWN = 20;
  const basename = (path) => String(path).split(/[\\/]/).pop();
  const domainOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };
  /** Padrão do Grep → primeiro termo legível: 1ª alternativa, sem escapes/regex, até 30 caracteres. */
  const grepTerm = (pattern) => {
    const first = String(pattern).split('|')[0].replace(/\\[a-zA-Z]/g, '').replace(/[\\?*+()[\]{}^$]/g, '').trim();
    return first.length > 30 ? `${first.slice(0, 30)}…` : first;
  };
  /** Uma linha por chamada: `icon` é o ícone de linha do tipo, `text` o resumo curto e `title` o detalhe completo. */
  function toolEntry(x) {
    const detail = x.detail || '';
    const named = (key, vars) => (detail ? t(key, vars) : x.tool);
    if (x.server === 'web') {
      if (x.tool === 'WebFetch') return { icon: 'globe', text: named('warroom.log.fetch', { domain: domainOf(detail) }), title: detail };
      return { icon: 'globe', text: named('warroom.log.search', { query: detail }), title: detail };
    }
    if (x.server === 'file') {
      if (x.tool === 'Read') return { icon: 'file-text', text: named('warroom.log.read', { name: basename(detail) }), title: detail };
      if (x.tool === 'Grep') return { icon: 'search', text: named('warroom.log.grep', { term: grepTerm(detail) }), title: detail };
      if (x.tool === 'Glob') return { icon: 'folder', text: named('warroom.log.glob', { pattern: detail }), title: detail };
      return { icon: 'plug', text: x.tool, title: detail };
    }
    const name = `${x.server} · ${x.tool}`;
    return { icon: 'plug', text: name, title: name };
  }
  const SRC_LABEL = { web: 'warroom.src.web', mcp: 'warroom.src.mcp', folder: 'warroom.src.folder' };

  /**
   * `deps`: { rice, indicator, confirm(lines, label), warn(msg), getAnnotations(), setAnnotations(text), onUpdate() }.
   * Devolve { setDir(dir|null), refresh(), isWar(), pending(), view(id), setKind(kind) }; `view('ideas'|'war')` devolve os nós da aba.
   */
  function create(deps) {
    const { rice, indicator } = deps;
    let dir = null;
    let data = null;

    const seenMemory = new Map();
    const seenIds = () => {
      if (seenMemory.has(dir)) return seenMemory.get(dir);
      try {
        const all = JSON.parse(localStorage.getItem('rice.factsSeen') || '{}') || {};
        return new Set(Array.isArray(all[dir]) ? all[dir] : []);
      } catch {
        return new Set();
      }
    };
    const sourcesOn = () => (data ? ['web', 'folder', 'mcp'].filter((k) => (k === 'folder' ? data.cfg.sources.folder : data.cfg.sources[k])) : []);

    function paintIndicator() {
      const war = data && data.cfg.kind === 'warroom';
      indicator.hidden = !war;
      if (!war) return;
      indicator.textContent = [t('warroom.indicator'), ...sourcesOn().map((k) => t(SRC_LABEL[k]))].join(' · ');
    }

    async function setSource(key, input) {
      if (input.checked && !(await deps.confirm([t('warroom.src.warn1'), t('warroom.src.warn2'), t('warroom.src.warn3')], t('warroom.src.confirm')))) {
        input.checked = false;
        return;
      }
      await rice.warRoomSet(dir, { [key]: input.checked });
    }

    function folderControl() {
      const folder = data.cfg.sources.folder;
      const box = el('div', { className: 'wr-folder' }, []);
      const pick = el('button', { type: 'button', className: 'btn ghost', textContent: t(folder ? 'warroom.src.folder.change' : 'warroom.src.folder.pick'), disabled: !data.support.folder.available }, []);
      pick.onclick = async () => {
        if (!(await deps.confirm([t('warroom.src.warn1'), t('warroom.src.warn2'), t('warroom.src.warn3')], t('warroom.src.confirm')))) return;
        const result = await rice.warRoomPickFolder(dir);
        if (result && result.ok === false) deps.warn(result.message);
      };
      if (folder) box.append(el('span', { className: 'wr-path', textContent: folder.split('/').slice(-2).join('/'), title: folder }, []));
      box.append(pick);
      if (folder) {
        const clear = el('button', { type: 'button', className: 'btn ghost', textContent: t('warroom.src.folder.clear') }, []);
        clear.onclick = () => rice.warRoomSet(dir, { clearFolder: true });
        box.append(clear);
      }
      return box;
    }

    // contagem regressiva: um único relógio de 1 s repinta só os rótulos que ainda estão na tela
    const nextLabels = new Set();
    // o relógio só existe enquanto há rótulo na tela (ocioso, nenhum timer acorda o renderer)
    let ticker = null;
    const ensureTicker = () => {
      if (ticker) return;
      ticker = setInterval(() => {
        for (const node of nextLabels) {
          if (node.isConnected) node.paint();
          else nextLabels.delete(node);
        }
        if (nextLabels.size === 0) {
          clearInterval(ticker);
          ticker = null;
        }
      }, 1000);
    };
    const mmss = (ms) => {
      const total = Math.max(0, Math.ceil(ms / 1000));
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    };

    /**
     * Rodapé de controles da aba (o MESMO nas Ideias e na Investigação), numa linha só:
     * à esquerda o switch da trilha + o intervalo (28px) + o status (12px --muted); à direita a ação ("Gerar/Investigar agora", que vira "Parar" durante um ciclo).
     * `below`: aviso de pouca fala e o erro do último ciclo com "Tentar agora".
     */
    /** "Tipo: Geral ▾": o MESMO seletor dos templates de notas (menu com busca, prévia ao lado no hover/foco e "Gerenciar templates…"). */
    function typeSelector() {
      const list = data.ideaTemplates || [];
      return window.RiceTemplatePicker.create({
        templates: list,
        selectedId: data.ideaTemplateId,
        kind: 'ideas',
        labelPrefix: t('warroom.type.prefix'),
        onManage: () => deps.onManageIdeaTemplates && deps.onManageIdeaTemplates(),
        onChoose: (id) => rice.warRoomSet(dir, { ideaTemplate: id }),
      }).root;
    }

    function statusBlock(war) {
      const st = data.state;
      const mine = war ? st.investigation : st; // cada trilha tem o seu próximo ciclo, erro e aviso
      const paused = war && data.cfg.investigation.paused;
      const on = war ? !paused : data.cfg.ideas.on;
      const label = t(war ? 'warroom.inv.active' : 'warroom.ideas.on'); // nome completo para leitores de tela e tooltip; na barra só "Ativa"
      const toggle = el('label', { className: 'wr-toggle', title: label }, [
        switchInput(on, label, (i) => rice.warRoomSet(dir, war ? { investigationPaused: !i.checked } : { ideasOn: i.checked })),
        el('span', { textContent: t('warroom.tb.on') }, []),
      ]);
      // status DENTRO da barra, logo depois dos seletores: "· 6/120 ciclos · próximo em 1:20", "· pausada" ou "· aguardando gravação" (a frase longa vira o tooltip)
      const text = el('span', { className: 'wr-next' }, []);
      text.paint = () => {
        const left = mine.nextAt ? mine.nextAt - Date.now() : null;
        text.title = '';
        if (paused) return void (text.textContent = `· ${t('warroom.tb.paused')}`);
        if (!war && !on) return void (text.textContent = '');
        if (!data.recording) {
          text.title = t(war ? 'warroom.idle-rec.war' : 'warroom.idle-rec'); // só quando NÃO está gravando
          return void (text.textContent = `· ${t('warroom.tb.waiting')}`);
        }
        const next = st.running ? t(war ? 'warroom.running' : 'warroom.generating') : left === null ? '' : left <= 1000 ? t(war ? 'warroom.next.soon.war' : 'warroom.next.soon') : t(war ? 'warroom.tb.next.war' : 'warroom.tb.next', { time: mmss(left) });
        text.textContent = `· ${[cycleText(), next].filter(Boolean).join(' · ')}`;
      };
      // contagem da trilha desta aba; com limite mostra "n/max", sem limite só "n"
      const count = war ? data.cycles.investigation : data.cycles.ideas;
      const cycleText = () => (data.limit > 0 ? t('warroom.cycles', { n: count, max: data.limit }) : t('warroom.cycles.unlimited', { n: count }));
      const reached = data.limit > 0 && count >= data.limit;
      text.paint();
      nextLabels.add(text);
      ensureTicker();
      // barra de ferramentas: [switch + Ativa] [intervalo] [Tipo, nas Ideias] [status]
      const lead = el('span', { className: 'wr-foot-lead' }, [toggle]);
      if (on) {
        const interval = window.RiceMenuSelect.create({
          items: INTERVALS.map((n) => ({ value: n, label: t('warroom.ideas.every', { n }) })),
          value: war ? data.cfg.investigation.intervalMin : data.cfg.ideas.intervalMin,
          ariaLabel: t(war ? 'warroom.inv.interval' : 'warroom.ideas.interval'),
          onChoose: (n) => rice.warRoomSet(dir, war ? { investigationMin: Number(n) } : { intervalMin: Number(n) }),
        });
        lead.append(interval.root);
      }
      if (!war) lead.append(typeSelector());
      lead.append(text);
      // durante um ciclo o botão vira "Parar" (aborta o ciclo atual, sem erro)
      const disabledWhy = !data.recording ? t('warroom.disabled.rec') : paused ? t('warroom.disabled.paused') : !war && !on ? t('warroom.disabled.off') : reached ? t('warroom.disabled.limit') : '';
      const action = st.running
        ? el('button', { type: 'button', className: 'btn ghost wr-stop' }, [window.RiceIcons.icon('square'), el('span', { textContent: t('warroom.stop') }, [])])
        : el('button', { type: 'button', className: 'btn ghost wr-run', disabled: Boolean(disabledWhy), ...(disabledWhy ? { title: disabledWhy } : {}) }, [window.RiceIcons.icon(war ? 'search' : 'sparkles'), el('span', { textContent: t(war ? 'warroom.now.war' : 'warroom.now') }, [])]);
      action.onclick = () => (st.running ? rice.warRoomStop(dir) : rice.warRoomRunNow(dir, war ? 'investigation' : 'ideas'));
      const below = [];
      if (reached) {
        // limite da trilha atingido: para de gastar; "Continuar" libera mais ciclos só nesta reunião
        const more = el('button', { type: 'button', className: 'btn ghost', textContent: t('warroom.limit.more', { n: data.moreStep }) }, []);
        more.onclick = () => rice.warRoomSet(dir, { moreCycles: true });
        below.push(el('div', { className: 'wr-limit', role: 'status' }, [el('span', { textContent: t('warroom.limit.reached') }, []), more]));
      }
      if (mine.note === 'little-speech') below.push(el('p', { className: 'wr-note', textContent: t(war ? 'warroom.little.war' : 'warroom.little') }, []));
      if (mine.error) {
        const retry = el('button', { type: 'button', className: 'btn ghost', textContent: t('warroom.retry'), disabled: st.running || !data.recording }, []);
        retry.onclick = () => rice.warRoomRunNow(dir, war ? 'investigation' : 'ideas');
        const err = el('div', { className: 'wr-error' }, [el('span', { className: 'wr-error-text', textContent: mine.error, title: mine.error }, []), retry]);
        err.setAttribute('role', 'alert');
        below.push(err);
      }
      return { text: lead, action, below };
    }

    /** Caixa leve (fundo --hover, divisores --line) com linhas de 48px: ícone · nome + descrição curta · controle à direita. */
    function boxRow(icon, name, help, control, extraClass) {
      return el('div', { className: 'wr-box-row' + (extraClass ? ` ${extraClass}` : '') }, [
        el('span', { className: 'wr-box-ico' }, [window.RiceIcons.icon(icon)]),
        el('span', { className: 'wr-box-text' }, [el('span', { className: 'wr-box-name', textContent: name }, []), el('span', { className: 'wr-box-help', textContent: help, title: help }, [])]),
        el('span', { className: 'wr-box-control' }, control ? (Array.isArray(control) ? control : [control]) : []),
      ]);
    }

    /** "Continuar no terminal ▾": abre o CLI do usuário (só os detectados) com o prompt de investigação, ou copia o prompt. */
    function handoffButton() {
      const button = el('button', { type: 'button', className: 'btn ghost wr-handoff' }, [el('span', { textContent: t('warroom.handoff.button') }, []), window.RiceIcons.icon('chevron-down')]);
      button.setAttribute('aria-haspopup', 'menu');
      const run = async (target) => {
        const result = await rice.warRoomHandoff(dir, target);
        if (!result || result.canceled) return;
        if (result.ok === false) return deps.warn(result.message);
        if (target === 'copy') {
          if ((await rice.copyText(result.prompt)) === true && deps.notice) deps.notice(t('warroom.handoff.copied'));
          return;
        }
        if (deps.notice) deps.notice(t('warroom.handoff.opened', { label: result.label }));
      };
      button.onclick = async () => {
        const list = (await rice.warRoomHarnesses().catch(() => [])) || [];
        window.RiceActionMenu.open({
          anchor: button,
          items: [
            ...(list.length > 0 ? list.map((h) => ({ label: h.label, onSelect: () => run(h.id) })) : [{ label: t('warroom.handoff.none'), disabled: true, onSelect: () => {} }]),
            { separator: true },
            { label: t('warroom.handoff.copy'), onSelect: () => run('copy') },
            { separator: true },
            { label: t('warroom.handoff.note'), disabled: true, title: t('warroom.handoff.note'), onSelect: () => {} },
          ],
        });
      };
      button.title = t('warroom.handoff.note'); // o aviso do outro harness: tooltip do botão e linha no rodapé do MENU
      return button;
    }

    /** Barra de ferramentas da aba (a MESMA nas Ideias e na Investigação): contêiner único com controles de 32px; à esquerda switch + intervalo [+ tipo] + status, à direita os botões. `solo`: sem margem acima (Ideias). */
    function footer(status, extra, solo) {
      return el('div', { className: 'wr-foot' + (solo ? ' solo' : '') }, [status.text, el('span', { className: 'wr-foot-actions' }, [...(extra || []), status.action])]);
    }

    /** Descrição fixa no topo da aba: UM parágrafo (13px, --muted) com "Saiba mais" inline, que abre o guia no passo certo. */
    function description(key) {
      const more = el('button', { type: 'button', className: 'link-button', textContent: t('warroom.learn-more') }, []);
      more.onclick = () => deps.onLearnMore && deps.onLearnMore();
      return el('p', { className: 'wr-desc' }, [document.createTextNode(`${t(key)}\u00a0`), more]); // espaço sem quebra: "Saiba mais" nunca cai sozinho numa linha
    }

    /** "Ferramentas usadas (N) ▸": recolhida por padrão; ao abrir, até 20 linhas de 24px (ícone de tipo 14px + texto 12px --muted), mais recentes primeiro. */
    function toolsLog(tools) {
      const shown = tools.slice(-TOOLS_SHOWN).reverse();
      const items = shown.map((x) => {
        const entry = toolEntry(x);
        return el('li', { className: 'wr-tool', title: entry.title }, [window.RiceIcons.icon(entry.icon), el('span', { textContent: entry.text }, [])]);
      });
      if (tools.length > shown.length) items.push(el('li', { className: 'wr-tool wr-tool-more', textContent: t('warroom.log.more', { n: tools.length - shown.length }) }, []));
      const chevron = window.RiceIcons.icon('chevron-right');
      chevron.classList.add('wr-chev');
      return el('details', { className: 'wr-tools' }, [el('summary', {}, [el('span', { textContent: t('warroom.log.count', { n: tools.length }) }, []), chevron]), el('ul', { className: 'wr-log' }, items)]);
    }

    /** Nota discreta sobre as fontes indisponíveis: ícone de info, 12px --muted e "Trocar IA" (abre Configurações de IA). */
    function sourceNote(text, provider) {
      const change = el('button', { type: 'button', className: 'link-button', textContent: t('warroom.src.change-ai') }, []);
      change.onclick = () => deps.onChangeAi && deps.onChangeAi(provider);
      return el('p', { className: 'wr-src-note' }, [window.RiceIcons.icon('info'), el('span', { textContent: text }, []), change]);
    }

    /** Estado vazio discreto: ícone de linha e texto de 13px NA MESMA linha, alinhados à esquerda. */
    function emptyState(icon, text) {
      return el('div', { className: 'wr-empty inline' }, [window.RiceIcons.icon(icon), el('span', { textContent: text }, [])]);
    }

    // filtro "Todos | Fixados" de cada lista (fica enquanto o app está aberto)
    const listFilter = { ideas: 'all', war: 'all' };
    /** Cabeçalho da lista: título à esquerda e o filtro Todos/Fixados à direita (mesmo nas Ideias e na Investigação). */
    function listHead(track, title, total, pinned) {
      const chip = (value, label, n) => {
        const b = el('button', { type: 'button', className: 'wr-filter-btn' + (listFilter[track] === value ? ' active' : ''), textContent: `${label} ${n}` }, []);
        b.setAttribute('aria-pressed', String(listFilter[track] === value));
        b.onclick = () => { listFilter[track] = value; if (deps.onUpdate) deps.onUpdate(); };
        return b;
      };
      return el('div', { className: 'wr-list-head' }, [
        el('h3', { className: 'wr-section', textContent: title }, []),
        el('div', { className: 'wr-filter', role: 'group' }, [chip('all', t('warroom.filter.all'), total), chip('pinned', t('warroom.filter.pinned'), pinned)]),
      ]);
    }

    function ideasView() {
      const status = statusBlock(false);
      const bar = footer(status, [], true);
      if (data.ideas.length === 0) return [description('warroom.ideas.desc'), bar, ...status.below, emptyState('lightbulb', t('warroom.ideas.empty'))];
      const list = el('div', { className: 'wr-list' }, []);
      const pinnedIdeas = data.ideas.filter((i) => i.pinned);
      const shown = listFilter.ideas === 'pinned' ? pinnedIdeas : data.ideas;
      const head = listHead('ideas', t('warroom.ideas.title'), data.ideas.length, pinnedIdeas.length);
      if (shown.length === 0) list.append(emptyState('pin', t('warroom.filter.empty.ideas')));
      for (const idea of [...shown].reverse()) {
        const pin = el('button', { type: 'button', className: 'btn ghost', textContent: t(idea.pinned ? 'warroom.ideas.pinned' : 'warroom.ideas.pin'), disabled: Boolean(idea.pinned) }, []);
        pin.onclick = async () => {
          const result = await rice.warRoomIdea(dir, idea.id, 'pin', deps.getAnnotations());
          if (result && result.ok && typeof result.annotations === 'string') deps.setAnnotations(result.annotations);
        };
        const drop = el('button', { type: 'button', className: 'btn ghost', textContent: t('warroom.ideas.dismiss') }, []);
        drop.onclick = () => rice.warRoomIdea(dir, idea.id, 'dismiss');
        list.append(el('div', { className: 'wr-card' + (idea.pinned ? ' pinned' : '') }, [
          el('small', { className: 'wr-time', textContent: `${clock(idea.at)} · ${idea.category || t(`warroom.idea-kind.${idea.kind === 'question' || idea.kind === 'risk' ? idea.kind : 'idea'}`)}` }, []),
          // selo discreto quando a ideia veio de OUTRO template que não o atual
          ...(idea.templateId && idea.templateId !== data.ideaTemplateId && idea.templateTitle ? [el('span', { className: 'wr-idea-tag', textContent: idea.templateTitle }, [])] : []),
          el('p', { textContent: idea.text }, []),
          el('div', { className: 'wr-actions' }, [pin, drop]),
        ]));
      }
      return [description('warroom.ideas.desc'), bar, ...status.below, head, list];
    }

    /** Reunião que não é War room: um bloco só (caixa leve): ícone e título na mesma linha, uma linha de explicação e as ações à direita. */
    function notWarView() {
      const go = el('button', { type: 'button', className: 'btn primary', textContent: t('warroom.make.go') }, []);
      go.onclick = () => rice.warRoomSet(dir, { kind: 'warroom' });
      const cta = el('div', { className: 'wr-cta' }, [
        el('div', { className: 'wr-cta-text' }, [
          el('div', { className: 'wr-cta-title' }, [window.RiceIcons.icon('radar'), el('span', { textContent: t('warroom.make') }, [])]),
          el('p', { textContent: t('warroom.make.help') }, []),
        ]),
        el('div', { className: 'wr-cta-actions' }, [go, handoffButton()]),
      ]);
      return [description('warroom.war.desc'), cta];
    }

    // ---- achados: entram direto na lista (mais recentes primeiro); fixados no topo; descartar com "Desfazer" por alguns segundos
    const undoable = new Map(); // id → { fact, timer }
    const UNDO_MS = 6000;
    const dismissFact = async (f) => {
      await rice.warRoomFact(dir, f.id, 'dismiss');
      clearTimeout(undoable.get(f.id) && undoable.get(f.id).timer);
      undoable.set(f.id, { fact: f, timer: setTimeout(() => { undoable.delete(f.id); if (deps.onUpdate) deps.onUpdate(); }, UNDO_MS) });
    };
    const undoFact = async (id) => {
      const entry = undoable.get(id);
      if (entry) clearTimeout(entry.timer);
      undoable.delete(id);
      await rice.warRoomFact(dir, id, 'undo');
    };
    const sourceLabel = (f) => f.source.ref || f.source.type;
    const clickable = (f) => f.source.type === 'url' || f.source.type === 'file';

    function factCard(f) {
      const undo = undoable.get(f.id);
      if (f.dismissed) {
        if (!undo) return null;
        const back = el('button', { type: 'button', className: 'link-button', textContent: t('warroom.facts.undo') }, []);
        back.onclick = () => undoFact(f.id);
        return el('div', { className: 'wr-card wr-card-gone' }, [el('span', { textContent: t('warroom.facts.dismissed') }, []), back]);
      }
      const pin = el('button', { type: 'button', className: 'icon-btn wr-pin', title: t(f.pinned ? 'warroom.facts.unpin' : 'warroom.facts.pin') }, [window.RiceIcons.icon('pin')]);
      pin.setAttribute('aria-label', t(f.pinned ? 'warroom.facts.unpin' : 'warroom.facts.pin'));
      pin.setAttribute('aria-pressed', String(Boolean(f.pinned)));
      pin.onclick = () => rice.warRoomFact(dir, f.id, f.pinned ? 'unpin' : 'pin');
      const drop = el('button', { type: 'button', className: 'btn ghost wr-drop', textContent: t('warroom.facts.dismiss') }, []);
      drop.onclick = () => dismissFact(f);
      const source = clickable(f)
        ? el('button', { type: 'button', className: 'link-button wr-source', textContent: sourceLabel(f), title: f.source.ref }, [])
        : el('small', { className: 'wr-source', textContent: sourceLabel(f), title: f.source.ref }, []);
      if (clickable(f)) source.onclick = async () => {
        const result = await rice.warRoomOpenSource(dir, f.id);
        if (result && result.ok === false && result.message) deps.warn(result.message);
      };
      return el('div', { className: 'wr-card wr-finding' + (f.pinned ? ' pinned' : '') }, [
        el('p', { textContent: f.text }, []),
        el('div', { className: 'wr-meta' }, [source, el('small', { className: 'wr-time', textContent: clock(f.at) }, []), el('span', { className: 'wr-card-actions' }, [pin, drop])]),
      ]);
    }

    function findingsView() {
      const all = data.cfg.facts.filter((f) => !f.dismissed || undoable.has(f.id));
      const live = all.filter((f) => !f.dismissed);
      if (live.length === 0 && all.length === 0) return [emptyState('search', t(data.cfg.sources.web || data.cfg.sources.mcp || data.cfg.sources.folder ? 'warroom.facts.empty.on' : 'warroom.facts.empty'))];
      const ordered = [...all].reverse(); // mais recentes primeiro
      const pinned = ordered.filter((f) => f.pinned && !f.dismissed);
      const sorted = listFilter.war === 'pinned' ? pinned : [...pinned, ...ordered.filter((f) => !(f.pinned && !f.dismissed))];
      const head = listHead('war', t('warroom.facts.title'), live.length, pinned.length);
      const cards = sorted.map(factCard).filter(Boolean);
      return [head, ...(cards.length ? cards : [emptyState('pin', t('warroom.filter.empty.facts'))])];
    }

    function warView() {
      const status = statusBlock(true);
      const row = (key, icon) => {
        const info = data.support[key];
        const on = key === 'folder' ? Boolean(data.cfg.sources.folder) : data.cfg.sources[key];
        let control;
        if (key === 'folder') control = folderControl();
        else {
          control = switchInput(on, t(SRC_LABEL[key]), (input) => setSource(key, input));
          control.disabled = !info.available;
        }
        // a descrição é sempre a normal; o motivo de indisponibilidade fica só na nota acima da caixa
        return boxRow(icon, t(SRC_LABEL[key]), t(`warroom.src.${key}.help`), control, info.available ? '' : 'off');
      };
      const sources = el('div', { className: 'wr-panel' }, [el('div', { className: 'wr-box' }, [row('web', 'globe'), row('mcp', 'plug'), row('folder', 'folder')]), footer(status)]);
      // seção própria: seguir a investigação no CLI do usuário (antes era só um botão "Terminal" no rodapé, sem explicação)
      const terminal = el('div', { className: 'wr-box wr-term' }, [boxRow('terminal', t('warroom.term.title'), t('warroom.term.help'), handoffButton())]);
      const note = data.note ? [sourceNote(data.note, data.provider)] : [];
      const blocks = findingsView();
      const log = data.state.tools.length ? [toolsLog(data.state.tools)] : [];
      return [description('warroom.war.desc'), ...note, sources, ...status.below, terminal, ...blocks, ...log];
    }

    async function refresh() {
      if (!dir) return;
      try {
        data = await rice.warRoomGet(dir);
      } catch {
        data = null;
      }
      paintIndicator();
      if (deps.onUpdate) deps.onUpdate();
    }

    rice.on('warroom:update', (p) => {
      if (p && p.dir === dir) refresh();
    });

    return {
      async setDir(next) {
        if (next !== dir) {
          dir = next;
          data = null;
        }
        if (!dir) {
          paintIndicator();
          return;
        }
        await refresh();
      },
      refresh,
      isWar: () => Boolean(data && data.cfg.kind === 'warroom'),
      kind: () => (data ? data.cfg.kind : 'meeting'),
      ready: () => Boolean(data),
      /** Achados ainda por validar (contador discreto da aba Investigação). */
      /** Achados NOVOS desde a última vez que a aba Investigação foi vista (contador da aba). */
      unseen: () => (data ? data.cfg.facts.filter((f) => !f.dismissed && !seenIds().has(f.id)).length : 0),
      markSeen: () => {
        if (!data) return;
        const ids = data.cfg.facts.map((f) => f.id).slice(-300);
        try {
          const all = JSON.parse(localStorage.getItem('rice.factsSeen') || '{}') || {};
          all[dir] = ids;
          const keys = Object.keys(all);
          for (const old of keys.slice(0, Math.max(0, keys.length - 100))) delete all[old];
          localStorage.setItem('rice.factsSeen', JSON.stringify(all));
        } catch {
          seenMemory.set(dir, new Set(ids));
        }
        seenMemory.set(dir, new Set(ids));
      },
      setKind: (kind) => rice.warRoomSet(dir, { kind }),
      view: (id) => (!data ? [] : id === 'ideas' ? ideasView() : data.cfg.kind === 'warroom' ? warView() : notWarView()),
    };
  }

  window.RiceWarRoom = { create };
})();
