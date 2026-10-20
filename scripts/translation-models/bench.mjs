#!/usr/bin/env node
// Mede o sidecar com um modelo real: latência por frase e RAM.
//   node scripts/translation-models/bench.mjs <rice-translate> <pasta-do-modelo> [prefixo-de-idioma]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [bin, model, prefix = ''] = process.argv.slice(2);
if (!bin || !model) {
  console.error('uso: bench.mjs <rice-translate> <pasta-do-modelo> [prefixo]');
  process.exit(2);
}
const SENTENCES = [
  'We need to ship the new version by Friday, so please send me your comments before the meeting.',
  'Thanks everyone for joining today. Let us start with the budget review for the next quarter.',
  'I think we should wait for the customer feedback before we decide.',
  'Could you share the slides after the call? I would like to read the numbers again.',
  'The team agreed to move the launch to the following week and to keep the scope as it is.',
  'Good morning.',
  'That is a great question, and I do not have the answer right now, but I will find out and write to you.',
  'Please remember that the deadline for the report is the end of the month.',
];
const child = spawn(bin, ['--threads', '1'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout });
const pending = new Map();
let ready;
const up = new Promise((r) => (ready = r));
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.event === 'ready') ready();
  if (m.event === 'translated') pending.get(m.id)?.(m);
});
await up;
const lat = [];
let id = 0;
for (let round = 0; round < 3; round++) {
  for (const text of SENTENCES) {
    const t0 = performance.now();
    await new Promise((resolve) => {
      pending.set(++id, resolve);
      child.stdin.write(`${JSON.stringify({ cmd: 'translate', id, model, prefix, text })}\n`);
    });
    if (round > 0 || lat.length > 0) lat.push(performance.now() - t0); // a primeira inclui o carregamento do modelo
  }
}
lat.sort((a, b) => a - b);
console.log(JSON.stringify({ n: lat.length, medianMs: Math.round(lat[Math.floor(lat.length / 2)]), p95Ms: Math.round(lat[Math.floor(lat.length * 0.95)]) }));
child.stdin.end();
