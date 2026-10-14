#!/usr/bin/env node
// Prints de Configurações › Memória em três estados — vazio, montando a memória das reuniões antigas e com fatos — em pt/en,
// claro/escuro, 420 e 1100. Instância isolada e invisível, IA falsa local; a montagem fica "segurada" na 4ª reunião para o print.
// Uso: node scripts/perf/memory-harmony-shots.mjs <saida-dir> [pt-BR|en]
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/memory/harmonia');
const pageOut = resolve(process.argv[4] ?? join(out, '..', 'pagina')); // prints da página Memória (só no código com a página)
const lang = process.argv[3] ?? 'pt-BR';
const en = lang === 'en';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(10, 0, 0, 0); return d; };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localIso = (d) => `${isoDate(d)}T10:00:00-03:00`;
const M = en
  ? [['Acme kickoff', 'Ana asked for a 10% discount. Carlos sends the proposal until Friday.'], ['Acme alignment', 'They agreed to start with the pilot.'], ['Proposal follow-up', 'Carlos: I sent the proposal.'], ['Meeting', 'Quick sync about the pilot dates.']]
  : [['Kickoff Acme', 'A Ana pediu 10% de desconto. O Carlos manda a proposta até sexta.'], ['Alinhamento Acme', 'O time combinou começar pelo piloto.'], ['Retorno da proposta', 'Carlos: mandei a proposta.'], ['Reunião', 'Conversa rápida sobre as datas do piloto.']];
const offsets = [-12, -8, -3, -1];
const people = { participants: ['Ana Silva', 'Carlos Lima'], participantEmails: ['ana.silva@acme.com', 'carlos.lima@acme.com'] };
function seedAll(root) {
  M.forEach(([title, notes], i) => {
    const d = day(offsets[i]);
    const dir = join(root, `${isoDate(d)} 1000 - ${title}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: `id-${i}`, title, startedAt: localIso(d), endedAt: localIso(d), state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [], ...people }));
    writeFileSync(join(dir, 'transcricao.md'), `# T\n\n**[10:00:05] Eu:** ${title}\n\n`);
    writeFileSync(join(dir, 'notas.md'), `## ${en ? 'Summary' : 'Resumo'}\n\n${notes}\n`);
  });
}

let requests = 0;
let holdAt = 0;
let release = null;
const sse = (text) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
const ai = createServer((req, res) => {
  const parts = [];
  req.on('data', (d) => parts.push(d));
  req.on('end', async () => {
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    const system = String(body.system ?? '');
    let text = '{}';
    if (/extract durable facts/.test(system)) {
      requests++;
      if (holdAt && requests === holdAt) await new Promise((r) => (release = r));
      const prompt = String(body.messages?.[0]?.content ?? '');
      const title = /Meeting: (.*)/.exec(prompt)?.[1] ?? '';
      const facts = title === M[0][0]
        ? [{ kind: 'request', who: 'Ana Silva', about: 'discount', text: en ? 'Ana asked for a 10% discount' : 'Ana pediu 10% de desconto', due: null, confidence: 0.9 }, { kind: 'commitment', who: 'Carlos Lima', about: 'proposal', text: en ? 'Carlos sends the proposal until Friday' : 'Carlos manda a proposta até sexta', due: isoDate(day(-9)), confidence: 0.9 }]
        : title === M[1][0] ? [{ kind: 'decision', who: 'Ana Silva', about: 'pilot', text: en ? 'They decided to start with the pilot' : 'Decidiram começar pelo piloto', due: null, confidence: 0.8 }] : [];
      text = JSON.stringify({ facts, resolves: [] });
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(sse(text));
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const aiPort = ai.address().port;

const app = await launch({
  settings: { uiLanguage: lang, transcriptionLanguage: en ? 'en' : 'pt', keepAudio: false, ai: { provider: 'claude-api', models: {}, verified: { 'claude-api': true } } },
  size: [1100, 760],
  seed: (root) => { /* a pasta começa SEM reuniões: o estado vazio de verdade */ void root; },
  env: { RICE_TEST_AI_BASE_URL: `http://127.0.0.1:${aiPort}` },
});
const states = [];
const hasPage = await app.eval(`!!document.getElementById('memory-link')`);
async function openMemory() {
  await app.eval(`document.getElementById('settings-link').click(); 0`);
  await sleep(800);
  await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => b.querySelector('span').textContent === ${JSON.stringify(en ? 'Memory' : 'Memória')}).click(); 0`);
  await sleep(700);
}
async function matrix(state, prefix = 'memoria', dir = out) {
  for (const scheme of ['light', 'dark']) {
    await app.theme(scheme);
    for (const width of [1100, 420]) {
      await app.setSize(width, 760);
      if (width < 500) await app.eval(`document.body.classList.remove('chat-open'); 0`);
      await sleep(700);
      const name = `${prefix}-${state}-${lang}-${scheme}-${width}.png`;
      await app.shot(join(dir, name));
      states.push(name);
    }
  }
  await app.setSize(1100, 760);
}
try {
  await app.eval(`window.rice.saveAiKey('claude-api', 'sk-ant-api03-fake-test-key-0000000000')`);
  await sleep(1200);
  await openMemory();
  await matrix('vazio');
  if (hasPage) {
    mkdirSync(pageOut, { recursive: true });
    await app.eval(`document.getElementById('memory-link').click(); 0`);
    await sleep(900);
    await matrix('vazio', 'pagina', pageOut);
  }
  seedAll(app.root);
  await app.eval(`document.getElementById('home-link').click(); 0`);
  await sleep(600);
  await openMemory();
  holdAt = 4;
  await app.eval(`(() => { const b = [...document.querySelectorAll('.mem-backfill button')].find((x) => /${en ? 'Build memory' : 'Montar memória'}/.test(x.textContent)); b && b.click(); return 0; })()`);
  await sleep(500);
  await app.eval(`[...document.querySelectorAll('.dialog button')].filter((b) => !/${en ? 'Cancel' : 'Cancelar'}/.test(b.textContent)).pop().click(); 0`);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const s = await app.eval(`window.rice.memoryStatus()`);
    if (s.backfill.state === 'running' && s.backfill.done >= 3) break;
  }
  await sleep(600);
  await matrix('montando');
  if (hasPage) {
    await app.eval(`document.getElementById('memory-link').click(); 0`);
    await sleep(900);
    await matrix('montando', 'pagina', pageOut);
  }
  release?.();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await app.eval(`window.rice.memoryStatus()`);
    if (s.backfill.state === 'finished') break;
  }
  await sleep(1200);
  await matrix('com-fatos');
  if (hasPage) {
    await app.eval(`document.getElementById('memory-link').click(); 0`);
    await sleep(1000);
    await matrix('lista', 'pagina', pageOut);
    await app.eval(`document.querySelector('.mp-entity').click(); 0`);
    await sleep(900);
    await matrix('detalhe', 'pagina', pageOut);
  }
} finally {
  await app.close();
  ai.close();
  writeFileSync(join(out, `harmonia-${lang}.json`), JSON.stringify({ lang, shots: states }, null, 2));
  console.log(JSON.stringify({ lang, shots: states.length }));
}
