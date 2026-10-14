// Memória entre reuniões: cartão "O que lembrar" (aba Notas), linha do Início e a seção Memória das Configurações.
// Só createElement/textContent: o texto vindo da IA nunca é HTML.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(window.RiceI18n.locale(), { day: 'numeric', month: 'short' }) : '');
  const dueDate = (due) => {
    const [y, m, d] = String(due).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(window.RiceI18n.locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const startOfToday = () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  };
  const isOverdue = (due) => {
    if (!due) return false;
    const [y, m, d] = due.split('-').map(Number);
    return new Date(y, m - 1, d).getTime() < startOfToday();
  };
  const OPEN_KINDS = ['commitment', 'request'];

  /** Link discreto para a reunião de origem. */
  function sourceLink(source, onOpen) {
    const label = `${source.title || t('memory.source-unknown')} · ${shortDate(source.date)}`;
    const b = el('button', { type: 'button', className: 'mem-src', title: t('memory.card.open-source', { title: source.title || '' }) }, [window.RiceIcons.icon('arrow-up-right'), el('span', { textContent: label }, [])]);
    b.onclick = (e) => {
      e.stopPropagation();
      if (source.dir) onOpen(source.dir);
    };
    return b;
  }

  // ---- cartão "O que lembrar" ----
  const COLLAPSED_KEY = 'rice.memory.card.collapsed';
  const readCollapsed = () => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  };
  const writeCollapsed = (v) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      // sem armazenamento: o estado só não fica lembrado
    }
  };

  /** O nome da pessoa (ou da empresa) do fato: link para o detalhe dela na página Memória. */
  function whoLink(b, onPerson) {
    const isMe = String(b.who || '').trim().toLowerCase() === 'eu';
    const name = isMe ? b.org : b.who;
    if (!name || !onPerson) return null;
    const link = el('button', { type: 'button', className: 'mem-who', textContent: name, title: t('memory.who.open', { name }) }, []);
    link.onclick = (e) => {
      e.stopPropagation();
      onPerson(isMe ? 'org' : 'person', name);
    };
    return link;
  }

  function bulletRow(b, onOpen, onPerson) {
    const overdue = !b.done && OPEN_KINDS.includes(b.kind) && isOverdue(b.due);
    const meta = [];
    const who = whoLink(b, onPerson);
    if (who) meta.push(who);
    meta.push(el('span', { className: 'mem-kind', textContent: t(`memory.kind.${b.kind}`) }, []));
    if (b.due && !b.done) meta.push(el('span', { className: 'mem-due' + (overdue ? ' late' : ''), textContent: t('memory.due', { date: dueDate(b.due) }) }, []));
    if (b.done) meta.push(el('span', { className: 'mem-done', textContent: t('memory.done') }, []));
    return el('li', { className: 'mem-bullet' + (b.done ? ' done' : '') + (overdue ? ' late' : '') }, [
      el('span', { className: 'mem-text', textContent: b.text }, []),
      el('span', { className: 'mem-meta' }, [...meta, sourceLink({ dir: b.dir, title: b.title, date: b.date }, onOpen)]),
    ]);
  }

  /** `deps`: { rice, dir, onOpen(dir) }. `node` fica escondido até haver o que lembrar (sem fatos, nada aparece). */
  function card(deps) {
    const { rice } = deps;
    const node = el('section', { className: 'mem-card', hidden: true }, []);
    let collapsed = readCollapsed();
    let brief = null;
    const draw = () => {
      if (!brief || !brief.bullets || brief.bullets.length === 0) {
        node.hidden = true;
        node.replaceChildren();
        return;
      }
      node.hidden = false;
      const toggle = el('button', { type: 'button', className: 'mem-toggle' }, [
        window.RiceIcons.icon(collapsed ? 'chevron-right' : 'chevron-down'),
        el('span', { className: 'mem-title', textContent: t('memory.card.title') }, []),
        ...(collapsed ? [el('span', { className: 'mem-count', textContent: String(brief.bullets.length) }, [])] : []),
      ]);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.onclick = () => {
        collapsed = !collapsed;
        writeCollapsed(collapsed);
        draw();
      };
      const kids = [toggle];
      if (!collapsed) {
        kids.push(el('ul', { className: 'mem-list' }, brief.bullets.map((b) => bulletRow(b, deps.onOpen, deps.onPerson))));
        const recent = (brief.recent || []).filter((r) => r.dir !== deps.dir);
        if (recent.length > 0) {
          kids.push(el('div', { className: 'mem-recent' }, [el('span', { className: 'mem-recent-label', textContent: t('memory.card.recent') }, []), ...recent.map((r) => sourceLink(r, deps.onOpen))]));
        }
      }
      node.replaceChildren(...kids);
    };
    async function load() {
      if (!rice.memoryBriefMeeting) return;
      try {
        brief = await rice.memoryBriefMeeting(deps.dir);
      } catch {
        brief = null;
      }
      draw();
    }
    return { node, load, refresh: load };
  }

  /** Linha secundária do Início: o primeiro ponto e "ver mais" (abre a nota do evento, onde está o cartão). */
  function homeLine(brief, onMore, onPerson) {
    if (!brief || !brief.bullets || brief.bullets.length === 0) return null;
    const first = brief.bullets[0];
    const more = el('button', { type: 'button', className: 'ev-mem-more', textContent: t('memory.home.more') }, []);
    more.onclick = onMore;
    return el('div', { className: 'ev-memory' }, [
      window.RiceIcons.icon('history'),
      el('span', { className: 'ev-mem-label', textContent: t('memory.home.label') }, []),
      ...(whoLink(first, onPerson) ? [whoLink(first, onPerson)] : []),
      el('span', { className: 'ev-mem-text' + (first.due && isOverdue(first.due) && !first.done ? ' late' : ''), textContent: first.text }, []),
      more,
    ]);
  }

  // ---- peças compartilhadas (Configurações e página Memória) ----
  const tn = (key, n, vars) => window.RiceI18n.tn(key, n, vars);
  const defaultTitles = () => ['pt-BR', 'en'].map((l) => window.RiceI18n.dictionaries[l] && window.RiceI18n.dictionaries[l]['meeting.default-title']).filter(Boolean);

  /** Uma linha de fato: tipo, texto (só texto), prazo, link da origem e as ações editar / resolver / apagar. `reload()` redesenha depois de cada ação. */
  function factRow(ctx, f, reload) {
    const { rice } = ctx;
    const text = el('span', { className: 'mem-text', textContent: f.text }, []);
    const kind = el('span', { className: 'mem-kind', textContent: t(`memory.kind.${f.kind}`) + (f.status === 'done' ? ` · ${t('memory.done')}` : '') }, []);
    const actions = el('span', { className: 'mem-actions' }, []);
    const mkBtn = (icon, label, onclick) => {
      const b = el('button', { type: 'button', className: 'icon-btn', title: label }, [window.RiceIcons.icon(icon)]);
      b.setAttribute('aria-label', label);
      b.onclick = onclick;
      return b;
    };
    const rowNode = el('div', { className: 'mem-fact' + (f.status === 'done' ? ' done' : '') }, [
      el('div', { className: 'mem-fact-main' }, [kind, text, ...(f.due && f.status !== 'done' ? [el('span', { className: 'mem-due' + (isOverdue(f.due) ? ' late' : ''), textContent: t('memory.due', { date: dueDate(f.due) }) }, [])] : [])]),
      el('div', { className: 'mem-fact-meta' }, [sourceLink(f.source, ctx.onOpen || (() => {})), actions]),
    ]);
    actions.append(
      mkBtn('pencil', t('memory.fact.edit'), () => {
        const input = el('input', { type: 'text', className: 'mem-edit', value: f.text, maxLength: 300 }, []);
        input.setAttribute('aria-label', t('memory.fact.edit'));
        text.replaceWith(input);
        input.focus();
        let done = false;
        const finish = async (save) => {
          if (done) return;
          done = true;
          if (save && input.value.trim() && input.value.trim() !== f.text) await rice.memoryUpdate(f.id, { text: input.value.trim() });
          reload();
        };
        input.onkeydown = (e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        };
        input.onblur = () => finish(true);
      }),
      ...(OPEN_KINDS.includes(f.kind) ? [mkBtn('check', f.status === 'done' ? t('memory.fact.reopen') : t('memory.fact.resolve'), async () => {
        await rice.followupsSetDone(f.id, f.status !== 'done');
        reload();
      })] : []),
      mkBtn('trash', t('memory.fact.delete'), async () => {
        await rice.memoryRemove(f.id);
        reload();
      }),
    );
    return rowNode;
  }

  /**
   * Bloco das reuniões antigas: ocioso (texto + botão), montando (UMA linha "Montando a memória · 1 de 4" com Cancelar à direita,
   * barra fina de largura total e, em cor secundária e numa linha só, a reunião em processamento) ou o resultado. Some se não há o que montar.
   * `ctx`: { rice, button, confirm }. Devolve { node, refresh }; atualiza sozinho pelos eventos 'memory:progress'/'memory:changed'.
   */
  function backfillBlock(ctx) {
    const { rice } = ctx;
    const node = el('div', { className: 'mem-backfill' }, []);
    const nowLabel = (bf) => {
      const title = String(bf.current || '').trim();
      const generic = !title || defaultTitles().includes(title); // "Agora: Reunião" parece bug: com o título padrão, entra a data
      const date = bf.currentAt ? new Date(bf.currentAt).toLocaleDateString(window.RiceI18n.locale(), { day: 'numeric', month: 'short' }) : '';
      return generic && date ? t('memory.backfill.now-dated', { title: title || t('meeting.default-title'), date }) : t('memory.backfill.now', { title: title || t('meeting.default-title') });
    };
    function paint(s) {
      const bf = s.backfill || { state: 'idle', done: 0, total: 0 };
      if (bf.state === 'running') {
        const cancel = el('button', { type: 'button', className: 'mem-cancel', textContent: t('memory.backfill.cancel') }, []);
        cancel.onclick = () => rice.memoryBackfillCancel();
        const pct = bf.total > 0 ? Math.max(2, Math.min(100, Math.round((bf.done / bf.total) * 100))) : 0;
        const bar = el('div', { className: 'mem-bar', role: 'progressbar' }, [el('span', { style: `width:${pct}%` }, [])]);
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(bf.total));
        bar.setAttribute('aria-valuenow', String(bf.done));
        node.hidden = false;
        node.replaceChildren(
          el('div', { className: 'mem-run' }, [el('span', { className: 'mem-run-text', textContent: t('memory.backfill.progress', { done: bf.done, total: bf.total }) }, []), cancel]),
          bar,
          ...(bf.current ? [el('div', { className: 'mem-now', textContent: nowLabel(bf), title: nowLabel(bf) }, [])] : []),
        );
        return;
      }
      const kids = [];
      const msg = bf.state === 'cancelled' ? t('memory.backfill.cancelled', { done: bf.done, total: bf.total }) : bf.state === 'finished' && s.pendingMeetings === 0 ? tn('memory.backfill.finished', bf.total) : '';
      if (msg) kids.push(el('p', { className: 'set-help', textContent: msg }, []));
      if (s.pendingMeetings > 0) {
        const go = ctx.button(t('memory.backfill.button'), async () => {
          if (!(await ctx.confirm(tn('memory.backfill.confirm', s.pendingMeetings), t('memory.backfill.button')))) return;
          go.disabled = true;
          await rice.memoryBackfillStart();
          refresh();
        }, 'ghost');
        go.disabled = s.enabled === false;
        kids.unshift(el('div', { className: 'set-label', textContent: t('memory.backfill.title') }, []), el('p', { className: 'set-help', textContent: tn('memory.backfill.help', s.pendingMeetings) }, []), go);
      }
      node.hidden = kids.length === 0; // nada a montar e nada a dizer: o bloco não aparece
      node.replaceChildren(...kids);
    }
    async function refresh() {
      const s = await rice.memoryStatus().catch(() => null);
      if (s) paint(s);
      return s;
    }
    if (rice.on) {
      const again = () => {
        if (node.isConnected) refresh();
      };
      rice.on('memory:progress', again);
      rice.on('memory:changed', again);
    }
    return { node, refresh, paint };
  }

  // ---- seção Memória (Configurações): só a opção, as reuniões antigas, o link para a página e a área de apagar ----
  /** `ctx`: { rice, settings, row, toggle, button, confirm, onOpenMemory() }. */
  function settingsNodes(ctx) {
    const { rice } = ctx;
    const on = ctx.toggle('memory-enabled', ctx.settings.memory !== false, t('settings.memory.label'));
    on.onchange = async () => {
      await rice.memorySetEnabled(on.checked);
      window.dispatchEvent(new CustomEvent('rice:memory-changed'));
    };
    const open = ctx.button(t('memory.open-page'), () => ctx.onOpenMemory && ctx.onOpenMemory(), 'ghost');
    const openHelp = el('span', { className: 'mem-open-help' }, []);
    const openRow = ctx.row(t('memory.open-label'), null, open);
    const helpSlot = openRow.querySelector('.set-text');
    helpSlot.append(openHelp);
    const backfill = backfillBlock(ctx);
    const backfillRow = el('div', { className: 'set-row mem-backfill-row', hidden: true }, [backfill.node]);
    const danger = el('section', { className: 'mem-danger', hidden: true }, []);
    const clear = ctx.button(t('memory.clear'), async () => {
      if (!(await ctx.confirm(t('memory.clear.confirm'), t('memory.clear')))) return;
      await rice.memoryClear();
      refresh();
    }, 'ghost');
    clear.classList.add('danger-text');
    danger.append(el('h3', { className: 'mem-danger-title', textContent: t('memory.danger.title') }, []), el('p', { className: 'set-help', textContent: t('memory.danger.text') }, []), clear);
    async function refresh() {
      const s = await rice.memoryStatus().catch(() => null);
      if (!s) return;
      backfill.paint(s);
      backfillRow.hidden = backfill.node.hidden;
      const has = s.facts > 0;
      openRow.hidden = !has; // memória vazia: a página explica; aqui não há o que abrir
      openHelp.textContent = has ? [tn('memory.n-facts', s.facts), tn('memory.n-people', s.people), tn('memory.n-orgs', s.orgs)].join(' · ') : '';
      openHelp.className = 'mem-open-help set-help';
      danger.hidden = !has; // sem fatos não há o que apagar
    }
    refresh();
    if (rice.on) {
      const again = () => {
        if (openRow.isConnected) refresh();
      };
      rice.on('memory:progress', again);
      rice.on('memory:changed', again);
    }
    return [ctx.row(t('settings.memory.label'), t('settings.memory.help'), on), openRow, backfillRow, danger];
  }

  window.RiceMemory = { card, homeLine, settingsNodes, backfillBlock, factRow, sourceLink, isOverdue, dueDate, shortDate };
})();
