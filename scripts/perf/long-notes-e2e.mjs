#!/usr/bin/env node
// Execução REAL de notas de uma reunião de 2 h (transcrição sintética) numa instância isolada e invisível (RICE_BENCH=1),
// com o provedor de IA configurado. Mede o tempo, registra o progresso e tira screenshots.
// Uso: node scripts/perf/long-notes-e2e.mjs <pasta-de-saída> [minutos=120]   (requer npm run build:app)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'long-notes-out');
const minutes = Number(process.argv[3] ?? 120);
mkdirSync(outDir, { recursive: true });
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-long-'));
const userData = join(tmp, 'userdata');
const root = join(tmp, 'Rice');
mkdirSync(userData, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const off = -new Date().getTimezoneOffset();
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${clock(d)}${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;

// reunião fictícia: oito assuntos de 15 min, cada um com fatos concretos para a IA extrair
const startedAt = new Date(); startedAt.setHours(14, 0, 0, 0); startedAt.setDate(startedAt.getDate() - 1);
const TOPICS = [
  ['orçamento', 'o orçamento de 2027 fecha em 480 mil reais', 'a Marina vai revisar as premissas de custo até sexta'],
  ['contratação', 'vamos abrir duas vagas de engenharia em novembro', 'o Rafael cuida do anúncio e da triagem'],
  ['roadmap', 'o lançamento do módulo de relatórios fica para 15 de março', 'cortamos a integração com o ERP deste ciclo'],
  ['segurança', 'a auditoria de segurança encontrou três pontos críticos', 'a Camila precisa corrigir o acesso administrativo em duas semanas'],
  ['migração', 'a migração para o novo banco acontece no fim de semana de 22 de novembro', 'o plano de reversão precisa de teste antes'],
  ['clientes', 'o cliente Aurora pediu desconto de dez por cento na renovação', 'decidimos oferecer cinco por cento em troca de contrato de dois anos'],
  ['métricas', 'o churn caiu para 2,1 por cento no trimestre', 'a meta do próximo trimestre é manter abaixo de 2 por cento'],
  ['treinamento', 'a equipe de suporte faz o treinamento novo em dezembro', 'o Bruno prepara o material e a agenda'],
];
const lines = [`# Transcrição — Planejamento trimestral\n`];
const total = Math.floor((minutes * 60) / 6);
for (let i = 0; i < total; i++) {
  const at = new Date(startedAt.getTime() + i * 6000);
  const [topic, fact, action] = TOPICS[Math.floor(i / 150) % TOPICS.length];
  const k = i % 10;
  const text = k === 3 ? `${fact[0].toUpperCase()}${fact.slice(1)}.` : k === 7 ? `${action[0].toUpperCase()}${action.slice(1)}.` : `Sobre ${topic}, o ponto ${i} é alinhar o prazo com o time e confirmar quem fica responsável por cada entrega.`;
  lines.push(`**[${clock(at)}] ${i % 2 === 0 ? 'Outros' : 'Eu'}:** ${text}\n`);
}
const dir = join(root, `${startedAt.toISOString().slice(0, 10)} 14.00 Planejamento trimestral`);
mkdirSync(dir, { recursive: true });
const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 'e2e-long', title: 'Planejamento trimestral', startedAt: iso(startedAt), endedAt: iso(endedAt), sessions: [{ startedAt: iso(startedAt), endedAt: iso(endedAt) }], state: 'done', trigger: 'manual', notesStatus: 'pending', gaps: [] }, null, 2));
writeFileSync(join(dir, 'transcricao.md'), lines.join('\n') + '\n');
const notes = [['confirmar o orçamento de 480 mil', 12], ['ligar para o cliente Aurora sobre o desconto', 95], ['perguntar ao Rafael sobre as vagas', 31]];
writeFileSync(join(dir, 'anotacoes.md'), notes.map((n) => n[0]).join('\n'));
writeFileSync(join(dir, 'anotacoes.json'), JSON.stringify(notes.map(([text, min]) => ({ text, at: iso(new Date(startedAt.getTime() + min * 60_000)) }))));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true }));

const port = 9800 + Math.floor(Math.random() * 150);
const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
  env: { ...process.env, RICE_BENCH: '1', RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logFile = join(outDir, 'app.log');
child.stdout.on('data', (d) => appendFileSync(logFile, d));
child.stderr.on('data', (d) => appendFileSync(logFile, d));

async function session() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && !/nub|alert/.test(t.url)) ?? targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  return {
    eval: async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value,
    shot: async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); },
    metrics: (w, h, dark = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }),
    close: () => ws.close(),
  };
}

const report = { minutes, transcriptChars: lines.join('\n').length, progress: [] };
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(3000);
  const cdp = await session();
  await cdp.metrics(1180, 760);
  const t0 = Date.now();
  const gen = cdp.eval(`window.rice.generateNotes(${JSON.stringify(dir)})`).then((r) => { report.result = r; report.elapsedMs = Date.now() - t0; });
  await sleep(1500);
  // abre a reunião na UI para ver o progresso
  await cdp.eval(`document.querySelector('.meeting')?.click()`);
  let shot = false;
  let last = '';
  while (report.elapsedMs === undefined) {
    const p = await cdp.eval(`window.rice.notesProgress(${JSON.stringify(dir)})`);
    const key = JSON.stringify(p);
    if (key !== last) { last = key; report.progress.push({ atMs: Date.now() - t0, p }); console.log(`${Math.round((Date.now() - t0) / 1000)}s`, key); }
    if (!shot && p?.part === 3) { await cdp.shot(join(outDir, 'progress.png')); shot = true; }
    await sleep(2000);
  }
  await gen;
  await sleep(1500);
  await cdp.eval(`document.querySelector('.meeting')?.click()`);
  await sleep(1500);
  await cdp.shot(join(outDir, 'notes.png'));
  report.notes = readFileSync(join(dir, 'notas.md'), 'utf8');
  report.digestParts = JSON.parse(readFileSync(join(dir, 'extracoes.json'), 'utf8')).parts.length;
  cdp.close();
} finally {
  child.kill('SIGTERM'); // só o PID que este script iniciou
  await sleep(6000);
  if (child.exitCode === null) child.kill('SIGKILL');
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`saída: ${outDir} (userdata ${tmp})`);
}
