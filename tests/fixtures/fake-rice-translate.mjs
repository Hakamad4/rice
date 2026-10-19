#!/usr/bin/env node
// Substituto do rice-translate para os testes do cliente e do motor (protocolo de native/translate/src/main.cpp).
// FAKE_TRANSLATE_CRASH_AFTER=n: sai (código 1) depois de n traduções. FAKE_TRANSLATE_DELAY_MS: atraso por tradução.
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const delay = Number(process.env.FAKE_TRANSLATE_DELAY_MS ?? 0);
const crashAfter = Number(process.env.FAKE_TRANSLATE_CRASH_AFTER ?? 0);
let done = 0;
out({ event: 'ready', backend: 'fake', threads: 1 });
const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    if (!m.model) { out({ event: 'error', id: m.id, message: 'missing model' }); continue; }
    if (m.model.includes('broken')) { out({ event: 'error', id: m.id, message: `incomplete model folder: ${m.model}` }); continue; }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    out({ event: 'translated', id: m.id, ms: delay, text: `${m.prefix ?? ''}${basename(m.model)}(${m.text})` });
    done++;
    if (crashAfter && done >= crashAfter) process.exit(1);
  }
  busy = false;
}
createInterface({ input: process.stdin })
  .on('line', (l) => {
    const m = JSON.parse(l);
    if (m.cmd === 'quit') process.exit(0);
    if (m.cmd === 'unload') out({ event: 'unloaded', loaded: 0 });
    if (m.cmd === 'translate') { queue.push(m); void pump(); }
  })
  .on('close', () => process.exit(0));
