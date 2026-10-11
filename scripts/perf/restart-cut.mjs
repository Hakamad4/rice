#!/usr/bin/env node
// Mede quanto uma reinicialização da captura corta o áudio, com o rice-audio REAL (instância isolada, RICE_BENCH=1):
// mata o processo rice-audio dessa instância (só o filho dela) e mede o tempo até a captura nova começar a entregar áudio.
// Uso: node scripts/perf/restart-cut.mjs <saida.json>
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'restart-cut.json');
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-cut-'));
const userData = join(tmp, 'ud');
const root = join(tmp, 'R');
mkdirSync(userData); mkdirSync(root);
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true, transcriptionLanguage: 'pt' }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 90);
const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
  env: { ...process.env, RICE_BENCH: '1', RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs') },
  stdio: 'ignore',
});
const report = {};
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(3000);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = targets.find((x) => x.type === 'page' && !/nub|alert/.test(x.url)) ?? targets.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); });
  const ev = (expression) => new Promise((r) => { const n = ++id; pending.set(n, (x) => r(x?.result?.value)); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
  await ev(`window.__ev = []; window.__frames = 0; window.rice.on('session:capture-event', (e) => window.__ev.push({ at: Date.now(), event: e.event, mic: e.mic, sys: e.sys, fatal: e.fatal, message: e.message })); 0`);
  const started = await ev(`window.rice.startRecording({ title: 'Corte' })`);
  report.start = started.ok ? 'ok' : started;
  await sleep(15_000);
  const pid = Number(execFileSync('bash', ['-c', `ps -axo pid=,ppid=,command= | awk -v p=${child.pid} '$2==p && /rice-audio/ {print $1}'`], { encoding: 'utf8' }).trim().split('\n')[0]);
  report.audioPid = pid;
  const killAt = Date.now();
  if (pid) process.kill(pid, 'SIGKILL'); // só o filho desta instância
  await sleep(12_000);
  report.events = (await ev(`window.__ev`)).map((e) => ({ ...e, msAfterKill: e.at - killAt }));
  await ev(`window.rice.stopRecording()`);
  await sleep(3000);
  const dir = started.dir;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  report.gaps = meta.gaps;
  report.state = meta.state;
} finally {
  child.kill('SIGTERM');
  await sleep(6000);
  if (child.exitCode === null) child.kill('SIGKILL');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}
