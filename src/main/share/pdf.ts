export type PdfWindow = {
  loadURL(url: string): Promise<void>;
  printToPDF(options: Record<string, unknown>): Promise<Buffer>;
  destroy(): void;
};

/** Gera o PDF de uma página HTML numa janela invisível (criada por `createWindow`, sem JavaScript e sem preload) e a destrói em seguida. */
export async function renderPdf(html: string, createWindow: () => PdfWindow): Promise<Buffer> {
  const win = createWindow();
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.printToPDF({ pageSize: 'A4', printBackground: false, margins: { marginType: 'none' }, preferCSSPageSize: true });
  } finally {
    win.destroy();
  }
}

/** Nome de arquivo seguro a partir do título (sem barras nem caracteres que o macOS recusa). */
export function pdfFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${clean || 'Rice'}.pdf`;
}

/** Nome digitado pelo usuário: sem caracteres proibidos, sempre com `.pdf`; vazio volta ao título da reunião. */
export function exportFileName(typed: unknown, title: string): string {
  const raw = String(typed ?? '').trim().replace(/\.pdf$/i, '');
  const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 100);
  return clean ? `${clean}.pdf` : pdfFileName(title);
}

/** `x.pdf` → `x (2).pdf`, `x (3).pdf`… até achar um nome livre na pasta (nunca sobrescreve). */
export async function uniquePath(dir: string, name: string, exists: (path: string) => Promise<boolean>): Promise<string> {
  const base = name.replace(/\.pdf$/i, '');
  for (let n = 1; ; n++) {
    const path = `${dir.replace(/\/+$/, '')}/${n === 1 ? base : `${base} (${n})`}.pdf`;
    if (!(await exists(path))) return path;
  }
}
