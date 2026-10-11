#!/usr/bin/env node
// Queda de verdade: grava com áudio falso numa instância isolada (RICE_BENCH=1), mata o app com SIGKILL (só o PID iniciado
// aqui), confere que os filhos morrem, reabre o mesmo user-data-dir e mede o que foi recuperado.
// Uso: RICE_PERF_WAV=<wav> node scripts/perf/crash-e2e.mjs <saida.json> [segundos=40]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'crash.json');
const seconds = Number(process.argv[3] ?? 40);
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-crash-'));
const userData = join(tmp, 'userdata');
const root = join(tmp, 'Rice');
mkdirSync(userData, { recursive: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: true, onboardingDone: true, calendarAsked: true, transcriptionLanguage: 'pt' }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, RICE_BENCH: '1', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs') };
const electron = join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const launch = (port) => spawn(electron, [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
async function page(port) {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(2500);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = targets.find((x) => x.type === 'page' && !/nub|alert/.test(x.url)) ?? targets.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); });
  return { eval: (expression) => new Promise((r) => { const n = ++id; pending.set(n, (x) => r(x?.result?.value)); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }), close: () => ws.close() };
}
const descendants = (pid) => execFileSync('bash', ['-c', `ps -axo pid=,ppid=,command= | awk -v p=${pid} '$2==p || $1==p {print $1}'`], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const report = { seconds };
const portA = 9400 + Math.floor(Math.random() * 90);
const a = launch(portA);
try {
  const pa = await page(portA);
  const started = await pa.eval(`window.rice.startRecording({ title: 'Queda' })`);
  const dir = started.dir;
  const t0 = Date.now();
  await sleep(seconds * 1000);
  report.recordedSeconds = (Date.now() - t0) / 1000;
  const kids = descendants(a.pid);
  report.childrenBeforeKill = kids.length;
  a.kill('SIGKILL'); // só o PID iniciado aqui
  await sleep(6000);
  report.survivors = kids.filter(alive).length;
  const names = readdirSync(dir);
  report.filesAfterCrash = names;
  const wav = names.find((n) => /^audio.*\.wav$/.test(n));
  if (wav) { const b = readFileSync(join(dir, wav)); report.wavHeaderBytes = b.readUInt32LE(40); report.wavFileBytes = b.length - 44; report.wavSecondsInFile = (b.length - 44) / 64000; }
  report.transcriptBefore = readFileSync(join(dir, 'transcricao.md'), 'utf8');
  // reabre
  const portB = 9500 + Math.floor(Math.random() * 90);
  const b = launch(portB);
  try {
    const pb = await page(portB);
    report.recoveredCount = await pb.eval(`window.rice.recoveredCount()`);
    report.metaAfterBoot = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).state;
    const wav2 = readdirSync(dir).find((n) => /^audio.*\.wav$/.test(n));
    if (wav2) { const bb = readFileSync(join(dir, wav2)); report.wavHeaderAfterBoot = bb.readUInt32LE(40); }
    const t1 = Date.now();
    report.recover = await pb.eval(`window.rice.recoverMeeting(${JSON.stringify(dir)})`);
    report.recoverMs = Date.now() - t1;
    report.filesAfterRecover = readdirSync(dir);
    const m4a = join(dir, 'audio.m4a');
    try { report.m4aBytes = statSync(m4a).size; report.m4aSeconds = Number(execFileSync('afinfo', [m4a], { encoding: 'utf8' }).match(/estimated duration: ([\d.]+) sec/)?.[1]); } catch {}
    report.transcriptAfter = readFileSync(join(dir, 'transcricao.md'), 'utf8');
    report.metaFinal = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).state;
    pb.close();
  } finally {
    b.kill('SIGTERM');
    await sleep(6000);
    if (b.exitCode === null) b.kill('SIGKILL');
  }
} finally {
  if (a.exitCode === null) a.kill('SIGKILL');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, transcriptBefore: undefined, transcriptAfter: undefined }, null, 1));
}
