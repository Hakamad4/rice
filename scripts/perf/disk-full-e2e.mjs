#!/usr/bin/env node
// Disco cheio de verdade: imagem de disco pequena como pasta das reuniões, instância isolada (RICE_BENCH=1), áudio falso.
// Enche o volume no meio da gravação, confere o aviso, libera o espaço e confere a recuperação. Limpa tudo no fim.
// Uso: RICE_PERF_WAV=<wav> node scripts/perf/disk-full-e2e.mjs <saida-dir>
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'disk-out');
mkdirSync(outDir, { recursive: true });
const repo = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'rice-disk-'));
const img = join(tmp, 'teste.dmg');
const volName = `RiceTeste${Math.floor(Math.random() * 1e6)}`;
const vol = `/Volumes/${volName}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync('hdiutil', ['create', '-size', '120m', '-fs', 'APFS', '-volname', volName, img], { stdio: 'ignore' });
execFileSync('hdiutil', ['attach', img], { stdio: 'ignore' });
const root = join(vol, 'R');
mkdirSync(root, { recursive: true });
const userData = join(tmp, 'ud');
mkdirSync(userData);
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: true, onboardingDone: true, calendarAsked: true, transcriptionLanguage: 'pt' }));
const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=9${Math.floor(300 + Math.random() * 90)}`], {
  env: { ...process.env, RICE_BENCH: '1', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs') },
  stdio: 'ignore',
});
const port = Number(child.spawnargs.find((a) => a.startsWith('--remote-debugging-port=')).split('=')[1]);
const report = {};
let cdp;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(3000);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = targets.find((x) => x.type === 'page' && !/nub|alert/.test(x.url)) ?? targets.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  cdp = {
    eval: async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value,
    shot: async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); },
    size: (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }),
  };
  await cdp.size(1180, 700);
  const started = await cdp.eval(`window.rice.startRecording({ title: 'Disco cheio' })`);
  const dir = started.dir;
  report.startAlerts = await cdp.eval(`window.rice.alerts()`);
  await sleep(8000);
  // enche o volume
  spawnSync('bash', ['-c', `dd if=/dev/zero of="${vol}/enche.bin" bs=1m 2>/dev/null; true`]);
  report.freeAfterFill = execFileSync('df', ['-k', vol], { encoding: 'utf8' }).split('\n')[1];
  let found = null;
  for (let i = 0; i < 30 && !found; i++) { await sleep(1000); const a = await cdp.eval(`window.rice.alerts()`); found = a.find((x) => x.id === 'storage:audio' || x.id === 'storage:transcript') ? a : null; report.alertsWhenFull = a; }
  report.secondsToAlert = found ? 'ok' : 'não apareceu';
  await cdp.eval(`document.querySelector('.meeting')?.click()`);
  await sleep(1200);
  await cdp.shot(join(outDir, 'disk-full-banner.png'));
  rmSync(join(vol, 'enche.bin'), { force: true });
  let cleared = false;
  for (let i = 0; i < 40 && !cleared; i++) { await sleep(1000); const a = await cdp.eval(`window.rice.alerts()`); cleared = !a.some((x) => x.id === 'storage:audio'); report.alertsAfterFree = a; }
  report.audioAlertCleared = cleared;
  await sleep(3000);
  await cdp.eval(`window.rice.stopRecording()`);
  await sleep(8000);
  report.meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  report.transcript = readFileSync(join(dir, 'transcricao.md'), 'utf8');
  report.files = execFileSync('ls', ['-la', dir], { encoding: 'utf8' });
} finally {
  child.kill('SIGTERM');
  await sleep(6000);
  if (child.exitCode === null) child.kill('SIGKILL');
  spawnSync('hdiutil', ['detach', '-force', vol], { stdio: 'ignore' });
  rmSync(img, { force: true });
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, transcript: undefined }, null, 1));
}
