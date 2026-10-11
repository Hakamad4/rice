// Rolagem da transcrição ao vivo: acompanha o fim só se a pessoa já estava lá (±48 px). Se rolou para cima (para ler as
// anotações, por exemplo), não puxa mais; um botão "Ao vivo" volta ao fim. Anexar no fim não mexe em quem está acima
// (o navegador mantém a âncora de rolagem), então a posição de leitura não pula quando um parcial é trocado.
(function () {
  const THRESHOLD = 48;

  /** `detail`: o contêiner que rola. `button`: o botão flutuante (escondido por padrão). */
  function create({ detail, button }) {
    let active = false;
    const atBottom = () => detail.scrollHeight - detail.scrollTop - detail.clientHeight <= THRESHOLD;
    const paint = () => {
      button.hidden = !active || atBottom();
    };
    const toBottom = () => {
      detail.scrollTop = detail.scrollHeight;
      paint();
    };
    detail.addEventListener('scroll', paint);
    button.addEventListener('click', toBottom);
    return {
      /** Liga/desliga o botão (só existe enquanto a reunião aberta está gravando). */
      setActive(on) {
        active = on;
        paint();
      },
      /** Roda a mudança no DOM; se estava no fim, continua no fim, senão deixa a posição e mostra o botão. */
      follow(mutate) {
        const stick = atBottom();
        mutate();
        if (stick) toBottom();
        else paint();
      },
      atBottom,
    };
  }

  window.RiceLiveScroll = { create, THRESHOLD };
})();
