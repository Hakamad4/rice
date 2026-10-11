#!/usr/bin/env node
// Sobe uma instância ISOLADA do Rice (user-data-dir temporário, áudio falso) e mede os cenários.
// Uso: node scripts/perf/drive.mjs <saida.md> [--idle-min=10] [--rec-min=2]
// Requer: npm run build:app, RICE_PERF_WAV (padrão: o do scratch), whisper-server e modelo instalados.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'perf-run.md');
const arg = (name, d) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `=${d}`).split('=')[1]);
const idleMin = arg('idle-min', 10);
const recMin = arg('rec-min', 2);
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-perf-'));
const userData = join(tmp, 'userdata');
const root = join(tmp, 'Rice');
mkdirSync(userData, { recursive: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true }));
const wav = process.env.RICE_PERF_WAV;
if (!wav) throw new Error('defina RICE_PERF_WAV (wav 16 kHz mono s16le)');
const port = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => { appendFileSync(out, `${s}\n`); console.log(s); };
const ignore = execFileSync('bash', ['-c', "ps -axo pid=,ppid=,command= | awk '$2==1 && /whisper-server|rice-audio|rice-detector/ {print $1}'"]).toString().split('\n').join(' ');

writeFileSync(out, `# Execução ${new Date().toISOString()} (user-data-dir ${userData})\n\n`);
const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
  env: { ...process.env, RICE_BENCH: '1', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs'), RICE_PERF_WAV: wav },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => appendFileSync(join(tmp, 'app.log'), d));
child.stderr.on('data', (d) => appendFileSync(join(tmp, 'app.log'), d));
const snap = (label) => log('```\n' + execFileSync(join(repo, 'scripts/measure-memory.sh'), [String(child.pid), label], { env: { ...process.env, RICE_MEASURE_IGNORE: ignore } }).toString() + '```\n');

async function cdp(expr) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && !/nub|alert/.test(t.url)) ?? targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const res = await new Promise((resolve) => {
    ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  return res?.result?.value;
}

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(10_000); // dá tempo do warmup (hoje: 2 s + carga do modelo)
  snap('(a) ocioso depois de abrir (10 s)');
  const t0 = Date.now();
  const started = await cdp(`window.rice.startRecording({ title: 'perf' })`);
  log(`startRecording → ${JSON.stringify(started)} (${Date.now() - t0} ms)\n`);
  await sleep(recMin * 30_000);
  snap(`(b) gravando ${recMin / 2} min`);
  await sleep(recMin * 30_000);
  snap(`(b) gravando ${recMin} min`);
  await cdp(`window.rice.stopRecording()`);
  await sleep(3_000);
  snap('(c) 3 s depois de parar (notas)');
  await sleep(30_000);
  snap('(c) 30 s depois de parar');
  await sleep(idleMin * 60_000);
  snap(`(d) ${idleMin} min ocioso depois`);
} finally {
  const pid = child.pid;
  child.kill('SIGTERM'); // só o PID que este script iniciou
  await sleep(8_000);
  if (child.exitCode === null) child.kill('SIGKILL');
  await sleep(3_000);
  log('após SIGTERM (órfãos?):\n```\n' + execFileSync(join(repo, 'scripts/measure-memory.sh'), [String(pid), 'pós-saída'], { env: { ...process.env, RICE_MEASURE_IGNORE: ignore } }).toString() + '```');
  console.log(`app.log: ${join(tmp, 'app.log')}`);
}
