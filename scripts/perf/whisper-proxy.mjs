#!/usr/bin/env node
// Proxy de medição do whisper-server: sobe o servidor REAL numa porta interna e atende na porta pedida (--port), repassando tudo.
// Cada /inference vira uma linha JSON em RICE_PERF_WHISPER_LOG: { t, bytes, ms, status, args }. Só para instâncias de medição.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const publicPort = Number(flag('--port'));
const logFile = process.env.RICE_PERF_WHISPER_LOG;
const real = process.env.RICE_PERF_REAL_WHISPER ?? '/opt/homebrew/bin/whisper-server';
const free = () => new Promise((resolve) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const innerPort = await free();
// variações de experimento (só medição): RICE_PERF_THREADS troca o -t; RICE_PERF_EXTRA acrescenta flags; RICE_PERF_TASKPOLICY ("-c utility", "-b"...) sobe sob taskpolicy
let realArgs = args.map((a, i) => (args[i - 1] === '--port' ? String(innerPort) : args[i - 1] === '-t' && process.env.RICE_PERF_THREADS ? process.env.RICE_PERF_THREADS : a));
if (process.env.RICE_PERF_EXTRA) realArgs = [...realArgs, ...process.env.RICE_PERF_EXTRA.split(' ').filter(Boolean)];
const policy = (process.env.RICE_PERF_TASKPOLICY ?? '').split(' ').filter(Boolean);
const child = policy.length ? spawn('/usr/sbin/taskpolicy', [...policy, real, ...realArgs], { stdio: 'ignore' }) : spawn(real, realArgs, { stdio: 'ignore' });
const stop = () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop);
child.on('exit', (code) => process.exit(code ?? 0));
if (logFile) appendFileSync(logFile, JSON.stringify({ event: 'start', t: Date.now(), args: realArgs.join(' '), policy: policy.join(' ') }) + '\n');

createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const t0 = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:${innerPort}${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] ?? 'application/octet-stream' }, ...(req.method === 'POST' ? { body } : {}) });
      const out = Buffer.from(await r.arrayBuffer());
      if (req.url === '/inference' && logFile) appendFileSync(logFile, JSON.stringify({ event: 'inference', t: t0, bytes: body.length, ms: Date.now() - t0, status: r.status }) + '\n');
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/plain' }).end(out);
    } catch {
      res.writeHead(503).end();
    }
  });
}).listen(publicPort, '127.0.0.1');
