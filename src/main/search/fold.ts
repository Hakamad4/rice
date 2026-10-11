const folded = new Map<string, string>();

/** Letra sem acento e em minúsculas, sempre com UM caractere (senão devolve a própria letra). */
function foldChar(ch: string): string {
  let out = folded.get(ch);
  if (out === undefined) {
    const base = ch.normalize('NFD')[0] ?? ch;
    const lower = base.toLowerCase();
    out = lower.length === 1 ? lower : base.length === 1 ? base : ch;
    folded.set(ch, out);
  }
  return out;
}

/**
 * Texto sem acento e em minúsculas, com o MESMO tamanho do original (depois de NFC): a posição de um trecho
 * no texto dobrado é a posição dele no texto de verdade, o que permite gerar snippets e destaques sem guardar duas versões.
 */
export function fold(text: string): string {
  return text.normalize('NFC').replace(/[^\x00-\x7f]/g, foldChar).toLowerCase();
}

const WORD = /[\p{L}\p{N}]/u;
export const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);

/** Palavras da consulta, já dobradas (sem acento, minúsculas, sem pontuação), sem repetir. */
export function queryTerms(query: string): string[] {
  const words = fold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)];
}

/** Primeira posição de `term` em `text` (ambos dobrados) que começa uma palavra; -1 se não houver. */
export function findWordStart(text: string, term: string, from = 0): number {
  let at = text.indexOf(term, from);
  while (at > 0 && isWordChar(text[at - 1])) at = text.indexOf(term, at + 1);
  return at;
}
