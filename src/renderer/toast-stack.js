// Pilha de avisos (toasts) da janela: UM contêiner fixo, centralizado na coluna principal (sem invadir a barra lateral nem o painel do
// chat), acima do rodapé; vários avisos se empilham em vez de ficarem um por cima do outro. Só createElement.
(function () {
  /** O contêiner (criado na primeira vez). */
  function get() {
    let node = document.getElementById('toast-stack');
    if (!node) {
      node = document.createElement('div');
      node.id = 'toast-stack';
      document.body.append(node);
    }
    return node;
  }
  window.RiceToastStack = { get };
})();
