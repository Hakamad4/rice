import { locale, t, type UiLanguage } from '../i18n';
import { escapeHtml, markdownToHtml } from './markdown-html';

export type PrintInput = {
  title: string;
  startedAt: string;
  participants: string[];
  notes: string;
  /** Texto de `transcricao.md`; ausente = a página não leva a transcrição. */
  transcript?: string;
  language: UiLanguage;
};

const SEGMENT = /^\*\*\[(\d{2}:\d{2}:\d{2})\]\s+(.+?):\*\*\s*(.*)$/;
const GAP = /^\*\[(.+)\]\*$/;
const MINE = ['Eu', 'Me'];
const OTHERS = ['Outros', 'Others'];

function transcriptHtml(raw: string, language: UiLanguage): string {
  const rows: string[] = [];
  for (const raw1 of raw.split('\n')) {
    const line = raw1.trim();
    if (!line || line.startsWith('# ')) continue;
    const seg = SEGMENT.exec(line);
    if (seg) {
      const who = MINE.includes(seg[2]!) ? t('transcript.me', undefined, language) : OTHERS.includes(seg[2]!) ? t('transcript.others', undefined, language) : seg[2]!;
      rows.push(`<p class="row"><span class="clock">${escapeHtml(seg[1]!)}</span> <b>${escapeHtml(who)}</b> ${escapeHtml(seg[3]!)}</p>`);
    } else {
      const gap = GAP.exec(line);
      rows.push(`<p class="row gap">${escapeHtml(gap ? gap[1]! : line)}</p>`);
    }
  }
  return rows.join('\n');
}

const CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1f1f1d; margin: 0; }
  h1 { font-size: 22pt; line-height: 1.2; margin: 0 0 4pt; letter-spacing: -0.01em; }
  .meta { color: #6f6f6a; font-size: 10pt; margin: 0 0 2pt; }
  header { margin-bottom: 20pt; padding-bottom: 12pt; border-bottom: 1px solid #dcdcd8; }
  h2, h3, h4 { line-height: 1.3; margin: 16pt 0 4pt; break-after: avoid; }
  h2 { font-size: 14pt; } h3 { font-size: 12pt; } h4 { font-size: 11pt; }
  p { margin: 0 0 7pt; } ul, ol { margin: 0 0 7pt; padding-left: 18pt; } li { margin: 1.5pt 0; break-inside: avoid; } li.task { list-style: none; margin-left: -14pt; }
  code { font: 9.5pt ui-monospace, Menlo, monospace; background: #f1f1ee; padding: 0 3pt; border-radius: 3pt; }
  a { color: inherit; }
  section.transcript { margin-top: 26pt; padding-top: 12pt; border-top: 1px solid #dcdcd8; }
  section.transcript h2 { font-size: 11pt; color: #6f6f6a; text-transform: uppercase; letter-spacing: .06em; margin-top: 0; }
  .row { font-size: 9.5pt; margin: 0 0 5pt; break-inside: avoid; } .row .clock { color: #9a9a95; font-variant-numeric: tabular-nums; margin-right: 4pt; } .row.gap { color: #9a9a95; font-style: italic; }
`;

/**
 * Página de impressão do PDF: título, data, participantes, notas e (opcional) transcrição. Tudo que vem dos arquivos passa por `escapeHtml`;
 * a CSP proíbe qualquer script, imagem ou rede, e a janela que imprime também roda sem JavaScript.
 */
export function buildPrintHtml(input: PrintInput): string {
  const { language } = input;
  const started = new Date(input.startedAt);
  const when = Number.isNaN(started.getTime())
    ? ''
    : `${started.toLocaleDateString(locale(language), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${started.toLocaleTimeString(locale(language), { hour: '2-digit', minute: '2-digit' })}`;
  const notes = input.notes.trim() ? markdownToHtml(input.notes) : `<p class="meta">${escapeHtml(t('pdf.no-notes', undefined, language))}</p>`;
  return `<!doctype html>
<html lang="${language === 'en' ? 'en' : 'pt-BR'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(input.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>${escapeHtml(input.title)}</h1>
${when ? `<p class="meta">${escapeHtml(when)}</p>` : ''}
${input.participants.length > 0 ? `<p class="meta">${escapeHtml(t('pdf.participants', undefined, language))}: ${escapeHtml(input.participants.join(', '))}</p>` : ''}
</header>
<main>
${notes}
</main>
${input.transcript === undefined ? '' : `<section class="transcript">\n<h2>${escapeHtml(t('pdf.transcript', undefined, language))}</h2>\n${transcriptHtml(input.transcript, language)}\n</section>`}
</body>
</html>
`;
}
