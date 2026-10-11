/**
 * Vocabulário próprio (nomes, clientes, siglas). Vai em dois lugares: no `prompt` inicial de cada request do
 * whisper-server (campo `prompt` do `/inference`, que vira o initial prompt) e nas notas ("grafias corretas").
 *
 * O whisper aproveita no máximo n_ctx/2 = 224 tokens de prompt e, passando disso, descarta o COMEÇO. Como o prompt
 * leva o vocabulário e depois o contexto do trecho anterior (~200 caracteres), o vocabulário fica limitado a
 * `WHISPER_VOCAB_CHARS` (~120 tokens em português) e é cortado sempre em termos inteiros.
 */
export const WHISPER_VOCAB_CHARS = 350;
const MAX_TERMS = 300;
const MAX_TERM_CHARS = 60;

/** Um termo por linha; também aceita vírgula e ponto e vírgula. Sem duplicados (ignorando maiúsculas), na ordem digitada. */
export function parseVocabulary(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of String(raw ?? '').split(/[\n\r,;]+/)) {
    const term = piece.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_CHARS).trim();
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/** Une listas de termos (as do usuário primeiro) sem repetir. */
export function mergeVocabulary(...lists: readonly (readonly string[])[]): string[] {
  return parseVocabulary(lists.flat().join('\n'));
}

/** Texto do initial prompt do whisper: os termos que cabem, inteiros, separados por vírgula. Vazio se não houver termos. */
export function whisperVocabularyPrompt(terms: readonly string[], maxChars = WHISPER_VOCAB_CHARS): string {
  let out = '';
  for (const term of terms) {
    const next = out ? `${out}, ${term}` : term;
    if (next.length + 1 > maxChars) break; // +1: o ponto final
    out = next;
  }
  return out ? `${out}.` : '';
}
