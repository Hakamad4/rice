#!/usr/bin/env node
// Execução REAL das "notas mágicas" numa instância isolada e invisível (RICE_BENCH=1): grava uma conversa com 3 vozes
// (`say`) no canal do sistema, com vocabulário e identificação de participantes, digita anotações durante a gravação,
// gera as notas com o provedor configurado e tira screenshots.
// Uso: RICE_PERF_WAV=<conversa.wav> node scripts/perf/magic-e2e.mjs <saida> [segundos]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'magic-out');
const recSeconds = Number(process.argv[3] ?? 95);
mkdirSync(outDir, { recursive: true });
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-magic-'));
const userData = join(tmp, 'userdata');
const root = join(tmp, 'Rice');
mkdirSync(userData, { recursive: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true, transcriptionLanguage: 'auto', identifySpeakers: true, vocabulary: 'Uirapuru Tecnologia\nJéssica Albuquerque\nOKR\nBem-te-vi' }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 90);
const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
  env: { ...process.env, RICE_BENCH: '1', RICE_PERF_CHANNEL: 'sys', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs') },
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
    size: (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }),
    close: () => ws.close(),
  };
}
const fpMb = (pid) => { try { const m = /phys_footprint:\s+([\d.]+)\s+(KB|MB|GB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8' })); return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null; } catch { return null; } };
const childrenOf = () => execFileSync('bash', ['-c', `ps -axo pid=,ppid=,command= | awk -v p=${child.pid} '{ if ($2 == p || $0 ~ /whisper-server/) print }'`], { encoding: 'utf8' }).split('\n').filter(Boolean);

const report = { recSeconds, procs: [] };
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(3000);
  const cdp = await session();
  await cdp.size(1180, 780);
  const started = await cdp.eval(`window.rice.startRecording({ title: 'Planejamento Uirapuru' })`);
  const dir = started.dir;
  console.log('gravando em', dir);
  const t0 = Date.now();
  const notes = [[18, 'confirmar orçamento de infraestrutura'], [48, 'enviar o roadmap para o time até sexta'], [70, 'revisar premissas de custo com a Jéssica Albuquerque']];
  let typed = '';
  for (const [at, text] of notes) {
    while ((Date.now() - t0) / 1000 < at) await sleep(500);
    typed += (typed ? '\n' : '') + text;
    await cdp.eval(`window.rice.saveAnnotations(${JSON.stringify(dir)}, ${JSON.stringify(typed)})`);
    console.log(`${at}s anotação: ${text}`);
  }
  while ((Date.now() - t0) / 1000 < recSeconds - 8) await sleep(500);
  const ps = childrenOf();
  report.procs = ps.map((l) => { const pid = Number(l.trim().split(/\s+/)[0]); return { cmd: l.trim().replace(/\s+/g, ' ').slice(0, 90), footprintMb: fpMb(pid) }; });
  console.log(JSON.stringify(report.procs, null, 1));
  while ((Date.now() - t0) / 1000 < recSeconds) await sleep(500);
  const tStop = Date.now();
  await cdp.eval(`window.rice.stopRecording()`);
  // espera as notas
  for (let i = 0; i < 180; i++) {
    const m = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    if (m.notesStatus === 'done' || m.notesStatus === 'failed') { report.notesStatus = m.notesStatus; break; }
    await sleep(2000);
  }
  report.notesMs = Date.now() - tStop;
  report.transcript = readFileSync(join(dir, 'transcricao.md'), 'utf8');
  report.notes = readFileSync(join(dir, 'notas.md'), 'utf8');
  report.annotationsJson = readFileSync(join(dir, 'anotacoes.json'), 'utf8');
  report.speakers = readFileSync(join(dir, 'falantes.json'), 'utf8').slice(0, 200);
  await sleep(2500);
  report.leftovers = childrenOf().length;
  // screenshots
  await cdp.eval(`document.querySelector('.meeting')?.click()`);
  await sleep(2000);
  await cdp.eval(`document.getElementById('detail').scrollTop = 0`);
  await cdp.shot(join(outDir, 'notes-top.png'));
  await cdp.eval(`(() => { const n = document.querySelector('.md .from-user'); n?.scrollIntoView({ block: 'center' }); })()`);
  await sleep(500);
  await cdp.shot(join(outDir, 'notes-annotations.png'));
  await cdp.eval(`(() => { const n = document.querySelector('.transcript'); n?.scrollIntoView({ block: 'start' }); })()`);
  await sleep(500);
  await cdp.shot(join(outDir, 'transcript-speakers.png'));
  await cdp.eval(`document.querySelector('.t-who-btn')?.click()`);
  await sleep(600);
  await cdp.shot(join(outDir, 'speaker-popover.png'));
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await cdp.eval(`document.getElementById('settings-link').click()`);
  await sleep(1200);
  await cdp.eval(`document.querySelector('textarea')?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await cdp.shot(join(outDir, 'settings-vocabulary.png'));
  cdp.close();
} finally {
  child.kill('SIGTERM'); // só o PID iniciado aqui
  await sleep(6000);
  if (child.exitCode === null) child.kill('SIGKILL');
  await sleep(1500);
  report.leftoversAfterExit = execFileSync('bash', ['-c', "ps -axo pid=,command= | grep -E 'rice-magic' | grep -v grep | wc -l"], { encoding: 'utf8' }).trim();
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('saída', outDir);
}
