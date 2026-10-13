/** Perguntas prontas do chat que o usuário salvou (`settings.savedPrompts`). */
export const MAX_SAVED_PROMPTS = 8;
export const MAX_PROMPT_LENGTH = 300;

/** Normaliza a lista vinda do renderer ou do disco: só texto, uma linha, sem repetir (ignorando caixa), no máximo 8. */
export function normalizeSavedPrompts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const text = item.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_LENGTH).trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_SAVED_PROMPTS) break;
  }
  return out;
}
