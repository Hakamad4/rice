#!/usr/bin/env node
// Carga de fundo MODERADA e COM TETO para simular um Mac "ocupado" (Chrome com abas, IDEs): N processos a ~50% de um núcleo cada
// + pressão de memória (GB tocados e mantidos). Tudo morre sozinho depois de --secs (padrão 360) e quando este processo recebe SIGTERM.
// Uso: node scripts/perf/load-moderate.mjs [--procs=3] [--duty=0.5] [--gb=4] [--secs=360]
import { spawn } from 'node:child_process';

const arg = (n, d) => Number((process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1]);
const procs = arg('procs', 3), duty = arg('duty', 0.5), gb = arg('gb', 4), secs = arg('secs', 360);

if (process.argv[2] === '--worker') {
  // ciclo de 100 ms: ocupa duty*100 ms, dorme o resto
  const end = Date.now() + Number(process.argv[3]) * 1000;
  const d = Number(process.argv[4]);
  const tick = () => {
    if (Date.now() > end) process.exit(0);
    const t = performance.now();
    while (performance.now() - t < d * 100) Math.sqrt(Math.random());
    setTimeout(tick, (1 - d) * 100);
  };
  tick();
} else if (process.argv[2] === '--mem') {
  const end = Date.now() + Number(process.argv[3]) * 1000;
  const chunks = [];
  const total = Number(process.argv[4]);
  for (let i = 0; i < total * 16; i++) { const b = Buffer.alloc(64 * 1024 * 1024); for (let o = 0; o < b.length; o += 4096) b[o] = 1; chunks.push(b); }
  setInterval(() => { for (const b of chunks) for (let o = 0; o < b.length; o += 1 << 20) b[o] ^= 1; if (Date.now() > end) process.exit(0); }, 2000); // mantém as páginas quentes
} else {
  const kids = [];
  for (let i = 0; i < procs; i++) kids.push(spawn(process.execPath, [process.argv[1], '--worker', String(secs), String(duty)], { stdio: 'ignore' }));
  if (gb > 0) kids.push(spawn(process.execPath, [process.argv[1], '--mem', String(secs), String(gb)], { stdio: 'ignore' }));
  const stop = () => { for (const k of kids) try { k.kill('SIGKILL'); } catch {} process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  setTimeout(stop, (secs + 5) * 1000);
  console.log(JSON.stringify({ pids: kids.map((k) => k.pid), procs, duty, gb, secs }));
}
