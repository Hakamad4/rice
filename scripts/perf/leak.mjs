#!/usr/bin/env node
// Teste de vazamento: grava N minutos seguidos com áudio falso numa instância isolada e invisível (RICE_BENCH=1) e amostra,
// a cada 30 s e depois de forçar GC, o heap do main (via --inspect) e do renderer (CDP) e o footprint dos processos.
// Uso: RICE_PERF_WAV=<wav 16k mono s16le> node scripts/perf/leak.mjs <saida.json> [minutos=10]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outFile = resolve(process.argv[2] ?? 'leak.json');
const minutes = Number(process.argv[3] ?? 10);
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-leak-'));
const userData = join(tmp, 'userdata');
const root = join(tmp, 'Rice');
mkdirSync(userData, { recursive: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true }));
if (!process.env.RICE_PERF_WAV) throw new Error('defina RICE_PERF_WAV');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdpPort = 9600 + Math.floor(Math.random() * 100);
const inspectPort = 9700 + Math.floor(Math.random() * 100);
const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [`--inspect=${inspectPort}`, repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${cdpPort}`], {
  env: { ...process.env, RICE_BENCH: '1', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs') },
  stdio: 'ignore',
});

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); });
  return {
    send: (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); }),
    close: () => ws.close(),
  };
}
const heap = async (c) => {
  await c.send('HeapProfiler.collectGarbage');
  const r = await c.send('Runtime.getHeapUsage');
  return Math.round(r.usedSize / 1048576 * 10) / 10;
};
const footprintMb = (pid) => {
  try {
    const m = /phys_footprint:\s+([\d.]+)\s+(KB|MB|GB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8' }));
    return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null;
  } catch { return null; }
};
const rendererPids = () => execFileSync('bash', ['-c', `ps -axo pid=,ppid=,command= | awk '$2==${child.pid} && /type=renderer/ {print $1}'`], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);

const samples = [];
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${cdpPort}/json`); await fetch(`http://127.0.0.1:${inspectPort}/json`); break; } catch { await sleep(500); } }
  await sleep(4000);
  const main = await connect((await (await fetch(`http://127.0.0.1:${inspectPort}/json`)).json())[0].webSocketDebuggerUrl);
  await main.send('Runtime.enable');
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
  const page = await connect((targets.find((t) => t.type === 'page' && !/nub|alert/.test(t.url)) ?? targets.find((t) => t.type === 'page')).webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  const started = await page.send('Runtime.evaluate', { expression: `window.rice.startRecording({ title: 'leak' })`, awaitPromise: true, returnByValue: true });
  console.log('start', JSON.stringify(started.result.value));
  const t0 = Date.now();
  for (let i = 0; i <= minutes * 2; i++) {
    if (i > 0) await sleep(30_000 - ((Date.now() - t0) % 30_000));
    const s = {
      min: Math.round((Date.now() - t0) / 6000) / 10,
      mainHeapMb: await heap(main),
      rendererHeapMb: await heap(page),
      mainFootprintMb: footprintMb(child.pid),
      rendererFootprintMb: rendererPids().map(footprintMb).filter(Boolean).reduce((a, b) => a + b, 0),
    };
    samples.push(s);
    console.log(JSON.stringify(s));
  }
  main.close(); page.close();
} finally {
  child.kill('SIGTERM'); // só o PID iniciado aqui
  await sleep(8000);
  if (child.exitCode === null) child.kill('SIGKILL');
  writeFileSync(outFile, JSON.stringify(samples, null, 2));
  console.log('saída', outFile);
}
