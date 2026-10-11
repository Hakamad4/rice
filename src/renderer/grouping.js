// Agrupa reuniões por dia ("Hoje", "Ontem", data) e formata duração.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function dayLabel(date, now) {
    const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if (diff === 0) return t('day.today');
    if (diff === 1) return t('day.yesterday');
    const opts = { day: 'numeric', month: 'long' };
    if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString(window.RiceI18n.locale(), opts);
  }

  /** Mantém a ordem recebida; cria um grupo novo a cada mudança de dia. */
  function groupByDay(meetings, now) {
    const groups = [];
    for (const m of meetings) {
      const label = dayLabel(new Date(m.startedAt), now);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(m);
      else groups.push({ label, items: [m] });
    }
    return groups;
  }

  function formatMinutes(min) {
    if (!(min >= 0)) return '';
    if (min < 1) return t('dur.under-min');
    if (min < 60) return t('dur.min', { n: min });
    return t('dur.hm', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') });
  }

  function formatDuration(startedAt, endedAt) {
    if (!endedAt) return '';
    return formatMinutes(Math.round((new Date(endedAt) - new Date(startedAt)) / 60000));
  }

  /** Soma das gravações encerradas (`sessions`); metas antigas usam startedAt/endedAt. */
  function formatMeetingDuration(meta) {
    const sessions = Array.isArray(meta.sessions) && meta.sessions.length > 0 ? meta.sessions : [{ startedAt: meta.startedAt, endedAt: meta.endedAt }];
    let ms = 0;
    for (const s of sessions) if (s.endedAt && new Date(s.endedAt) > new Date(s.startedAt)) ms += new Date(s.endedAt) - new Date(s.startedAt);
    if (!sessions.some((s) => s.endedAt)) return '';
    return formatMinutes(Math.round(ms / 60000));
  }

  window.RiceGroup = { dayLabel, groupByDay, formatDuration, formatMeetingDuration };
})();
