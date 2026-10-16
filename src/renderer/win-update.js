// Windows: o ponto discreto no item Configurações quando há versão para baixar ou instalar (a tela de Atualizações é a RiceUpdatePage).
(function () {
  const hasNews = (state) => Boolean(state && state.supported && (state.phase === 'available' || state.phase === 'downloaded'));

  window.RiceWinUpdate = { hasNews };
})();
