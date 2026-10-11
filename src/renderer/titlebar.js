// Faixa do topo alinhada aos semáforos mesmo com zoom (⌘+/⌘−): a faixa escala com a página (48px CSS) e o main
// desce os semáforos nativos para o centro dela; a largura ocupada pelos semáforos (px de tela) vira px CSS.
(function () {
  const TRAFFIC = 92;
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
    try {
      window.rice?.setTitlebarZoom?.(z);
    } catch {
      // sem preload (testes)
    }
  }
  apply();
  window.addEventListener('resize', apply); // mudar o zoom dispara resize
})();
