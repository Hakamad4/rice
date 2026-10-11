/**
 * Log do app: só o que ajuda a diagnosticar (etiqueta, tipo e código do erro). Nunca o texto do erro, caminhos de reuniões,
 * transcrição, notas, perguntas, e-mails nem tokens: mensagens de erro de parser e de rede costumam ecoar pedaços do conteúdo.
 */
export function describeError(err: unknown): string {
  if (typeof err !== 'object' || err === null) return typeof err;
  const e = err as { name?: unknown; code?: unknown; kind?: unknown };
  return [e.name, e.code, e.kind].filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(v)).join(' ') || 'Error';
}

export const logError = (tag: string, err: unknown): void => console.error(`[rice] ${tag}: ${describeError(err)}`);
export const logWarn = (tag: string, err?: unknown): void => console.warn(`[rice] ${tag}${err === undefined ? '' : `: ${describeError(err)}`}`);
