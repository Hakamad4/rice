/** As notas marcam o que o usuário digitou com comentários HTML (`<!--u:1-->…<!--/u-->`): invisíveis ao ler, mas ruído ao copiar, buscar ou exportar. */
const MARKS = /<!--\/?u(?::\d+)?-->/g;
/** Citação de uma captura de tela (`<!--shot:101530-->`, numa linha própria): some inteira, com a quebra de linha. */
const SHOT_MARKS = /^[ \t]*<!--shot:[^>]*-->[ \t]*(?:\r?\n|$)/gm;

export const stripUserMarks = (markdown: string): string => markdown.replace(SHOT_MARKS, '').replace(MARKS, '');
