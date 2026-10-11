// Alças de redimensionar a barra lateral e o painel do chat: arrastar, duplo clique (padrão) e ←/→ (16px).
// A largura vive numa variável CSS (--side-w / --chat-w) e fica salva em localStorage (com try/catch: pode estar bloqueado).
(function () {
  const STEP = 16;

  const read = (key) => {
    try {
      const n = Number(localStorage.getItem(key));
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      // sem armazenamento: a largura só vale nesta sessão
    }
  };

  /**
   * `handle`: o elemento da alça. `edge`: 'right' (alça na borda direita da barra lateral: largura = x) ou 'left' (borda esquerda do chat: largura = janela − x).
   * Devolve { set(width), get(), reset() }.
   */
  function create({ handle, key, cssVar, min, max, def, edge, label }) {
    const root = document.documentElement;
    let width = def;
    const clamp = (n) => Math.min(max, Math.max(min, Math.round(n)));
    const paint = () => {
      root.style.setProperty(cssVar, `${width}px`);
      handle.setAttribute('aria-valuenow', String(width));
    };
    const set = (n, save = true) => {
      width = clamp(n);
      paint();
      if (save) write(key, width === def ? null : width);
    };

    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-label', label);
    handle.tabIndex = 0;

    const saved = read(key);
    width = saved === null ? def : clamp(saved);
    paint();

    const widthAt = (x) => (edge === 'right' ? x : window.innerWidth - x);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('resizing');
    });
    handle.addEventListener('pointermove', (e) => {
      if (handle.classList.contains('dragging')) set(widthAt(e.clientX), false);
    });
    const end = () => {
      if (!handle.classList.contains('dragging')) return;
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      write(key, width === def ? null : width);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => set(def));
    handle.addEventListener('keydown', (e) => {
      const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      set(width + (e.key === grow ? STEP : -STEP));
    });

    return { set, get: () => width, reset: () => set(def) };
  }

  window.RiceResize = { create };
})();
