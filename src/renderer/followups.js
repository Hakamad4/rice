// Página "Pendências": o que prometi e o que prometeram a mim, de todas as reuniões. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const GROUPS = ['overdue', 'today', 'week', 'later', 'nodue', 'done'];
  const FILTERS = ['mine', 'others', 'all'];
  const FILTER_KEY = 'rice.followups.filter';
  const readFilter = () => {
    try {
      const v = localStorage.getItem(FILTER_KEY);
      return FILTERS.includes(v) ? v : 'mine';
    } catch {
      return 'mine';
    }
  };
  const writeFilter = (v) => {
    try {
      localStorage.setItem(FILTER_KEY, v);
    } catch {
      // sem armazenamento: só não fica lembrado
    }
  };

  const parts = (due) => String(due).split('-').map(Number);
  const startOfToday = () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  };
  /** "Hoje", "Amanhã" ou "sex., 9 de out.". */
  function dueLabel(due) {
    const [y, m, d] = parts(due);
    const date = new Date(y, m - 1, d);
    const diff = Math.round((date - startOfToday()) / 86400000);
    if (diff === 0) return t('day.today');
    if (diff === 1) return t('day.tomorrow');
    return date.toLocaleDateString(window.RiceI18n.locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(window.RiceI18n.locale(), { day: 'numeric', month: 'short' }) : '');

  /**
   * `deps`: { rice, onOpen(dir), warn(message) }. Devolve { render(container) }.
   * A página se refaz sozinha quando a memória muda (nota nova, pendência fechada, prazo editado).
   */
  function create(deps) {
    const { rice } = deps;
    let filter = readFilter();
    let box = null;
    let remindersActive = false;
    let meetings = [];
    let seq = 0;

    let popover = null;
    let offOutside = null;
    function closeDue() {
      if (popover) popover.remove();
      popover = null;
      if (offOutside) offOutside();
      offOutside = null;
    }
    const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const inDays = (n) => {
      const d = startOfToday();
      d.setDate(d.getDate() + n);
      return isoOf(d);
    };
    /** Atalhos do prazo: Hoje, Amanhã, a próxima sexta, a próxima segunda e "Escolher data" (campo de data dentro do popover). */
    function dueChoices() {
      const dow = startOfToday().getDay();
      const toFriday = ((5 - dow + 7) % 7) || 7;
      const toMonday = ((1 - dow + 7) % 7) || 7;
      const list = [[t('day.today'), inDays(0)], [t('day.tomorrow'), inDays(1)]];
      if (toFriday > 1) list.push([t('followups.due.friday'), inDays(toFriday)]);
      list.push([t('followups.due.next-week'), inDays(toMonday)]);
      return list;
    }
    function openDue(f, anchor) {
      const save = async (value) => {
        closeDue();
        if (value !== (f.due || '')) await rice.followupsSetDue(f.id, value || null);
        load();
      };
      const item = (label, onclick, extra) => {
        const opt = el('button', { type: 'button', className: 'menu-item select-opt fu-due-opt' + (extra || '') }, [el('span', { textContent: label }, [])]);
        opt.onclick = onclick;
        return opt;
      };
      const items = dueChoices().map(([label, value]) => item(label, () => save(value)));
      const input = el('input', { type: 'date', className: 'fu-date', value: f.due || '' }, []);
      input.setAttribute('aria-label', t('followups.due.pick'));
      input.hidden = true;
      input.onchange = () => input.value && save(input.value);
      const pick = item(t('followups.due.pick'), () => {
        pick.hidden = true;
        input.hidden = false;
        input.focus();
      });
      items.push(pick, input);
      if (f.due) items.push(item(t('followups.due.clear'), () => save('')));
      closeDue();
      popover = el('div', { className: 'menu-popover select-popover fu-due-pop' }, items);
      popover.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeDue();
          anchor.focus();
        }
      };
      // posição fixa junto ao chip, sempre dentro da janela (em janela estreita a linha quebra e o chip fica longe da borda)
      document.body.append(popover);
      const r = anchor.getBoundingClientRect();
      const w = popover.offsetWidth || 200;
      popover.style.position = 'fixed';
      const h = popover.offsetHeight || 220;
      const vh = document.documentElement.clientHeight;
      popover.style.top = `${Math.round(r.bottom + 4 + h > vh - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4)}px`;
      popover.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, document.documentElement.clientWidth - w - 8)))}px`;
      popover.style.right = 'auto';
      const outside = (e) => {
        if (!popover || !(popover.contains(e.target) || anchor.contains(e.target))) closeDue();
      };
      document.addEventListener('mousedown', outside);
      offOutside = () => document.removeEventListener('mousedown', outside);
      (popover.querySelector('button') || popover).focus();
    }

    function dueButton(f) {
      const label = f.due ? dueLabel(f.due) : t('followups.due.add');
      const late = f.due && f.status !== 'done' && new Date(...[parts(f.due)[0], parts(f.due)[1] - 1, parts(f.due)[2]]) < startOfToday();
      const b = el('button', { type: 'button', className: 'fu-due' + (late ? ' late' : '') + (f.due ? '' : ' none'), textContent: label, title: t('followups.due.edit') }, []);
      b.onclick = () => (popover ? closeDue() : openDue(f, b));
      return b;
    }

    function row(f) {
      const box = el('input', { type: 'checkbox', className: 'fu-box', checked: f.status === 'done' }, []);
      box.setAttribute('aria-label', `${t(f.status === 'done' ? 'followups.reopen' : 'followups.complete')}: ${f.text}`);
      box.onchange = async () => {
        box.disabled = true;
        await rice.followupsSetDone(f.id, box.checked);
        load();
      };
      const aiClosed = f.status === 'done' && f.doneBy && f.doneBy.dir;
      const main = el('div', { className: 'fu-main' }, [
        el('span', { className: 'fu-text', textContent: f.text }, []),
        el('span', { className: 'fu-sub' }, [
          ...(!f.mine || filter === 'all' ? [el('span', { className: 'fu-who', textContent: f.mine ? t('followups.mine') : t('followups.with', { who: f.who }) }, [])] : []),
          ...(f.source && f.source.dir ? [originLink(f.source)] : [el('span', { className: 'fu-who', textContent: t('followups.manual') }, [])]),
          ...(aiClosed ? [el('span', { className: 'fu-closed' }, [el('span', { textContent: t('followups.done-in', { title: f.doneBy.title }) }, []), el('span', { className: 'fu-sep', textContent: '·', 'aria-hidden': 'true' }, []), reopen(f)])] : []),
        ]),
      ]);
      // o prazo é um chip discreto à direita; sem prazo não repete a palavra (o grupo já diz): só "+ Prazo" no hover/foco
      const tail = el('div', { className: 'fu-tail' }, [f.status === 'done' ? el('span', { className: 'fu-due none', textContent: f.doneAt ? shortDate(f.doneAt) : '' }, []) : dueButton(f)]);
      return el('li', { className: 'fu-row' + (f.status === 'done' ? ' done' : '') }, [box, main, tail]);
    }

    function originLink(source) {
      const b = el('button', { type: 'button', className: 'mem-src', title: t('memory.card.open-source', { title: source.title || '' }) }, [window.RiceIcons.icon('arrow-up-right'), el('span', { textContent: `${source.title || ''} · ${shortDate(source.date)}` }, [])]);
      b.onclick = () => source.dir && deps.onOpen(source.dir);
      return b;
    }

    function reopen(f) {
      const b = el('button', { type: 'button', className: 'fu-reopen', textContent: t('followups.reopen') }, []);
      b.onclick = async () => {
        await rice.followupsSetDone(f.id, false);
        load();
      };
      return b;
    }

    function addForm() {
      const input = el('input', { type: 'text', className: 'fu-add-input', placeholder: t('followups.add.placeholder'), maxLength: 300, autocomplete: 'off' }, []);
      input.setAttribute('aria-label', t('followups.add.placeholder'));
      let chosen = '';
      const picker = window.RiceMenuSelect.create({
        items: [{ value: '', label: t('followups.add.no-link') }, ...meetings.slice(0, 80).map((m) => ({ value: m.dir, label: m.title, sub: shortDate(m.startedAt) }))],
        value: '',
        ariaLabel: t('followups.add.link'),
        searchFrom: 8,
        searchPlaceholder: t('followups.add.search'),
        onChoose: (v) => (chosen = v),
      });
      picker.root.classList.add('fu-add-meeting');
      const go = el('button', { type: 'submit', className: 'btn primary fu-add-go', textContent: t('followups.add.button') }, []);
      const form = el('form', { className: 'fu-add' }, [input, picker.root, go]);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        go.disabled = true;
        const r = await rice.followupsAdd({ text, ...(chosen ? { dir: chosen } : {}) });
        go.disabled = false;
        if (r && r.ok) {
          input.value = '';
          chosen = '';
          picker.setValue('');
          load();
        } else deps.warn(t('followups.add.failed'));
      };
      return form;
    }

    /** Filtros à esquerda; "Enviar minhas para Lembretes" é uma ação secundária discreta à direita (só com a integração ativa). */
    function toolbar() {
      const all = remindersActive && filter !== 'others' ? el('button', { type: 'button', className: 'fu-rem-all', textContent: t('followups.reminders.all') }, []) : null;
      if (all) {
        all.onclick = async () => {
          const res = await rice.followupsToReminders('mine');
          deps.warn(res && res.ok ? t('followups.reminders.sent', { n: res.count }) : t('followups.reminders.failed'));
        };
      }
      return el('div', { className: 'fu-bar' }, [filters(), ...(all ? [all] : [])]);
    }

    function filters() {
      return el('div', { className: 'fu-filters', role: 'group' }, FILTERS.map((id) => {
        const b = el('button', { type: 'button', className: 'fu-chip', textContent: t(`followups.filter.${id}`) }, []);
        b.setAttribute('aria-pressed', String(id === filter));
        b.onclick = () => {
          filter = id;
          writeFilter(id);
          load();
        };
        return b;
      }));
    }

    async function load() {
      if (!box || !box.isConnected) return;
      const mine = ++seq;
      const [data, rem] = await Promise.all([rice.followupsList(filter).catch(() => null), rice.followupsRemindersStatus ? rice.followupsRemindersStatus().catch(() => ({ active: false })) : { active: false }]);
      if (mine !== seq || !box.isConnected || !data) return;
      remindersActive = Boolean(rem && rem.active);
      const total = GROUPS.reduce((n, g) => n + data.groups[g].length, 0);
      const sections = [];
      for (const g of GROUPS) {
        const items = data.groups[g];
        if (items.length === 0) continue;
        const head = el('h2', { className: 'fu-group-title' + (g === 'overdue' ? ' late' : '') }, [document.createTextNode(t(`followups.group.${g}`)), el('span', { className: 'mem-count', textContent: String(items.length) }, [])]);
        const ul = el('ul', { className: 'fu-list' + (g === 'nodue' ? ' nodue' : '') }, items.map(row));
        if (g === 'done') sections.push(el('details', { className: 'fu-done-group' }, [el('summary', {}, [head]), ul]));
        else sections.push(el('section', { className: 'fu-group' }, [head, ul]));
      }
      box.querySelector('.fu-body').replaceChildren(...(total === 0 ? [el('p', { className: 'empty', textContent: t('followups.empty') }, [])] : sections));
      box.querySelector('.fu-bar').replaceWith(toolbar());
    }

    return {
      refresh: load,
      async render(container) {
        box = el('div', { className: 'fu-page' }, [
          el('h1', { className: 'page-title static', textContent: t('followups.title') }, []),
          el('div', { className: 'fu-add-slot' }, []),
          el('div', { className: 'fu-bar' }, []),
          el('div', { className: 'fu-body' }, []),
        ]);
        container.replaceChildren(box);
        meetings = (await (rice.listMeetings ? rice.listMeetings() : Promise.resolve([])).catch(() => [])) || [];
        meetings = meetings.filter((m) => m && m.dir && m.title);
        box.querySelector('.fu-add-slot').replaceChildren(addForm());
        await load();
      },
    };
  }

  window.RiceFollowups = { create, dueLabel };
})();
