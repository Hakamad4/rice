import { escapeHtml } from '../share/markdown-html';
import type { Receipt } from './egress';

/** HTML do recibo para virar PDF (compliance): título, resumo e uma linha por item; só texto escapado, sem scripts. */
export function receiptHtml(input: { title: string; heading: string; generated: string; receipt: Receipt }): string {
  const rows = input.receipt.rows.map((r) => `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; }
body { font: 13px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 13px; font-weight: 500; color: #555; margin: 0 0 18px; }
.summary { font-size: 15px; font-weight: 600; margin: 0 0 16px; padding: 10px 12px; border: 1px solid #ccc; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; vertical-align: top; padding: 7px 8px; border-bottom: 1px solid #e3e3e3; } th { width: 34%; font-weight: 600; }
.foot { margin-top: 18px; font-size: 11px; color: #777; }
</style></head><body><h1>${escapeHtml(input.heading)}</h1><h2>${escapeHtml(input.title)}</h2><p class="summary">${escapeHtml(input.receipt.summary)}</p><table>${rows}</table><p class="foot">${escapeHtml(input.generated)}</p></body></html>`;
}
