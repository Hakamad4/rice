#!/usr/bin/env node
// WER (palavras) entre um texto de referência e uma hipótese, ambos normalizados (minúsculas, sem acento/pontuação, números como vieram).
// Uso: node scripts/perf/wer.mjs <referencia.txt> <hipotese.txt|transcricao.md> [--show]
import { readFileSync } from 'node:fs';
const clean = (t) => t.replace(/^# .*$/gm, '').replace(/\*\*\[[^\]]*\]\s*[^:]*:\*\*/g, ' ').replace(/\*\[[^\]]*\]\*/g, ' ');
const words = (t) => clean(t).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z0-9']+/).filter(Boolean);
export function wer(ref, hyp) {
  const a = words(ref), b = words(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return { refWords: a.length, hypWords: b.length, errors: d[a.length][b.length], wer: d[a.length][b.length] / a.length };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = wer(readFileSync(process.argv[2], 'utf8'), readFileSync(process.argv[3], 'utf8'));
  console.log(JSON.stringify({ ...r, wer: Math.round(r.wer * 1000) / 10 + '%' }));
}
