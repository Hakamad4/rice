// Menu da barra lateral (os 8 itens, sempre com ícone e nome): quando tudo junto não cabe, só o menu rola, e dois detalhes:
// um fade sutil em cima/embaixo indica que há mais itens, e o item ativo nunca fica escondido (ao navegar ou ao encolher a janela).
(function () {
  const FADE_EDGE = 1; // px de tolerância
  const REVEAL_PAD = 6;

  /** 'top' | 'bottom' | 'both' | '' conforme há conteúdo escondido acima/abaixo. */
  function fadeOf(scrollTop, scrollHeight, clientHeight) {
    const top = scrollTop > FADE_EDGE;
    const bottom = scrollTop + clientHeight < scrollHeight - FADE_EDGE;
    return top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : '';
  }

  /** Quanto rolar (px, + para baixo) para o item aparecer inteiro; 0 se já aparece. */
  function revealDelta(item, menu, pad) {
    const gap = pad === undefined ? REVEAL_PAD : pad;
    if (item.top < menu.top) return item.top - menu.top - gap;
    if (item.bottom > menu.bottom) return item.bottom - menu.bottom + gap;
    return 0;
  }

  function attach(menu) {
    const paintFade = () => {
      const fade = fadeOf(menu.scrollTop, menu.scrollHeight, menu.clientHeight);
      if (fade) menu.dataset.fade = fade;
      else delete menu.dataset.fade;
    };
    const revealActive = () => {
      const active = menu.querySelector('.nav-item.active');
      if (!active) return;
      const delta = revealDelta(active.getBoundingClientRect(), menu.getBoundingClientRect());
      if (delta) menu.scrollTop += delta; // só o menu rola (scrollIntoView também moveria outras áreas)
    };
    const update = () => {
      revealActive();
      paintFade();
    };
    menu.addEventListener('scroll', paintFade, { passive: true });
    if (typeof MutationObserver === 'function') new MutationObserver(update).observe(menu, { attributes: true, attributeFilter: ['class'], subtree: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(menu);
    window.addEventListener('resize', update);
    update();
    return { update };
  }

  window.RiceSidebarMenu = { fadeOf, revealDelta, attach };
  const menu = document.getElementById('side-menu');
  if (menu) window.RiceSidebarMenu.instance = attach(menu);
})();
