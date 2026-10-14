// Página "Memória": quem e quais empresas o Rice lembra, e o detalhe de cada uma (pendências em aberto, decisões, contexto, últimas
// reuniões e as ações de editar, resolver, apagar e esquecer). Só createElement/textContent: o texto da IA nunca é HTML.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const tn = (key, n, vars) => window.RiceI18n.tn(key, n, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const OPEN_KINDS = ['commitment', 'request'];
  const isOpenFollowup = (f) => OPEN_KINDS.includes(f.kind) && f.status === 'open';
  const uniq = (list) => [...new Set(list.filter(Boolean))];

  /**
   * `deps`: { rice, onOpenMeeting(dir), confirm(message, label), button(text, onclick, kind) }.
   * `render(container, target?)`: `target` = { kind: 'person' | 'org', name } abre direto o detalhe (links do cartão e do Início).
   */
  function create(deps) {
    const { rice } = deps;
    let tab = 'people';
    let selected = null;
    let box = null;
    let seq = 0;
    let backfill = null;

    const entityKind = () => (tab === 'orgs' ? 'org' : 'person');
    const subOf = (kind, facts) => (kind === 'person' ? uniq(facts.map((f) => f.org)).slice(0, 2).join(', ') : uniq(facts.map((f) => f.who).filter((w) => w !== 'Eu')).slice(0, 3).join(', '));

    function entityRow(kind, g) {
      const open = g.facts.filter(isOpenFollowup).length;
      const sub = subOf(kind, g.facts);
      const row = el('button', { type: 'button', className: 'mp-entity' }, [
        el('span', { className: 'mp-entity-text' }, [el('span', { className: 'mp-entity-name', textContent: g.name }, []), ...(sub ? [el('span', { className: 'mp-entity-sub', textContent: sub }, [])] : [])]),
        el('span', { className: 'mp-entity-meta' }, [
          ...(open > 0 ? [el('span', { className: 'mp-open', textContent: tn('memory.open-count', open) }, [])] : []),
          el('span', { className: 'mp-facts', textContent: tn('memory.n-facts', g.facts.length) }, []),
          window.RiceIcons.icon('chevron-right'),
        ]),
      ]);
      row.onclick = () => openEntity(kind, g.name);
      return row;
    }

    function tabsAndSearch(search) {
      const tabs = el('div', { className: 'mp-tabs', role: 'tablist' }, ['people', 'orgs'].map((id) => {
        const b = el('button', { type: 'button', className: 'mp-tab', textContent: t(`memory.tab.${id}`) }, []);
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(id === tab));
        b.onclick = () => {
          tab = id;
          draw();
        };
        return b;
      }));
      return el('div', { className: 'mp-head' }, [tabs, search]);
    }

    async function drawList() {
      const mine = ++seq;
      const status = await rice.memoryStatus().catch(() => null);
      if (mine !== seq || !box || !box.isConnected) return;
      const body = box.querySelector('.mp-body');
      if (!status || status.facts === 0) {
        backfill = window.RiceMemory.backfillBlock({ rice, button: deps.button, confirm: deps.confirm });
        backfill.paint(status || { backfill: { state: 'idle' }, pendingMeetings: 0 });
        body.replaceChildren(el('div', { className: 'mp-empty' }, [
          el('span', { className: 'mp-empty-icon' }, [window.RiceIcons.icon('history')]),
          el('h2', { textContent: t('memory.empty.title') }, []),
          el('p', { textContent: t('memory.empty.text') }, []),
          backfill.node,
        ]));
        return;
      }
      const search = el('input', { type: 'search', className: 'mp-search', placeholder: t('memory.search'), autocomplete: 'off', spellcheck: false, value: box.dataset.q || '' }, []);
      search.setAttribute('aria-label', t('memory.search'));
      const list = el('div', { className: 'mp-list' }, []);
      const fill = async () => {
        const data = await rice.memoryList(search.value).catch(() => ({ people: [], orgs: [] }));
        if (!list.isConnected && list.parentNode) return;
        const groups = tab === 'people' ? data.people : data.orgs;
        list.replaceChildren(...(groups.length === 0 ? [el('p', { className: 'mp-none', textContent: t('memory.empty-search') }, [])] : groups.map((g) => entityRow(entityKind(), g))));
      };
      let timer = null;
      search.oninput = () => {
        box.dataset.q = search.value;
        clearTimeout(timer);
        timer = setTimeout(fill, 200);
      };
      const running = status.backfill && status.backfill.state === 'running';
      if (running) {
        backfill = window.RiceMemory.backfillBlock({ rice, button: deps.button, confirm: deps.confirm });
        backfill.paint(status);
      }
      body.replaceChildren(...(running ? [el('div', { className: 'mp-progress' }, [backfill.node])] : []), tabsAndSearch(search), list);
      await fill();
    }

    function section(title, nodes, className) {
      return el('section', { className: `mp-sec ${className || ''}` }, [el('h2', { className: 'mp-sec-title', textContent: title }, []), ...nodes]);
    }

    async function drawDetail() {
      const mine = ++seq;
      const data = await rice.memoryList('').catch(() => ({ people: [], orgs: [] }));
      if (mine !== seq || !box || !box.isConnected) return;
      const groups = selected.kind === 'org' ? data.orgs : data.people;
      const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      const entity = groups.find((g) => same(g.name, selected.name));
      if (!entity) {
        selected = null; // esquecida ou sem fatos: volta para a lista
        return draw();
      }
      const reload = () => drawDetail();
      const ctx = { rice, onOpen: deps.onOpenMeeting };
      const rows = (list) => list.map((f) => window.RiceMemory.factRow(ctx, f, reload));
      const facts = entity.facts;
      const open = facts.filter(isOpenFollowup).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      const done = facts.filter((f) => OPEN_KINDS.includes(f.kind) && f.status === 'done');
      const decisions = facts.filter((f) => f.kind === 'decision');
      const context = facts.filter((f) => ['open_question', 'preference', 'context'].includes(f.kind));
      const meetings = [...new Map(facts.map((f) => [f.source.dir, f.source])).values()].filter((s) => s.dir).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
      const back = el('button', { type: 'button', className: 'mp-back' }, [window.RiceIcons.icon('chevron-right'), el('span', { textContent: t('memory.page.title') }, [])]);
      back.onclick = () => {
        selected = null;
        draw();
      };
      const forget = el('button', { type: 'button', className: 'mem-forget', textContent: t('memory.forget') }, []);
      forget.onclick = async () => {
        if (!(await deps.confirm(t(selected.kind === 'org' ? 'memory.forget.confirm.org' : 'memory.forget.confirm.person', { name: entity.name }), t('memory.forget')))) return;
        await rice.memoryForget(selected.kind, entity.name);
        selected = null;
        draw();
      };
      const sub = subOf(selected.kind, facts);
      const body = box.querySelector('.mp-body');
      body.replaceChildren(
        back,
        el('div', { className: 'mp-detail-head' }, [el('div', { className: 'mp-detail-title' }, [el('h2', { className: 'mp-name', textContent: entity.name }, []), ...(sub ? [el('p', { className: 'mp-sub', textContent: sub }, [])] : [])]), forget]),
        ...(open.length ? [section(t('memory.sec.open'), rows(open), 'open')] : []),
        ...(decisions.length ? [section(t('memory.sec.decisions'), rows(decisions))] : []),
        ...(context.length ? [section(t('memory.sec.context'), rows(context))] : []),
        ...(done.length ? [el('details', { className: 'mp-sec mp-done' }, [el('summary', {}, [el('h2', { className: 'mp-sec-title', textContent: t('memory.sec.done') }, []), el('span', { className: 'mem-count', textContent: String(done.length) }, [])]), ...rows(done)])] : []),
        ...(meetings.length ? [section(t('memory.sec.meetings'), [el('div', { className: 'mp-meetings' }, meetings.map((m) => window.RiceMemory.sourceLink(m, deps.onOpenMeeting)))], 'meetings')] : []),
      );
    }

    function draw() {
      if (!box || !box.isConnected) return;
      return selected ? drawDetail() : drawList();
    }

    function openEntity(kind, name) {
      selected = { kind: kind === 'org' ? 'org' : 'person', name: String(name) };
      tab = selected.kind === 'org' ? 'orgs' : 'people';
      draw();
    }

    return {
      openEntity,
      refresh: () => draw(),
      async render(container, target) {
        box = el('div', { className: 'mp-page' }, [el('h1', { className: 'page-title static', textContent: t('memory.page.title') }, []), el('div', { className: 'mp-body' }, [])]);
        container.replaceChildren(box);
        selected = target && target.name ? { kind: target.kind === 'org' ? 'org' : 'person', name: String(target.name) } : null;
        if (selected) tab = selected.kind === 'org' ? 'orgs' : 'people';
        await draw();
      },
    };
  }

  window.RiceMemoryPage = { create };
})();
