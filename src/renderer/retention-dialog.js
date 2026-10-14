// "Tempo de guarda…" de uma pasta: duas regras independentes (áudio e reunião inteira), cada uma herdada, "manter sempre" ou com prazo.
// O que vence vai para a Lixeira do sistema. Só createElement/textContent.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const AUDIO = [7, 30, 90];
  const MEETING = [6, 12];
  /** Valor do menu para o que está guardado: undefined = herdar. */
  const valueOf = (v) => (v === undefined ? 'inherit' : String(v));
  const numberOf = (v) => (v === 'inherit' ? undefined : Number(v));

  /** Itens do menu de uma regra; `withInherit` só nas pastas (o padrão global não herda de ninguém). */
  function items(kind, withInherit) {
    const label = (n) => (kind === 'audio' ? t('retention.days', { n }) : n === 12 ? t('retention.year') : t('retention.months', { n }));
    return [...(withInherit ? [{ value: 'inherit', label: t('retention.inherit') }] : []), { value: '0', label: t('retention.always') }, ...(kind === 'audio' ? AUDIO : MEETING).map((n) => ({ value: String(n), label: label(n) }))];
  }

  /** `folder`: { id, name, retention? }; `onSaved()` roda depois de gravar. */
  function open(folder, onSaved) {
    window.RiceDialog.open(t('retention.title'), (box, close) => {
      const current = folder.retention || {};
      let audioValue = valueOf(current.audioDays);
      let meetingValue = valueOf(current.meetingMonths);
      const audio = window.RiceMenuSelect.create({ items: items('audio', true), value: audioValue, ariaLabel: t('retention.audio'), onChoose: (v) => (audioValue = v) });
      const meeting = window.RiceMenuSelect.create({ items: items('meeting', true), value: meetingValue, ariaLabel: t('retention.meeting'), onChoose: (v) => (meetingValue = v) });
      box.body.append(
        el('p', { className: 'dlg-sub', textContent: t('retention.folder', { name: folder.name }) }, []),
        window.RiceDialog.field(t('retention.audio'), audio.root),
        window.RiceDialog.field(t('retention.meeting'), meeting.root),
        el('p', { className: 'set-help', textContent: t('retention.note') }, []),
      );
      const save = window.RiceDialog.button(t('retention.save'), 'primary', async () => {
        const a = numberOf(audioValue);
        const m = numberOf(meetingValue);
        const retention = a === undefined && m === undefined ? null : { ...(a !== undefined ? { audioDays: a } : {}), ...(m !== undefined ? { meetingMonths: m } : {}) };
        const result = await window.rice.setFolderPrivacy(folder.id, { retention });
        if (result && result.ok === false) return;
        close();
        if (onSaved) onSaved();
      });
      box.foot.append(window.RiceDialog.button(t('common.cancel'), 'ghost', close), save);
    }, { title: t('retention.title') });
  }

  window.RiceRetention = { open, items, valueOf, numberOf };
})();
