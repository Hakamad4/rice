/** Fração mínima da janela coberta por outras janelas para ninguém estar vendo os parciais. */
export const COVER_THRESHOLD = 0.95;
/** Amostras seguidas (1 por segundo) coberta para pausar; descoberta basta UMA para retomar. */
export const COVER_POLLS_TO_PAUSE = 2;

/**
 * Há alguém vendo parciais? Janela principal visível E não coberta, ou painel expandido do nub (que também mostra a
 * transcrição ao vivo e fica sempre à frente).
 */
export function partialsWanted(uiVisible: boolean, nubExpanded: boolean, covered = false): boolean {
  return (uiVisible && !covered) || nubExpanded;
}

/**
 * Cobertura da janela principal a partir do `window-cover` do rice-detector (1 Hz). Fora da lista de janelas na tela
 * (minimizada, oculta, outro Space) conta como 100% coberta. Pausa depois de COVER_POLLS_TO_PAUSE amostras seguidas
 * >= COVER_THRESHOLD (um piscar de janela não pausa); uma amostra descoberta já retoma.
 */
export class CoverTracker {
  private streak = 0;
  private _covered = false;

  get covered(): boolean {
    return this._covered;
  }

  sample(onScreen: boolean, fraction: number): boolean {
    const hidden = !onScreen || fraction >= COVER_THRESHOLD;
    if (hidden) {
      this.streak++;
      if (this.streak >= COVER_POLLS_TO_PAUSE) this._covered = true;
    } else {
      this.streak = 0;
      this._covered = false;
    }
    return this._covered;
  }

  /** Sem amostras (detector parou, gravação acabou, janela voltou a ser a única fonte de verdade): volta a pedir parciais. */
  reset(): void {
    this.streak = 0;
    this._covered = false;
  }
}
