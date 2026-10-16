// Regra do botão Gravar com uma reunião já gravada aberta: retomar só vale para o "parei sem querer" (mesmo dia e a última sessão
// terminou há menos de 60 min). Fora disso, é uma reunião nova (a daily de ontem não ganha a de hoje). Só regra + aviso; o resto fica
// no renderer.js. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const RESUME_WINDOW_MS = 60 * 60_000;
  const VISIBLE_MS = 12_000;
  let node = null;
  let timer = null;

  /** Fim da última sessão da reunião (o início, se ela nunca fechou); meta antiga sem `sessions` usa startedAt/endedAt. */
  function lastEnd(meta) {
    if (!meta) return null;
    const list = Array.isArray(meta.sessions) && meta.sessions.length > 0 ? meta.sessions : [{ startedAt: meta.startedAt, endedAt: meta.endedAt }];
    let best = null;
    for (const s of list) {
      const time = new Date(s.endedAt || s.startedAt).getTime();
      if (Number.isFinite(time) && (best === null || time > best)) best = time;
    }
    return best;
  }

  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  /** Retoma a reunião aberta (já gravada)? Só se a última sessão terminou HOJE e há menos de 60 min. */
  function shouldResume(meta, now) {
    const end = lastEnd(meta);
    if (end === null) return false;
    const elapsed = now.getTime() - end;
    return elapsed >= 0 && elapsed < RESUME_WINDOW_MS && sameDay(new Date(end), now);
  }

  /** Evento da agenda em andamento agora (o que começou por último, se houver vários). */
  function eventNow(events, now) {
    let best = null;
    for (const e of events || []) {
      const start = new Date(e.start);
      if (start <= now && new Date(e.end) > now && (best === null || start > new Date(best.start))) best = e;
    }
    return best;
  }

  function hide() {
    clearTimeout(timer);
    if (node) node.remove();
    node = null;
  }

  /** "Continuando esta reunião" + "Começar uma nova" (corrige na hora); some sozinho. */
  function toast(onNew) {
    hide();
    const text = Object.assign(document.createElement('span'), { className: 'consent-text', textContent: t('resume.toast') });
    const fresh = Object.assign(document.createElement('button'), { type: 'button', className: 'consent-copy', textContent: t('resume.new') });
    fresh.onclick = () => {
      hide();
      onNew();
    };
    node = Object.assign(document.createElement('div'), { className: 'consent-toast', role: 'status' });
    node.append(text, fresh);
    window.RiceToastStack.get().append(node);
    timer = setTimeout(hide, VISIBLE_MS);
  }

  window.RiceResume = { shouldResume, eventNow, toast, hide, RESUME_WINDOW_MS };
})();
