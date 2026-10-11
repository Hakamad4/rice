/** As notas marcam o que o usuário digitou com comentários HTML (`<!--u:1-->…<!--/u-->`): invisíveis ao ler, mas ruído ao copiar, buscar ou exportar. */
const MARKS = /<!--\/?u(?::\d+)?-->/g;

export const stripUserMarks = (markdown: string): string => markdown.replace(MARKS, '');
