#!/usr/bin/env node
// Auditoria de desempenho nº 2 (instância ISOLADA e INVISÍVEL: RICE_BENCH=1, HOME falso, só os PIDs iniciados aqui).
// Cenários: (a) ocioso no Início, (b) reunião longa (2 h sintéticas) em Notas/Transcrição + rolagem + digitação,
// (c) gravando N min com Ideias + War room (claude FALSO: nenhum token gasto), (d) ocioso depois.
// Uso: RICE_PERF_WAV=<wav> node scripts/perf/audit2.mjs <saida.json> [--rec-min=5] [--idle-min=30] [--lines=1500]
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'audit2.json');
const arg = (n, d) => Number((process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1]);
const recMin = arg('rec-min', 5); // 0 pula a gravação
const idleMin = arg('idle-min', 30);
const lines = arg('lines', 1500);
const repo = resolve(import.meta.dirname, '../..');
const wav = process.env.RICE_PERF_WAV;
if (!wav) throw new Error('defina RICE_PERF_WAV');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HOME falso: `~/.local/bin/claude` é um claude de mentira (sem tokens); os modelos do whisper vêm por link (só leitura)
const tmp = mkdtempSync(join(tmpdir(), 'rice-audit2-'));
const home = join(tmp, 'home');
mkdirSync(join(home, '.local', 'bin'), { recursive: true });
mkdirSync(join(home, 'Library', 'Application Support', 'Rice'), { recursive: true });
symlinkSync(join(homedir(), 'Library', 'Application Support', 'Rice', 'models'), join(home, 'Library', 'Application Support', 'Rice', 'models'));
writeFileSync(join(home, '.local', 'bin', 'claude'), `#!/usr/bin/env node
let s=''; process.stdin.on('data',(d)=>s+=d); process.stdin.on('end',()=>{
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

const port = 9300 + Math.floor(Math.random() * 500);
const result = { startedAt: new Date().toISOString(), phases: {} };
const save = () => writeFileSync(out, JSON.stringify(result, null, 1));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- processos e CPU ----------
const psTable = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString().split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(l); return { pid: +m[1], ppid: +m[2], cmd: m[3] }; });
const kindOf = (c) => /--type=gpu-process/.test(c) ? 'gpu' : /--type=renderer/.test(c) ? 'renderer' : /--type=utility/.test(c) ? 'utility' : /whisper-server/.test(c) ? 'whisper' : /rice-audio|fake-rice-audio/.test(c) ? 'audio' : /rice-detector|fake-rice-detector/.test(c) ? 'detector' : /Electron/.test(c) ? 'main' : 'other';
let mainPid = 0;
function tree() {
  const t = psTable();
  const set = new Set([mainPid]);
  for (let grew = true; grew;) { grew = false; for (const p of t) if (!set.has(p.pid) && set.has(p.ppid)) { set.add(p.pid); grew = true; } }
  return t.filter((p) => set.has(p.pid)).map((p) => ({ ...p, kind: kindOf(p.cmd) }));
}
const cpuSec = (pid) => { try { const v = execFileSync('ps', ['-o', 'cputime=', '-p', String(pid)]).toString().trim(); const parts = v.split(':').map(Number); return parts.reduce((a, x) => a * 60 + x, 0); } catch { return null; } };
const fpMb = (pid) => { try { const o = execFileSync('footprint', ['-p', String(pid)]).toString(); const m = /phys_footprint:\s+([\d.]+)\s+(KB|MB|GB|B)/.exec(o); if (!m) return null; const v = Number(m[1]); return m[2] === 'KB' ? v / 1024 : m[2] === 'GB' ? v * 1024 : m[2] === 'B' ? v / 1048576 : v; } catch { return null; } };
function memory(label) {
  const rows = tree().map((p) => ({ kind: p.kind, pid: p.pid, mb: fpMb(p.pid) })).filter((r) => r.mb !== null);
  const by = {};
  for (const r of rows) by[r.kind] = Math.round(((by[r.kind] ?? 0) + r.mb) * 10) / 10;
  const total = Math.round(rows.reduce((a, r) => a + r.mb, 0));
  log('MEM', label, JSON.stringify(by), 'total', total);
  return { by, total };
}
/** CPU média e pico (janelas de 1 s) por tipo de processo durante `ms`; `during` roda junto. */
async function cpu(ms, during) {
  const procs = tree().filter((p) => ['main', 'renderer', 'gpu', 'whisper', 'utility'].includes(p.kind));
  const last = new Map(procs.map((p) => [p.pid, cpuSec(p.pid)]));
  const acc = {};
  const t0 = Date.now();
  const running = during ? during() : Promise.resolve();
  let doneFlag = false; running.then(() => (doneFlag = true));
  let prev = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(1000);
    const now = Date.now();
    const dt = (now - prev) / 1000; prev = now;
    const perKind = {};
    for (const p of procs) { const c = cpuSec(p.pid); const l = last.get(p.pid); if (c === null || l === null) continue; perKind[p.kind] = (perKind[p.kind] ?? 0) + ((c - l) / dt) * 100; last.set(p.pid, c); }
    for (const [k, v] of Object.entries(perKind)) { const a = (acc[k] ??= { sum: 0, n: 0, peak: 0 }); a.sum += v; a.n++; a.peak = Math.max(a.peak, v); }
    if (during && doneFlag && Date.now() - t0 > 2000) break;
  }
  await running;
  return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, { avgPct: Math.round((a.sum / a.n) * 10) / 10, peakPct: Math.round(a.peak) }]));
}

// ---------- CDP ----------
let cdpWs, cdpId = 0;
const pending = new Map();
async function cdpConnect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && !/nub|alert/.test(t.url)) ?? targets.find((t) => t.type === 'page');
  cdpWs = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => cdpWs.addEventListener('open', r));
  cdpWs.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); });
}
const send = (method, params = {}) => new Promise((r) => { const n = ++cdpId; pending.set(n, r); cdpWs.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

let child;
try {
  // ===== lançamento =====
  const tLaunch = Date.now();
  child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, HOME: home, RICE_BENCH: '1', RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs'), RICE_PERF_WAV: wav, RICE_PERF_CHANNEL: 'sys' },
    stdio: 'ignore',
  });
  mainPid = child.pid;
  for (let i = 0; i < 120; i++) { try { await cdpConnect(); break; } catch { await sleep(250); } }
  for (let i = 0; i < 200; i++) { if (await ev("Boolean(document.getElementById('list')) && Boolean(window.rice)")) break; await sleep(100); }
  result.launchMs = Date.now() - tLaunch;
  log('app pronto em', result.launchMs, 'ms');

  // ===== (a) ocioso no Início =====
  await sleep(15_000);
  await ev("document.getElementById('home-link').click()");
  await sleep(3000);
  result.phases.a = { mem: memory('(a) Início ocioso'), cpu: await cpu(30_000), timers: await ev('typeof performance !== "undefined" ? performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null : null') };
  log('(a) cpu', JSON.stringify(result.phases.a.cpu));
  save();

  // ===== (b) reunião longa: 2 h sintéticas =====
  const dir = await ev("window.rice.createMeeting('Reunião longa sintética')");
  const base = new Date('2026-10-11T10:00:00');
  const clock = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const words = 'orçamento prazo cliente proposta entrega risco equipe roadmap decisão revisão contrato métricas lançamento qualidade integração'.split(' ');
  let tr = '';
  for (let i = 0; i < lines; i++) {
    const s = Math.floor((i / lines) * 7200);
    const who = i % 3 === 0 ? 'Eu' : 'Outros';
    const text = Array.from({ length: 18 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ');
    tr += `**[${clock(s)}] ${who}:** ${text}.\n\n`;
  }
  writeFileSync(join(dir, 'transcricao.md'), tr);
  const notes = ['## Resumo', '', ...Array.from({ length: 40 }, (_, i) => `- Ponto ${i + 1} sobre ${words[i % words.length]} com contexto longo o bastante para ocupar a linha inteira da coluna de notas.`), '', '## Decisões', '', ...Array.from({ length: 30 }, (_, i) => `- [ ] Ação ${i + 1}: acompanhar ${words[(i * 2) % words.length]}`)].join('\n');
  writeFileSync(join(dir, 'notas.md'), notes);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, state: 'done', notesStatus: 'done', startedAt: base.toISOString() }));
  await ev('location.reload()'); await sleep(3500);
  await ev("document.querySelector('.meeting').click()");
  // tempo de abrir a reunião longa: do clique até a aba Notas com o texto renderizado
  const openMs = await ev(`(async () => { const t0 = performance.now(); document.querySelector('.meeting').click(); for (let i = 0; i < 400; i++) { if (document.querySelector('.mt-body .notes-body, .mt-body .md')) break; await new Promise((r) => setTimeout(r, 10)); } return Math.round(performance.now() - t0); })()`);
  await sleep(1500);
  result.phases.b = { openMs, linesInFile: lines };
  // aba Transcrição
  const trMs = await ev(`(async () => { const t0 = performance.now(); [...document.querySelectorAll('.mt-tab')].find((b) => b.textContent.startsWith('Transcri')).click(); for (let i = 0; i < 400; i++) { if (document.querySelectorAll('.transcript .t-row').length > 100) break; await new Promise((r) => setTimeout(r, 10)); } return Math.round(performance.now() - t0); })()`);
  await sleep(1000);
  result.phases.b.transcriptTabMs = trMs;
  result.phases.b.dom = await ev(`({ nodesInPage: document.querySelectorAll('*').length, transcriptRows: document.querySelectorAll('.transcript .t-row').length, transcriptNodes: document.querySelectorAll('.transcript *').length })`);
  result.phases.b.mem = memory('(b) reunião longa aberta (Transcrição)');
  // rolagem: 4 s de ponta a ponta medindo quadros
  result.phases.b.scroll = await ev(`(async () => { const d = document.getElementById('detail'); const max = d.scrollHeight - d.clientHeight; const frames = []; let last = performance.now(); let run = true; const raf = (t) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
    const t0 = performance.now(); while (performance.now() - t0 < 4000) { d.scrollTop = ((performance.now() - t0) / 4000) * max; await new Promise((r) => requestAnimationFrame(r)); } run = false; await new Promise((r) => setTimeout(r, 50));
    const f = frames.slice(2); const avg = f.reduce((a, x) => a + x, 0) / f.length; return { frames: f.length, fps: Math.round(1000 / avg), jank: f.filter((x) => x > 33).length, worstMs: Math.round(Math.max(...f)), scrollHeight: d.scrollHeight }; })()`);
  log('(b) rolagem', JSON.stringify(result.phases.b.scroll));
  // digitação nas anotações: 200 teclas, custo por evento e quadros
  await ev("[...document.querySelectorAll('.mt-tab')].find((b) => b.textContent.startsWith('Notas')).click()"); await sleep(800);
  result.phases.b.typing = await ev(`(async () => { const r0 = document.querySelector('.ann-read'); if (r0) r0.click(); await new Promise((r) => setTimeout(r, 200)); const a = document.querySelector('.ann-edit') || document.querySelector('#detail textarea'); const costs = []; const frames = []; let last = performance.now(); let run = true; const raf = (t) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
    for (let i = 0; i < 200; i++) { const t0 = performance.now(); a.value += 'x' + (i % 10 === 9 ? '\\n- ' : ''); a.dispatchEvent(new Event('input', { bubbles: true })); costs.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 15)); }
    run = false; const f = frames.slice(2); costs.sort((x, y) => x - y); return { events: costs.length, medianMs: +costs[100].toFixed(2), p95Ms: +costs[190].toFixed(2), maxMs: +costs[199].toFixed(2), jank: f.filter((x) => x > 33).length }; })()`);
  log('(b) digitando', JSON.stringify(result.phases.b.typing));
  await ev("document.activeElement && document.activeElement.blur()");
  result.phases.b.cpuIdleOpen = await cpu(20_000);
  save();

  // ===== (c) gravando com Ideias + War room =====
  if (recMin > 0) {
  await ev("document.getElementById('home-link').click()"); await sleep(1000);
  const started = await ev("window.rice.startRecording({ title: 'Gravação de auditoria' })");
  const rdir = started.dir;
  await ev(`(async () => { const d = ${JSON.stringify(rdir)}; await window.rice.warRoomSet(d, { kind: 'warroom' }); await window.rice.warRoomSet(d, { ideasOn: true }); await window.rice.warRoomSet(d, { intervalMin: 2 }); await window.rice.warRoomSet(d, { investigationMin: 2 }); })()`);
  await ev(`document.querySelector('.meeting')?.click()`);
  const snaps = [];
  const cpuRec = await cpu(recMin * 60_000, async () => { for (let m = 1; m <= recMin; m++) { await sleep(60_000); if ([1, 3, recMin].includes(m)) snaps.push([m, memory(`(c) gravando ${m} min`)]); } });
  const wr = await ev(`window.rice.warRoomGet(${JSON.stringify(rdir)}).then((v) => ({ cycles: v.cfg.cycles, ideas: v.ideas.length, facts: v.cfg.facts.length, error: v.state.error }))`);
  const heap = await ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null');
  result.phases.c = { cpu: cpuRec, mem: snaps, warroom: wr, rendererHeapMb: heap, domNodes: await ev('document.querySelectorAll("*").length') };
  log('(c)', JSON.stringify(result.phases.c.cpu), JSON.stringify(wr));
  await ev('window.rice.stopRecording()');
  await sleep(15_000);
  result.phases.c.afterStop15s = memory('(c) 15 s após parar');
  save();
  }

  // ===== (d) ocioso depois =====
  result.phases.d = {};
  const marks = [1, 5, 10, 20, 30].filter((m) => m <= idleMin);
  let elapsed = 0;
  for (const m of marks) {
    await sleep((m - elapsed) * 60_000 - 20_000); // deixa 20 s para medir CPU até o rótulo
    elapsed = m;
    const mem = memory(`(d) ocioso ${m} min`);
    const c = await cpu(20_000);
    result.phases.d[m] = { mem, cpu: c, rendererHeapMb: await ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null') };
    log('(d)', m, JSON.stringify(c));
    save();
  }
  result.endedAt = new Date().toISOString();
  save();
} finally {
  try { cdpWs?.close(); } catch {}
  if (child && child.exitCode === null) {
    child.kill('SIGTERM'); // só o PID iniciado aqui
    await sleep(5000);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  const left = tree().filter((p) => p.pid !== mainPid);
  appendFileSync(out + '.log', `restantes após fechar: ${JSON.stringify(left.map((p) => [p.pid, p.kind]))}\n`);
}
