#!/usr/bin/env node
// Medição de consumo (CPU/wakeups) DURANTE a gravação. Instância ISOLADA e INVISÍVEL (RICE_BENCH=1, HOME falso, userData temporário,
// só os PIDs iniciados aqui), whisper REAL (via proxy que registra cada requisição), claude FALSO (nenhum token gasto), sob `caffeinate -i`.
// Cenários: rec (só gravar), ideas (gravar com Ideias + War room a cada 2 min), silence (áudio todo em silêncio).
// Uso: RICE_PERF_WAV=<wav 16k mono s16le, cabeçalho de 44 bytes> node scripts/perf/thermal.mjs <saida.json> --scenario=rec|ideas|silence [--min=5] [--label=x]
// Env opcional repassado ao app (ex.: RICE_WHISPER_THREADS) via THERMAL_ENV='{"A":"b"}'.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outFile = resolve(process.argv[2] ?? 'thermal.json');
const opt = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const scenario = opt('scenario', 'rec');
const minutes = Number(opt('min', scenario === 'silence' ? 2 : 5));
const label = opt('label', '');
const loadOn = opt('load', '0') === '1'; // carga de fundo moderada e com teto (scripts/perf/load-moderate.mjs)
const repo = resolve(import.meta.dirname, '../..');
const wav = process.env.RICE_PERF_WAV;
if (!wav) throw new Error('defina RICE_PERF_WAV');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- ambiente isolado ----------
const tmp = mkdtempSync(join(tmpdir(), 'rice-thermal-'));
const home = join(tmp, 'home');
mkdirSync(join(home, '.local', 'bin'), { recursive: true });
mkdirSync(join(home, 'Library', 'Application Support', 'Rice'), { recursive: true });
symlinkSync(join(homedir(), 'Library', 'Application Support', 'Rice', 'models'), join(home, 'Library', 'Application Support', 'Rice', 'models')); // só leitura
writeFileSync(join(home, '.local', 'bin', 'claude'), `#!/usr/bin/env node
const t0=Date.now(); let s=''; process.stdin.on('data',(d)=>s+=d); process.stdin.on('end',()=>{
  require('node:fs').appendFileSync(process.env.HOME+'/ai-calls.jsonl', JSON.stringify({t0,t1:Date.now(),pid:process.pid,stdinBytes:s.length,args:process.argv.slice(2).join(' ').slice(0,200)})+'\\n');
  const text = JSON.stringify([{kind:'idea',text:'Ideia de teste '+Date.now()%1000,source:{type:'audio',ref:'Outros'}}]);
  const o=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
  o({type:'system',subtype:'init',mcp_servers:[]});
  o({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}});
  o({type:'result',subtype:'success',is_error:false,result:text});
});
`);
chmodSync(join(home, '.local', 'bin', 'claude'), 0o755);
const userData = join(tmp, 'ud');
const root = join(tmp, 'R');
mkdirSync(userData, { recursive: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true, transcriptionLanguage: 'pt', ai: { provider: 'claude-sub', models: {}, verified: { 'claude-sub': true } } }));
const whisperLog = join(tmp, 'whisper.jsonl');
writeFileSync(whisperLog, '');
const proxyBin = join(tmp, 'whisper-server-proxy');
writeFileSync(proxyBin, `#!/bin/sh\nexec ${process.execPath} ${join(repo, 'scripts/perf/whisper-proxy.mjs')} "$@"\n`);
chmodSync(proxyBin, 0o755);

// o app roda do bundle em out/ (ignorado pelo git): rebuilda sempre, senão a medição usa código velho
execFileSync('npm', ['run', 'build:app'], { cwd: repo, stdio: 'ignore' });
const cdpPort = 9400 + Math.floor(Math.random() * 300);
const inspectPort = 9800 + Math.floor(Math.random() * 100);
const result = { label, scenario, minutes, startedAt: new Date().toISOString(), commit: execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD']).toString().trim(), tmp };
const save = () => writeFileSync(outFile, JSON.stringify(result, null, 1));

// ---------- processos e CPU ----------
const psTable = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString().split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(l); return { pid: +m[1], ppid: +m[2], cmd: m[3] }; });
const kindOf = (c) => /--type=gpu-process/.test(c) ? 'gpu' : /--type=renderer/.test(c) ? 'renderer' : /--type=utility/.test(c) ? 'utility' : /\/whisper-server( |$)/.test(c) ? 'whisper' : /whisper-proxy|whisper-server-proxy/.test(c) ? 'proxy' : /rice-audio|fake-rice-audio/.test(c) ? 'audio' : /rice-detector|fake-rice-detector/.test(c) ? 'detector' : /\.local\/bin\/claude/.test(c) ? 'ai-cli' : /Electron/.test(c) ? 'main' : 'other';
let mainPid = 0;
function tree() {
  const t = psTable();
  const set = new Set([mainPid]);
  for (let grew = true; grew;) { grew = false; for (const p of t) if (!set.has(p.pid) && set.has(p.ppid)) { set.add(p.pid); grew = true; } }
  return t.filter((p) => set.has(p.pid)).map((p) => ({ ...p, kind: kindOf(p.cmd) }));
}
const gpuUtil = () => { try { const m = /"Device Utilization %"=(\d+)/.exec(execFileSync('ioreg', ['-rc', 'AGXAccelerator', '-d1', '-w0']).toString()); return m ? Number(m[1]) : null; } catch { return null; } };
const cpuSec = (pid) => { try { const v = execFileSync('ps', ['-o', 'cputime=', '-p', String(pid)]).toString().trim(); return v.split(':').map(Number).reduce((a, x) => a * 60 + x, 0); } catch { return null; } };

// ---------- CDP (renderer) e inspector (main) ----------
function wsClient() {
  let ws, id = 0;
  const pending = new Map();
  return {
    async open(url) { ws = new WebSocket(url); await new Promise((r) => ws.addEventListener('open', r)); ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') (this.errors ??= []).push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text); pending.get(d.id)?.(d); }); },
    send: (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); }),
    async ev(expr) { return (await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value; },
  };
}
const page = wsClient();
const mainInspector = wsClient();

const RENDERER_PROBE = `(() => {
  const p = (window.__perf = { timeouts: {}, intervals: {}, raf: 0, mutations: 0, longTasks: 0 });
  const st = window.setTimeout, si = window.setInterval, raf = window.requestAnimationFrame;
  window.setTimeout = function (fn, ms, ...a) { const k = String(ms ?? 0); p.timeouts[k] = (p.timeouts[k] || 0) + 1; return st.call(this, fn, ms, ...a); };
  window.setInterval = function (fn, ms, ...a) { const k = String(ms ?? 0); p.intervals[k] = (p.intervals[k] || 0) + 1; return si.call(this, fn, ms, ...a); };
  window.requestAnimationFrame = function (fn) { p.raf++; return raf.call(this, fn); };
  p.mutBy = {};
  new MutationObserver((l) => { p.mutations += l.length; for (const m of l) { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; const k = (n ? (n.id ? '#' + n.id : n.tagName.toLowerCase() + '.' + String(n.className).split(' ').slice(0, 2).join('.')) : '?') + ':' + m.type + (m.attributeName ? '/' + m.attributeName : ''); p.mutBy[k] = (p.mutBy[k] || 0) + 1; } }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  p.lag = []; p.queue = [];
  window.__recStart = 0;
  try { window.rice.on('session:segment', ({ segment }) => { if (window.__recStart) p.lag.push(Math.round((Date.now() - window.__recStart - segment.endMs))); }); window.rice.on('session:asr-status', (s) => { if (window.__recStart) p.queue.push([Math.round((Date.now() - window.__recStart) / 1000), s.queueSeconds, s.state]); }); } catch {}
  try { new PerformanceObserver((l) => { p.longTasks += l.getEntries().length; }).observe({ entryTypes: ['longtask'] }); } catch {}
})()`;

async function startApp() {
  const env = { ...process.env, HOME: home, RICE_BENCH: '1', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs'), RICE_PERF_WAV: wav, RICE_PERF_CHANNEL: 'sys', RICE_PERF_AUDIO_LOG: join(tmp, 'audio-cmds.jsonl'), RICE_WHISPER_SERVER: proxyBin, RICE_PERF_WHISPER_LOG: whisperLog, ...JSON.parse(process.env.THERMAL_ENV ?? '{}') };
  const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [`--inspect=${inspectPort}`, repo, '--use-mock-keychain', `--user-data-dir=${userData}`, `--remote-debugging-port=${cdpPort}`], { env, stdio: 'ignore' });
  mainPid = child.pid;
  caffeinate = spawn('caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore' }); // segura o sono por inatividade enquanto o app vive
  for (let i = 0; i < 120; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
      const pg = targets.find((t) => t.type === 'page' && !/nub|alert/.test(t.url)) ?? targets.find((t) => t.type === 'page');
      if (!pg) throw new Error('sem página');
      await page.open(pg.webSocketDebuggerUrl);
      const ins = await (await fetch(`http://127.0.0.1:${inspectPort}/json`)).json();
      await mainInspector.open(ins[0].webSocketDebuggerUrl);
      break;
    } catch { await sleep(250); }
  }
  return child;
}

// ambiente limpo: outra instância gravando (ou outro whisper-server) falsifica CPU/GPU; aborta em vez de medir errado
const others = execFileSync('bash', ['-c', "ps -axo pid=,command= | grep -E 'whisper-server|rice-wt/.*/Electron ' | grep -vE 'grep|thermal.mjs' || true"]).toString().trim();
if (others && opt('allow-others', '0') !== '1') { console.error('ABORTA: há outros processos de whisper-server/Electron rodando (falsificam a medição):\n' + others); process.exit(2); }
let child;
let caffeinate;
// limpeza mesmo se este script morrer (SIGPIPE de um `| head`, Ctrl-C, exceção): nunca deixar uma instância gravando para trás
const reap = () => { for (const p of [loadProc, caffeinate, child]) { try { p?.kill('SIGKILL'); } catch {} } };
process.on('exit', reap);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGPIPE']) process.on(sig, () => process.exit(130));
process.stdout.on('error', () => process.exit(0));
var loadProc = null;
const vmStats = () => {
  const swap = execFileSync('sysctl', ['-n', 'vm.swapusage']).toString().trim();
  const vm = execFileSync('vm_stat').toString();
  const num = (k) => Number((new RegExp(k + ':\\s+(\\d+)').exec(vm) ?? [])[1] ?? 0);
  const free = /free percentage:\s+(\d+)%/.exec(execFileSync('memory_pressure').toString());
  return { swap, pageouts: num('Pageouts'), swapouts: num('Swapouts'), compressions: num('Compressions'), freePct: free ? Number(free[1]) : null };
};
const wavSeconds = (readFileSync(wav).length - 44) / 32000;
try {
  child = await startApp();
  for (let i = 0; i < 200; i++) { if (await page.ev("Boolean(document.getElementById('list')) && Boolean(window.rice)")) break; await sleep(100); }
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  if (opt('probe', '1') === '1') await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RENDERER_PROBE });
  await page.ev('location.reload()');
  await sleep(4000);
  for (let i = 0; i < 100; i++) { if (await page.ev("Boolean(document.getElementById('list')) && Boolean(window.rice)")) break; await sleep(100); }
  await mainInspector.send('Runtime.enable');
  log('app pronto, pid', mainPid, 'cenário', scenario, minutes, 'min', 'wav', wavSeconds.toFixed(1), 's');

  const vmBefore = vmStats();
  if (loadOn) {
    loadProc = spawn(process.execPath, [join(repo, 'scripts/perf/load-moderate.mjs'), '--procs=3', '--duty=0.5', '--gb=4', `--secs=${Math.ceil(minutes * 60 + 60)}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    result.load = { pid: loadProc.pid, procs: 3, duty: 0.5, gb: 4 };
    await sleep(25_000); // deixa a pressão de memória e a carga se instalarem antes de gravar
  }
  const started = await page.ev("(() => { window.__recStart = Date.now(); return window.rice.startRecording({ title: 'Medição térmica' }); })()");
  if (!started?.ok) throw new Error('startRecording: ' + JSON.stringify(started));
  const rdir = started.dir;
  if (scenario === 'ideas' || scenario === 'warroom') {
    await page.ev(`(async () => { const d = ${JSON.stringify(rdir)}; await window.rice.warRoomSet(d, { kind: 'warroom' }); await window.rice.warRoomSet(d, { ideasOn: true }); await window.rice.warRoomSet(d, { intervalMin: 2 }); await window.rice.warRoomSet(d, { investigationMin: 2 }); })()`);
  }
  // abre a reunião ao vivo na aba Transcrição (como o usuário veria): o custo de re-render por segmento entra na medição
  result.openLive = await page.ev(`(async () => { try { for (let i = 0; i < 40; i++) { try { await openMeeting(${JSON.stringify(rdir)}); break; } catch (e) { if (i === 39) throw e; await new Promise((r) => setTimeout(r, 250)); } } const tab = [...document.querySelectorAll('.mt-tab')].find((b) => /^Transcri/.test(b.textContent)); tab?.click(); return 'ok ' + document.querySelectorAll('.mt-tab').length; } catch (e) { return 'erro: ' + e.message; } })()`);
  log('abrir reunião ao vivo:', result.openLive);
  result.pageErrors = page.errors ?? [];
  await sleep(1500);
  if (opt('css', '')) await page.ev(`(() => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(opt('css', ''))}; document.head.append(st); })()`); // experimento: CSS extra injetado (ex.: animações desligadas)
  const t0 = Date.now();

  // perfil de CPU do main (inspector) por --profile-main=<segundos>, no meio do cenário: tempo próprio por função
  const profSecs = Number(opt('profile-main', 0));
  let profiled = false;
  async function profileMain() {
    log('perfil do main: iniciando');
    await mainInspector.send('Profiler.enable');
    await mainInspector.send('Profiler.setSamplingInterval', { interval: 500 });
    await mainInspector.send('Profiler.start');
    await sleep(profSecs * 1000);
    const stopped = await mainInspector.send('Profiler.stop');
    log('perfil do main: parado', Object.keys(stopped ?? {}));
    const r = stopped.result ?? stopped;
    const prof = r.profile;
    const self = new Map();
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    prof.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (prof.timeDeltas[i] ?? 0)); });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    result.mainProfile = { seconds: profSecs, busyMsPerSec: Math.round(total / 1000 / profSecs * 10) / 10, top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, Math.round(v / 1000)]) };
  }
  // amostragem de CPU a cada 1 s (cputime por pid), agregada por tipo de processo
  const procs = new Map(); // pid -> { kind, last }
  const series = []; // por segundo: { t, kind: pct }
  const totals = {}; // kind -> { sum, n, peak }
  const refresh = () => { for (const p of tree()) if (!procs.has(p.pid)) procs.set(p.pid, { kind: p.kind, last: cpuSec(p.pid) }); };
  refresh();
  let prev = Date.now();
  const gpuSamples = []; // utilização do dispositivo GPU (sistema inteiro, %) a cada 1 s
  const rendererSamples = [];
  const mainSamples = [];
  let topProc = null;
  let topOut = '';
  while (Date.now() - t0 < minutes * 60_000) {
    await sleep(1000);
    const now = Date.now();
    const dt = (now - prev) / 1000; prev = now;
    refresh();
    const perKind = {};
    for (const [pid, p] of procs) {
      const c = cpuSec(pid);
      if (c === null) { procs.delete(pid); continue; }
      if (p.last !== null) perKind[p.kind] = (perKind[p.kind] ?? 0) + ((c - p.last) / dt) * 100;
      p.last = c;
    }
    const sec = Math.round((now - t0) / 1000);
    gpuSamples.push(gpuUtil());
    series.push({ sec, ...Object.fromEntries(Object.entries(perKind).map(([k, v]) => [k, Math.round(v * 10) / 10])) });
    for (const [k, v] of Object.entries(perKind)) { const a = (totals[k] ??= { sum: 0, n: 0, peak: 0 }); a.sum += v; a.n++; a.peak = Math.max(a.peak, v); }
    if (profSecs > 0 && !profiled && sec >= 20) { profiled = true; void profileMain(); }
    if (sec % 30 === 0) {
      rendererSamples.push({ sec, ...(await page.ev(`(() => { const p = window.__perf; return { timeouts: p.timeouts, intervals: p.intervals, raf: p.raf, mutations: p.mutations, longTasks: p.longTasks, animations: document.getAnimations().length, hidden: document.hidden }; })()`)) });
      const handles = await mainInspector.ev(`(() => { const c = {}; for (const r of process.getActiveResourcesInfo()) c[r] = (c[r] || 0) + 1; return c; })()`);
      mainSamples.push({ sec, handles });
    }
    // top: wakeups ociosos e "power" por processo, uma amostra de 20 s no meio do cenário
    if (!topProc && Date.now() - t0 > (minutes * 60_000) / 2 - 10_000) {
      topProc = spawn('top', ['-l', '2', '-s', '20', '-n', '300', '-o', 'cpu', '-stats', 'pid,command,cpu,idlew']);
      topProc.stdout.on('data', (d) => (topOut += d));
    }
  }
  const split = Number(opt('split', 0)); // segundos: depois disto o áudio é silêncio (cenário warroom: 300)
  const aiFile = join(home, 'ai-calls.jsonl');
  const aiCalls = existsSync(aiFile) ? readFileSync(aiFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  result.aiCalls = { total: aiCalls.length, perMin: Math.round((aiCalls.length / minutes) * 10) / 10, atSec: aiCalls.map((c) => Math.round((c.t0 - t0) / 1000)), stdinBytes: aiCalls.map((c) => c.stdinBytes), msEach: aiCalls.map((c) => c.t1 - c.t0), maxConcurrent: aiCalls.reduce((m, c) => Math.max(m, aiCalls.filter((o) => o.t0 < c.t1 && o.t1 > c.t0).length), 0) };
  if (split > 0) {
    const avgOf = (rows) => { const a = {}; for (const r of rows) for (const [k, v] of Object.entries(r)) if (k !== 'sec') a[k] = (a[k] ?? 0) + v / rows.length; return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v * 10) / 10])); };
    result.phases = { speech: { cpuAvg: avgOf(series.filter((r) => r.sec <= split)), aiCalls: aiCalls.filter((c) => c.t0 - t0 <= split * 1000).length }, silence: { cpuAvg: avgOf(series.filter((r) => r.sec > split)), aiCalls: aiCalls.filter((c) => c.t0 - t0 > split * 1000).length } };
    result.phases.speech.gpuAvg = Math.round(gpuSamples.slice(0, split).filter((x) => x !== null).reduce((a, x, _, arr) => a + x / arr.length, 0));
    result.phases.silence.gpuAvg = Math.round(gpuSamples.slice(split).filter((x) => x !== null).reduce((a, x, _, arr) => a + x / arr.length, 0));
  }
  result.vm = { before: vmBefore, after: vmStats() };
  result.lagQueue = await page.ev(`(() => { const l = window.__perf.lag.slice().sort((a, b) => a - b); const q = window.__perf.queue; return { segments: l.length, lagMs: l.length ? { p50: l[Math.floor(l.length * 0.5)], p95: l[Math.floor(l.length * 0.95)], max: l.at(-1) } : null, queueMaxSec: q.length ? Math.max(...q.map((x) => x[1])) : 0, queueSamples: q.length }; })()`);
  result.cpu = Object.fromEntries(Object.entries(totals).map(([k, a]) => [k, { avgPct: Math.round((a.sum / a.n) * 10) / 10, peakPct: Math.round(a.peak) }]));
  result.cpuSeriesPerMinute = [];
  for (let m = 0; m < minutes; m++) {
    const rows = series.filter((r) => r.sec > m * 60 && r.sec <= (m + 1) * 60);
    const avg = {};
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (k !== 'sec') avg[k] = (avg[k] ?? 0) + v / rows.length;
    result.cpuSeriesPerMinute.push(Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, Math.round(v * 10) / 10])));
  }
  const g = gpuSamples.filter((x) => x !== null);
  result.gpuDeviceUtilPct = g.length ? { avg: Math.round((g.reduce((a, x) => a + x, 0) / g.length) * 10) / 10, peak: Math.max(...g), min: Math.min(...g) } : null;
  result.renderer = rendererSamples.at(-1) && rendererSamples[0] ? { first: rendererSamples[0], last: rendererSamples.at(-1), spanSec: rendererSamples.at(-1).sec - rendererSamples[0].sec } : null;
  result.mainHandles = mainSamples;
  // top: segunda amostra (delta), só os PIDs da árvore
  const ours = new Map(tree().map((p) => [p.pid, p.kind]));
  const blocks = topOut.split(/\nPID\s/);
  const last = blocks.at(-1) ?? '';
  result.topSecondSample = last.split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => /^\d+$/.test(c[0]) && ours.has(Number(c[0]))).map((c) => ({ kind: ours.get(Number(c[0])), pid: Number(c[0]), cmd: c[1], cpu: c.at(-2), idleWakeups: c.at(-1) }));

  result.rendererDetail = await page.ev(`(() => ({ mutBy: Object.entries(window.__perf.mutBy).sort((a, b) => b[1] - a[1]).slice(0, 8), animations: document.getAnimations().map((a) => ({ name: a.animationName || a.transitionProperty || a.constructor.name, target: (a.effect?.target?.id ? '#' + a.effect.target.id : a.effect?.target?.className) , iter: a.effect?.getTiming().iterations, ms: a.effect?.getTiming().duration })) }))()`);
  result.view = await page.ev("({ title: document.getElementById('page-title')?.textContent, rows: document.querySelectorAll('.transcript .t-row').length, partialRows: document.querySelectorAll('.t-partial').length, tab: [...document.querySelectorAll('.mt-tab')].map((b) => b.className + ':' + b.textContent).join('|') })");
  result.thermal = [execFileSync('pmset', ['-g', 'therm']).toString().trim(), execFileSync('pmset', ['-g', 'batt']).toString().split('\n')[0]];
  result.loadAvg = execFileSync('sysctl', ['-n', 'vm.loadavg']).toString().trim();
  await page.ev('window.rice.stopRecording()');
  await sleep(3000);
  // whisper: requisições
  const reqs = readFileSync(whisperLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.event === 'inference');
  const starts = readFileSync(whisperLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.event === 'start');
  const during = reqs.filter((r) => r.t >= t0 && r.t <= t0 + minutes * 60_000);
  const audioSec = (r) => Math.max(0, (r.bytes - 400) / 32000); // multipart ~ 400 B de cabeçalhos + o WAV de 16 kHz s16le
  const busy = during.reduce((a, r) => a + r.ms, 0) / 1000;
  result.whisper = {
    serverArgs: starts.map((s) => s.args),
    requests: during.length,
    requestsPerMin: Math.round((during.length / minutes) * 10) / 10,
    busySec: Math.round(busy * 10) / 10,
    busyPctOfWall: Math.round((busy / (minutes * 60)) * 1000) / 10,
    audioSecSent: Math.round(during.reduce((a, r) => a + audioSec(r), 0) * 10) / 10,
    realtimeFactor: during.length ? Math.round((busy / during.reduce((a, r) => a + audioSec(r), 0)) * 1000) / 1000 : null,
    meanMs: during.length ? Math.round(busy * 1000 / during.length) : 0,
    p95Ms: during.length ? during.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(during.length * 0.95)] : 0,
    meanAudioSec: during.length ? Math.round(during.reduce((a, r) => a + audioSec(r), 0) / during.length * 10) / 10 : 0,
    maxAudioSec: during.length ? Math.round(Math.max(...during.map(audioSec)) * 10) / 10 : 0,
    bytesPerMin: Math.round(during.reduce((a, r) => a + r.bytes, 0) / minutes),
  };
  if (split > 0) {
    const inPhase = (a, b) => during.filter((r) => r.t - t0 > a * 1000 && r.t - t0 <= b * 1000);
    result.whisperPhases = { speechReq: inPhase(0, split).length, silenceReq: inPhase(split, 1e9).length, silenceBusySec: Math.round(inPhase(split, 1e9).reduce((a, r) => a + r.ms, 0) / 100) / 10 };
  }
  result.audioCmds = existsSync(join(tmp, 'audio-cmds.jsonl')) ? readFileSync(join(tmp, 'audio-cmds.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const o = JSON.parse(l); return { cmd: o.cmd, atSec: Math.round((o.t - t0) / 100) / 10 }; }) : [];
  // transcrição final (para comparar qualidade)
  const mdir = readdirSync(root).map((d) => join(root, d)).find((d) => existsSync(join(d, 'transcricao.md')));
  result.transcript = mdir ? readFileSync(join(mdir, 'transcricao.md'), 'utf8') : '';
  result.finals = (result.transcript.match(/^\*\*\[/gm) ?? []).length;
  result.partialsApprox = Math.max(0, during.length - result.finals);
  if (scenario === 'ideas' || scenario === 'warroom') {
    result.warroom = await page.ev(`window.rice.warRoomGet(${JSON.stringify(rdir)}).then((v) => ({ ideasCycles: v.cfg.ideasCycles, investigationCycles: v.cfg.investigationCycles, ideas: v.ideas.length, error: v.state.error }))`);
  }
  save();
  log('CPU', JSON.stringify(result.cpu));
  log('whisper', JSON.stringify(result.whisper));
} finally {
  if (child) {
    try { if (typeof loadProc !== 'undefined' && loadProc) loadProc.kill('SIGTERM'); } catch {}
    caffeinate?.kill('SIGTERM');
    child.kill('SIGTERM'); // só o PID iniciado aqui
    await sleep(8000);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
