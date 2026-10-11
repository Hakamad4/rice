/** Palavras normalizadas: minúsculas, só letras/números/apóstrofo. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);
}

/**
 * Maior prefixo comum (por palavra normalizada) entre dois parciais consecutivos.
 * Devolve as palavras normalizadas confirmadas.
 */
export function committedPrefix(prev: string[], next: string[]): string[] {
  const a = prev.flatMap((w) => normalizeWords(w));
  const b = next.flatMap((w) => normalizeWords(w));
  const out: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i]!);
  return out;
}
