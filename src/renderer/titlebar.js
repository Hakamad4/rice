// Faixa do topo alinhada aos semáforos mesmo com zoom (⌘+/⌘−): a faixa escala com a página (48px CSS) e o main
// desce os semáforos nativos para o centro dela; a largura ocupada pelos semáforos (px de tela) vira px CSS.
// Windows (classe `platform-win` no body): sem semáforos nem o espaço à esquerda; os botões nativos (titleBarOverlay) ocupam
// ~140px à direita, que viram `--overlay-r` em px CSS.
(function () {
  const WIN = window.rice?.platform === 'win32';
  if (WIN) document.body.classList.add('platform-win');
  // teclas de atalho: ⌘ no Mac, Ctrl no Windows (um ponto só para o teclado e para as dicas na tela)
  window.RiceKeys = { mod: (e) => (WIN ? e.ctrlKey && !e.metaKey : e.metaKey), label: (key) => (WIN ? `Ctrl ${key}` : `⌘${key}`) };
  const TRAFFIC = WIN ? 12 : 92;
  const OVERLAY = 144;
  let last = 0;
  function apply() {
    let zoom = 1;
    try {
      zoom = Number(window.rice?.zoomFactor?.()) || 1; // zoom exato da página (preload/webFrame)
    } catch {
      zoom = 1;
    }
    const z = zoom > 0.25 && zoom < 5 ? zoom : 1;
    if (z === last) return; // resize da janela sem mudar o zoom
    last = z;
    const root = document.documentElement.style;
    root.setProperty('--traffic', `${TRAFFIC / z}px`);
    if (WIN) root.setProperty('--overlay-r', `${OVERLAY / z}px`);
    try {
      window.rice?.setTitlebarZoom?.(z);
    } catch {
      // sem preload (testes)
    }
  }
  apply();
  window.addEventListener('resize', apply); // mudar o zoom dispara resize
})();
