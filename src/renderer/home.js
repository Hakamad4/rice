// Página inicial: "Agenda" (próximos 7 dias, Google + Calendário do macOS). Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const uses12h = () => new Intl.DateTimeFormat(window.RiceI18n.locale(), { hour: 'numeric' }).resolvedOptions().hour12 === true;
  const hhmm = (d) => d.toLocaleTimeString(window.RiceI18n.locale(), { hour: uses12h() ? 'numeric' : '2-digit', minute: '2-digit' }); // 24 h alinha os dígitos (09:00); 12 h é "9:00 AM"

  const DAYS = 7;
  const range = (e) => `${hhmm(new Date(e.start))}–${hhmm(new Date(e.end))}`;

  /** { name, date? }: "Hoje" + "sáb., 10 de out.", "Amanhã" + data, ou só "sex., 17 de out." (no idioma do app). */
  function dayLabel(date, now) {
    const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
    const full = date.toLocaleDateString(window.RiceI18n.locale(), { weekday: 'short', day: 'numeric', month: 'short' });
    if (diff === 0) return { name: t('day.today'), date: full };
    if (diff === 1) return { name: t('day.tomorrow'), date: full };
    return { name: full };
  }

  /**
   * Próximos 7 dias agrupados por dia local: `allDay` (dia inteiro, que cobre todos os dias que ocupa) e `items` (com horário, em ordem de início;
   * o que já terminou some). Dia sem nada não aparece.
   */
  function groupUpcoming(events, now) {
    const first = startOfDay(now);
    const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + DAYS);
    const byDay = new Map();
    const group = (day) => {
      const key = day.getTime();
      if (!byDay.has(key)) {
        const d = dayLabel(day, now);
        byDay.set(key, { key, label: d.name, date: d.date || '', allDay: [], items: [] });
      }
      return byDay.get(key);
    };
    const sorted = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
    for (const e of sorted) {
      const start = new Date(e.start);
      const end = new Date(e.end);
      if (e.allDay) {
        // `end` é exclusivo (meia-noite do dia seguinte ao último)
        for (let day = startOfDay(start); day < end && day < last; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
          if (day >= first) group(day).allDay.push(e);
        }
      } else if (end > now && start < last) {
        group(startOfDay(start)).items.push(e);
      }
    }
    return [...byDay.values()].sort((a, b) => a.key - b.key);
  }

  function button(text, onclick, className) {
    const b = el('button', { textContent: text, className: className || '' }, []);
    b.onclick = onclick;
    return b;
  }

  /** "Pergunte sobre suas reuniões": uma linha discreta; Enter abre o chat de todas as reuniões. */
  function askField(onAsk) {
    // o texto de exemplo é um rótulo por cima do campo (placeholder " "), para trocar por uma versão curta quando a coluna é estreita
    const input = el('input', { type: 'text', placeholder: ' ', autocomplete: 'off', spellcheck: false }, []);
    input.setAttribute('aria-label', t('gchat.field-aria'));
    input.id = 'home-ask-input';
    const hint = el('span', { className: 'ask-ph' }, [el('span', { className: 'ph-long', textContent: t('gchat.home-ph') }, []), el('span', { className: 'ph-mid', textContent: t('gchat.field-aria') }, []), el('span', { className: 'ph-short', textContent: t('gchat.home-ph-short') }, [])]);
    const form = el('form', { className: 'home-ask' }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('sparkles')]), el('div', { className: 'ask-field' }, [input, hint]), el('kbd', { className: 'kbd-hint', textContent: window.RiceKeys ? window.RiceKeys.label('J') : '⌘J' }, [])]);
    form.onsubmit = (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      onAsk(question);
    };
    return form;
  }

  /**
   * Cartão do topo do Início quando falta IA (nenhuma conectada/verificada ou a ativa falhou no teste): título, uma linha e "Configurar".
   * Com o modelo gratuito do OpenCode, só um aviso menor e não bloqueante com "Trocar modelo". Devolve `null` quando está tudo certo.
   */
  function aiNotice(state, onSetup) {
    if (state.needsSetup) {
      return el('div', { className: 'ai-notice', role: 'status' }, [
        el('span', { className: 'ico' }, [window.RiceIcons.icon('plug')]),
        el('div', { className: 'ai-notice-text' }, [el('strong', { textContent: t('home.ai.title') }, []), el('p', { textContent: t('home.ai.text') }, [])]),
        button(t('home.ai.button'), onSetup, 'btn primary'),
      ]);
    }
    if (state.freeModel) {
      return el('div', { className: 'ai-notice small', role: 'status' }, [
        el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]),
        el('p', { textContent: t('home.ai.free') }, []),
        button(t('home.ai.change-model'), onSetup, 'btn ghost'),
      ]);
    }
    return null;
  }

  /** Preenche (ou esvazia) o espaço do aviso e liga/desliga o campo de perguntas conforme haja IA. */
  function applyAiState(container, state, onSetup) {
    const slot = container.querySelector('.ai-notice-slot');
    if (slot) slot.replaceChildren(...[aiNotice(state, onSetup)].filter(Boolean));
    const input = container.querySelector('#home-ask-input');
    if (input) {
      input.disabled = Boolean(state.needsSetup);
      const form = input.closest('.home-ask');
      form.classList.toggle('disabled', Boolean(state.needsSetup));
      form.title = state.needsSetup ? t('gchat.need-ai') : '';
    }
  }

  /** Hora do lembrete (ou vazio se o vencimento é só o dia). */
  const remTime = (r) => (r.hasTime ? new Date(r.due).toLocaleTimeString(window.RiceI18n.locale(), { hour: '2-digit', minute: '2-digit' }) : '');
  const MAX_REMINDERS = 8;

  /**
   * "Para hoje": lembretes do app Lembretes (hoje e atrasados), compactos e sem botão de gravar.
   * `state`: { access, enabled, items }. `handlers`: { onComplete(item) → Promise<boolean>, onAllow(access) }.
   * Desligado, vazio ou antes de o detector responder: o espaço some. Sem permissão: uma linha com o botão.
   */
  function applyReminders(container, state, handlers) {
    const slot = container.querySelector('.reminders-slot');
    if (!slot) return;
    if (!state || state.enabled === false || state.access === 'unsupported') return slot.replaceChildren();
    if (state.access === 'notDetermined' || state.access === 'denied') {
      const denied = state.access === 'denied';
      const row = el('div', { className: 'rem-allow' }, [
        el('span', { textContent: denied ? t('home.reminders.denied') : t('home.reminders.allow-text') }, []),
        button(denied ? t('home.reminders.open-settings') : t('home.reminders.allow'), () => handlers.onAllow(state.access), 'btn ghost'),
      ]);
      return slot.replaceChildren(row);
    }
    const items = state.access === 'granted' ? state.items || [] : [];
    if (items.length === 0) return slot.replaceChildren();
    const list = el('div', { className: 'rem-list' }, []);
    for (const r of items.slice(0, MAX_REMINDERS)) {
      const box = el('input', { type: 'checkbox', className: 'rem-box', title: t('home.reminders.complete') }, []);
      box.setAttribute('aria-label', `${t('home.reminders.complete')}: ${r.title}`);
      const row = el('div', { className: 'rem-row' + (r.overdue ? ' late' : '') }, [
        box,
        el('span', { className: 'rem-title', textContent: r.title }, []),
        ...(r.overdue ? [el('span', { className: 'rem-late', textContent: t('home.reminders.late') }, [])] : []),
        ...(remTime(r) ? [el('span', { className: 'rem-time', textContent: remTime(r) }, [])] : []),
      ]);
      box.onchange = async () => {
        row.classList.add('done'); // marcar conclui no app Lembretes; se falhar, volta
        box.disabled = true;
        const ok = await handlers.onComplete(r);
        if (ok) setTimeout(() => row.remove(), 500);
        else {
          row.classList.remove('done');
          box.checked = false;
          box.disabled = false;
        }
      };
      list.append(row);
    }
    const more = items.length - MAX_REMINDERS;
    slot.replaceChildren(
      el('h2', { className: 'day-label' }, [document.createTextNode(t('home.reminders.title'))]),
      list,
      ...(more > 0 ? [el('p', { className: 'rem-more', textContent: t('home.reminders.more', { n: more }) }, [])] : []),
    );
  }

  const isMeeting = (e) => Boolean(e.joinUrl) || e.attendees > 0;

  const SOON_MS = 10 * 60_000;
  /** "O que lembrar" no Início: eventos de reunião que começam em até 15 min (ou já estão rolando). */
  const MEMORY_MS = 15 * 60_000;

  /** Dia inteiro: uma linha discreta de texto corrido ("Dia inteiro: Treinar, Ler livro, Leetcode +1"), sem cores nem chips. */
  function allDayRow(events) {
    const shown = events.slice(0, 3).map((e) => e.title);
    const rest = events.length - shown.length;
    return el('div', { className: 'event allday', textContent: `${t('home.all-day')}: ${shown.join(', ')}${rest > 0 ? ` +${rest}` : ''}` }, []);
  }

  /** Botão de ação da linha: texto na tela larga, só o ícone (com `title`) na estreita. */
  function action(label, icon, onclick, className) {
    const b = el('button', { type: 'button', className: className || '', title: label }, [window.RiceIcons.icon(icon), el('span', { className: 'lbl', textContent: label }, [])]);
    b.setAttribute('aria-label', label);
    b.onclick = onclick;
    return b;
  }

  function render(container, { events, now, google, connected, loading, onJoin, onNotes, onRecord, recording, onConnect, onAsk, onNewWarRoom, onMemory, onPerson }) {
    const anySource = connected !== undefined ? connected : Boolean(google && google.connected); // Google OU Calendário do macOS
    container.classList.toggle('h12', uses12h()); // "4:14 PM–4:44 PM" precisa de coluna de hora mais larga
    const nodes = [el('div', { className: 'ai-notice-slot' }, [])]; // o aviso de IA entra aqui quando o status chega, sem atrasar a página
    // a pergunta vem primeiro (porta de entrada para tudo que foi gravado); "Nova war room" é a ação secundária na mesma linha, à direita
    if (onAsk || onNewWarRoom) {
      const row = [];
      if (onAsk) row.push(askField(onAsk));
      // "Nova war room" fica só na barra lateral: ao lado do campo de pergunta disputava espaço e cortava o texto
      nodes.push(el('div', { className: 'home-ask-row' }, row));
    }
    nodes.push(el('h1', { className: 'page-title static', textContent: t('home.title') }, []));
    nodes.push(el('div', { className: 'reminders-slot' }, [])); // "Para hoje" (Lembretes do macOS) entra aqui quando chega
    if (!anySource && !loading) {
      nodes.push(
        el('div', { className: 'connect-card' }, [
          el('div', {}, [
            el('strong', { textContent: t('home.connect.title') }, []),
            el('p', { className: 'hint', textContent: t('home.connect.text') }, []),
          ]),
          button(t('home.connect.button'), onConnect, 'btn ghost'),
        ]),
      );
    }
    const groups = groupUpcoming(events, now);
    if (groups.length === 0 && anySource && !loading) nodes.push(el('p', { className: 'empty', textContent: t('home.empty') }, []));
    for (const group of groups) {
      nodes.push(el('h2', { className: 'day-label' }, [document.createTextNode(group.label), ...(group.date ? [el('span', { className: 'day-date', textContent: `· ${group.date}` }, [])] : [])]));
      if (group.allDay.length > 0) nodes.push(allDayRow(group.allDay));
      for (const e of group.items) {
        const start = new Date(e.start);
        const happening = start <= now && new Date(e.end) > now;
        const soon = happening || (start > now && start - now <= SOON_MS);
        const actions = [];
        if (isMeeting(e)) {
          // agora ou em até 10 min: "Entrar" (com link) e "Gravar agora"; antes disso, só "Preparar notas" (rascunho, sem gravar)
          actions.push(e.joinUrl && soon ? action(t('home.join'), 'video', () => onJoin(e), 'ev-join') : el('span', {}, []));
          actions.push(soon && onRecord && !recording ? action(t('home.record-now'), 'record', () => onRecord(e), 'ev-rec hot') : action(t('home.prepare-notes'), 'file-text', () => onNotes(e)));
        }
        const eventNode = el('div', { className: 'event' + (soon && isMeeting(e) ? ' soon' : '') + (happening ? ' now' : '') }, [
            el('span', { className: 'ev-time', textContent: range(e) }, []),
            el('span', { className: 'ev-main' }, [el('span', { className: 'ev-title', textContent: e.title }, []), ...(happening ? [el('span', { className: 'now-tag', textContent: t('home.now') }, [])] : [])]),
            el('span', { className: 'ev-meta', textContent: e.attendees > 0 ? window.RiceI18n.tn('home.attendees', e.attendees) : '' }, []),
            el('span', { className: 'ev-actions' }, actions),
        ]);
        nodes.push(eventNode);
        // "O que lembrar": uma linha secundária com o primeiro ponto e "ver mais"; sem fatos, nada aparece
        if (onMemory && isMeeting(e) && !e.allDay && (happening || (start > now && start - now <= MEMORY_MS))) {
          const slot = el('div', { className: 'ev-memory-slot' }, []);
          nodes.push(slot);
          Promise.resolve(onMemory(e)).then((brief) => {
            const line = window.RiceMemory ? window.RiceMemory.homeLine(brief, () => onNotes(e), onPerson) : null;
            if (line && slot.isConnected) slot.replaceChildren(line);
          }).catch(() => {});
        }
      }
    }
    container.replaceChildren(...nodes);
  }

  window.RiceHome = { groupUpcoming, render, applyAiState, applyReminders, aiNotice };
})();
