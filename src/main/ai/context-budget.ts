import { DEFAULT_NUM_CTX } from './local-model';

/**
 * Orçamento de texto de um modelo com janela pequena. `numCtx` é em tokens; o texto em português rende ~3 caracteres por token
 * (conservador). Reserva ~4000 tokens para o prompt-base (instruções, template) e para a resposta.
 * Os limites da nuvem (60 mil caracteres) continuam sendo o teto: um contexto grande não deixa o modelo local mais rápido.
 */
export type ContextBudget = {
  /** Acima disso as notas usam extração por partes (map-reduce). */
  directMaxChars: number;
  /** Tamanho máximo de cada parte da extração. */
  partMaxChars: number;
  /** Transcrição que o chat da reunião envia (o resto da janela fica para notas, anotações, histórico e resposta). */
  chatChars: number;
  /** Contexto do chat entre reuniões. */
  globalChars: number;
};

const CLOUD_CAP = 60_000;

export function localBudget(numCtx: number = DEFAULT_NUM_CTX): ContextBudget {
  const input = Math.max(2_000, numCtx - 4_000);
  const direct = Math.min(CLOUD_CAP, input * 3);
  return { directMaxChars: direct, // a parte repete o último minuto da anterior (sobreposição): sobra ~3000 caracteres de folga
    partMaxChars: Math.max(3_000, Math.min(40_000, Math.floor(direct * 0.7) - 3_000)), chatChars: Math.floor(direct * 0.55), globalChars: Math.floor(direct * 0.55) };
}
