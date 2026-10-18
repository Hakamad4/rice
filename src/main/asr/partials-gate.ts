/** Há alguém vendo parciais? Janela principal visível ou painel expandido do nub (que também mostra a transcrição ao vivo). */
export function partialsWanted(uiVisible: boolean, nubExpanded: boolean): boolean {
  return uiVisible || nubExpanded;
}
