// Capturas de tela da reunião: diálogo de ativação, miniaturas na transcrição e nas notas, visualização ampliada e o
// controle discreto durante a gravação. Só createElement/textContent; as imagens chegam como data URL do main, que só
// entrega arquivos do `capturas/` da própria reunião.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const SHOT_FILE = /^\d{6}(?:-\d{1,2})?\.jpg$/;
  const SHOT_ID = /^\d{6}(?:-\d{1,2})?$/;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const clockOf = (shot) => (/T(\d{2}:\d{2}:\d{2})/.exec(shot.at || '') || [])[1] || '';

  /**
   * Aviso antes de ligar: em linguagem simples o que acontece, para onde vão as imagens e o que o macOS pede.
   * `env`: { provider, seesImages, permission }. Resolve true só em "Ativar".
   */
  function confirmEnable(env) {
    return new Promise((resolve) => {
      const D = window.RiceDialog;
      let answered = false;
      const answer = (value, close) => {
        if (answered) return;
        answered = true;
        resolve(value);
        close();
      };
      const provider = window.RiceAiProviders && env.provider ? window.RiceAiProviders.label(env.provider) : env.provider || '';
      const lines = [
        t('shots.confirm.watch'),
        t('shots.confirm.folder'),
        env.seesImages ? t('shots.confirm.ai', { provider }) : t('shots.confirm.ai-cli', { provider }),
        t('shots.confirm.permission'),
        t('shots.confirm.off'),
      ];
      D.open(t('shots.confirm.title'), (box, closeBox) => {
        box.body.append(
          el('p', { textContent: t('shots.confirm.intro') }, []),
          el('ul', { className: 'shots-confirm-list' }, lines.map((text) => el('li', { textContent: text }, []))),
        );
        const cancel = D.button(t('common.cancel'), 'ghost', () => answer(false, closeBox));
        const ok = D.button(t('shots.confirm.enable'), 'primary', () => answer(true, closeBox));
        ok.dataset.autofocus = '';
        box.foot.append(cancel, ok);
        return () => {
          if (!answered) {
            answered = true;
            resolve(false); // Esc fecha sem ativar
          }
        };
      });
    });
  }

  /** Visualização ampliada de uma captura: Esc, clique fora ou o botão Fechar. */
  function openViewer(src, caption, clock) {
    const previous = document.activeElement;
    const overlay = el('div', { className: 'overlay shot-viewer' }, []);
    const closeBtn = el('button', { type: 'button', className: 'icon-btn shot-viewer-close', title: t('shots.close') }, [window.RiceIcons.icon('x')]);
    closeBtn.setAttribute('aria-label', t('shots.close'));
    const label = [clock, caption].filter(Boolean).join(' · ');
    const box = el('div', { className: 'shot-viewer-box', role: 'dialog' }, [
      el('img', { className: 'shot-viewer-img', src, alt: label || t('shots.thumb.alt', { time: clock }) }, []),
      el('div', { className: 'shot-viewer-bar' }, [el('span', { className: 'shot-viewer-caption', textContent: label }, []), closeBtn]),
    ]);
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label || t('shots.open'));
    const close = () => {
      if (!overlay.isConnected) return;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.focus) previous.focus();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    closeBtn.onclick = close;
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    overlay.append(box);
    document.body.append(overlay);
    closeBtn.focus();
    return { close, overlay };
  }

  /**
   * Uma miniatura (altura ~64 px, raio 6) com a legenda ao lado em cor secundária. `onRemove` ligado = traz o ⋯ com "Remover".
   * `deps`: { rice, dir, warn }.
   */
  function thumb(deps, shot, onRemove) {
    const { rice, dir } = deps;
    const clock = clockOf(shot);
    const img = el('img', { className: 'shot-img', alt: t('shots.thumb.alt', { time: clock }), loading: 'lazy' }, []);
    const open = el('button', { type: 'button', className: 'shot-open', title: t('shots.open') }, [img]);
    open.setAttribute('aria-label', `${t('shots.open')} ${clock}`.trim());
    rice.screenshotsThumb(dir, shot.file).then((url) => {
      if (url) img.src = url;
      else open.hidden = true;
    }).catch(() => {
      open.hidden = true;
    });
    open.onclick = async () => {
      const full = await rice.screenshotsImage(dir, shot.file).catch(() => null);
      if (full) openViewer(full, shot.caption, clock);
    };
    const caption = el('span', { className: 'shot-caption' }, [
      ...(clock ? [el('span', { className: 'shot-clock', textContent: clock }, [])] : []),
      ...(shot.caption ? [el('span', { className: 'shot-text', textContent: shot.caption }, [])] : []),
    ]);
    const children = [open, caption];
    if (onRemove) {
      const more = el('button', { type: 'button', className: 'icon-btn shot-more', title: t('shots.more') }, [window.RiceIcons.icon('more')]);
      more.setAttribute('aria-label', t('shots.more'));
      more.setAttribute('aria-haspopup', 'menu');
      more.onclick = (e) => {
        e.stopPropagation();
        window.RiceActionMenu.open({ anchor: more, items: [{ icon: 'trash', label: t('shots.remove'), danger: true, onSelect: () => onRemove(shot) }] });
      };
      children.push(more);
    }
    const root = el('div', { className: 'shot' }, children);
    root.dataset.file = shot.file;
    return root;
  }

  /**
   * Integração com a reunião aberta. `deps`: { rice, warn(message) }.
   * - `setDir(dir, transcriptNode)`: carrega a lista e põe as miniaturas na transcrição, no ponto do tempo de cada uma;
   * - `noteShot(id)`: nó da miniatura para uma citação nas notas (só ids da lista desta reunião);
   * - `count()`: quantas capturas a reunião tem.
   */
  function create(deps) {
    const { rice } = deps;
    let dir = null;
    let node = null;
    let shots = [];
    let seq = 0;
    const listeners = new Set();

    const remove = async (shot) => {
      const r = await rice.screenshotsRemove(dir, shot.file).catch(() => ({ ok: false }));
      if (!r || r.ok === false) deps.warn(t('shots.err.remove'));
    };

    /** A captura vinda da fala fica logo depois do trecho que a motivou; as outras entram pelo horário (a transcrição está em ordem). */
    function nextRow(shot, rows) {
      const said = shot.trigger ? shot.trigger.text.trim() : '';
      const byText = said ? rows.filter((r) => ((r.querySelector('.t-text') || {}).textContent || '').trim() === said) : []; // o relógio calculado pode diferir 1 s do gravado: o texto manda
      const trigger = byText.length ? byText : shot.trigger ? rows.filter((r) => r.title === shot.trigger.segmentAt) : [];
      if (trigger.length) {
        let ref = trigger[trigger.length - 1].nextElementSibling;
        while (ref && ref.classList.contains('t-shot')) ref = ref.nextElementSibling; // depois das que já estão ali (ordem do tempo)
        return ref;
      }
      const clock = clockOf(shot);
      if (clock) return rows.find((r) => r.title > clock) || null;
      const after = shot.segment ? rows.filter((r) => r.title === shot.segment) : [];
      return after.length ? after[after.length - 1].nextElementSibling : null;
    }

    function draw() {
      if (!node) return;
      for (const old of node.querySelectorAll('.t-shot')) old.remove();
      const rows = [...node.children].filter((c) => c.classList && c.classList.contains('t-row') && c.title);
      const tail = node.querySelector('.t-row.t-partial'); // as falas parciais ficam sempre no fim
      for (const shot of [...shots].sort((a, b) => a.offsetMs - b.offsetMs)) {
        const row = el('div', { className: 't-shot' }, [thumb({ rice, dir }, shot, remove)]);
        node.insertBefore(row, nextRow(shot, rows) || tail); // em ordem crescente, cada uma entra logo antes da mesma âncora, depois das anteriores
      }
    }

    const emit = () => listeners.forEach((fn) => fn(shots.length));

    async function refresh() {
      if (!dir || !rice.screenshotsList) return;
      const mine = ++seq;
      let got = { shots: [] };
      try {
        got = await rice.screenshotsList(dir);
      } catch {
        got = { shots: [] };
      }
      if (mine !== seq) return;
      shots = (got.shots || []).filter((s) => SHOT_FILE.test(s.file));
      draw();
      emit();
    }

    return {
      /** Aviso do main ('screenshots:changed'): captura nova ou removida. */
      changed(p) {
        if (p && p.dir === dir) refresh();
      },
      count: () => shots.length,
      onCount: (fn) => listeners.add(fn),
      /** Carrega a lista (para as notas poderem citar) e desenha as miniaturas na transcrição. */
      async setDir(next, transcriptNode) {
        dir = next;
        node = transcriptNode || null;
        shots = [];
        if (!dir) return emit();
        await refresh();
      },
      refresh,
      redraw: draw,
      noteShot(id) {
        const shot = SHOT_ID.test(id) ? shots.find((s) => s.file === `${id}.jpg`) : null;
        if (!shot || !dir) return null;
        const figure = el('figure', { className: 'note-shot' }, [thumb({ rice, dir }, shot, null)]);
        return figure;
      },
    };
  }

  /**
   * Controle discreto na barra de gravação: "3 capturas" enquanto grava com a opção ligada; o clique oferece desligar.
   * `deps`: { rice, node, captureNode }. `sync({ recording, dir })` é chamado a cada mudança de estado da gravação.
   */
  function chip(deps) {
    const { rice, node, captureNode } = deps;
    const state = { recording: false, dir: null, enabled: false, permission: 'granted', count: 0 };
    let seq = 0;
    const render = () => {
      const show = state.recording && state.enabled;
      node.hidden = !show;
      if (captureNode) captureNode.hidden = !show;
      if (!show) return;
      const denied = state.permission !== 'granted';
      const label = denied ? t('shots.chip.denied') : window.RiceI18n.tn('shots.count', state.count);
      node.replaceChildren(window.RiceIcons.icon('image'), el('span', { textContent: label }, []));
      node.title = denied ? t('shots.chip.denied-title') : t('shots.chip.title');
      node.setAttribute('aria-label', `${node.title}: ${label}`);
      node.classList.toggle('warn', denied);
    };
    // captura manual (para quando a IA não perceber o momento): botão discreto e ⌘⇧S / Ctrl+Shift+S, só com o app em foco
    const captureNow = async () => {
      if (node.hidden || !rice.screenshotsCaptureNow) return;
      if (captureNode) captureNode.disabled = true;
      await rice.screenshotsCaptureNow().catch(() => null);
      if (captureNode) captureNode.disabled = false;
    };
    if (captureNode) {
      const title = t('shots.capture.title'); // a variante do Windows (Ctrl+Shift+S) vem do próprio t()
      captureNode.replaceChildren(window.RiceIcons.icon('camera'));
      captureNode.title = title;
      captureNode.setAttribute('aria-label', t('shots.capture'));
      captureNode.onclick = captureNow;
    }
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 's' && !node.hidden) {
        e.preventDefault();
        captureNow();
      }
    });
    node.setAttribute('aria-haspopup', 'menu');
    node.onclick = () => {
      const items = [{ icon: 'x', label: t('shots.chip.off'), onSelect: async () => {
        await rice.screenshotsSetEnabled(false).catch(() => null);
        window.dispatchEvent(new CustomEvent('rice:shots-changed'));
      } }];
      if (state.permission !== 'granted' && rice.screenshotsOpenPrivacy) items.unshift({ icon: 'shield', label: t('settings.screenshots.open'), onSelect: () => rice.screenshotsOpenPrivacy() });
      window.RiceActionMenu.open({ anchor: node, items });
    };
    async function sync(next) {
      if (next) {
        const was = state.dir;
        Object.assign(state, { recording: Boolean(next.recording), dir: next.dir || null });
        if (state.dir !== was) state.count = 0;
      }
      const mine = ++seq;
      if (!state.recording || !state.dir || !rice.screenshotsStatus) return render();
      const [env, list] = await Promise.all([rice.screenshotsStatus().catch(() => null), rice.screenshotsList(state.dir).catch(() => null)]);
      if (mine !== seq) return;
      state.enabled = Boolean(env && env.enabled);
      state.permission = env ? env.permission : 'granted';
      state.count = list && list.shots ? list.shots.length : 0;
      render();
    }
    window.addEventListener('rice:shots-changed', () => sync());
    return {
      sync,
      changed(p) {
        if (p && p.dir === state.dir) {
          state.count = p.count;
          render();
        }
      },
    };
  }

  window.RiceScreenshots = { confirmEnable, openViewer, create, thumb, chip };
})();
