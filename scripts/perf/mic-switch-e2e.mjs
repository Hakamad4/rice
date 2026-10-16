#!/usr/bin/env node
// Teste REAL de gravação com troca de microfone no meio (rice-audio do repositório; nada do Rice do usuário):
//   node scripts/perf/mic-switch-e2e.mjs <uid-inicial> <uid-no-meio> [seg-por-etapa=3]
// Roda o helper em modo controle (como o AudioCapture), grava com <uid-inicial>, troca para <uid-no-meio> e volta ao padrão, e confere:
// timestamps do mic de 100 em 100 ms sem buraco, nenhum evento gap/erro, e nenhum estalo (salto de amostra) nas trocas.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const bin = resolve(import.meta.dirname, '../../native/rice-audio/.build/release/rice-audio');
const [first, second, secs = '3'] = process.argv.slice(2);
const stage = Number(secs) * 1000;
const child = spawn(bin, ['--exclude-pid', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(first ? { RICE_MIC_DEVICE: first } : {}) } });
const events = [];
const frames = { mic: [], sys: [] };
let buf = Buffer.alloc(0);
child.stdout.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  while (buf.length >= 13) {
    const len = buf.readUInt32LE(9);
    if (buf.length < 13 + len) break;
    frames[buf[0] === 1 ? 'mic' : 'sys'].push({ ts: Number(buf.readBigUInt64LE(1)), pcm: Buffer.from(buf.subarray(13, 13 + len)) });
    buf = buf.subarray(13 + len);
  }
});
const t0 = Date.now();
child.stderr.on('data', (c) => c.toString().split('\n').filter((l) => l.startsWith('{')).forEach((l) => events.push({ ...JSON.parse(l), at: Date.now() - t0 })));
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
send({ cmd: 'start' });
await sleep(stage);
const switchAt = frames.mic.length * 100;
if (second) send({ cmd: 'mic-device', id: second });
await sleep(stage);
const backAt = frames.mic.length * 100;
send({ cmd: 'mic-device', id: '' });
await sleep(stage);
send({ cmd: 'stop' });
child.stdin.end();
await new Promise((r) => child.once('close', r));

const mic = frames.mic;
const steps = mic.slice(1).map((f, i) => f.ts - mic[i].ts);
const badSteps = steps.filter((d) => d !== 100 && d !== 0);
let maxJump = 0;
const samples = mic.flatMap((f) => Array.from({ length: f.pcm.length / 2 }, (_, i) => f.pcm.readInt16LE(i * 2)));
for (let i = 1; i < samples.length; i++) maxJump = Math.max(maxJump, Math.abs(samples[i] - samples[i - 1]));
const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const report = {
  micFrames: mic.length,
  micSeconds: samples.length / 16000,
  stepsNot100ms: badSteps.length,
  gaps: events.filter((e) => e.event === 'gap').map((e) => `${e.ms} ms aos ${e.at} ms`),
  errors: events.filter((e) => e.event === 'error'),
  micDevice: events.filter((e) => e.event === 'mic-device').map((e) => `${e.at} ms ${e.reason}:${e.name}${e.chosen ? ' (escolhido)' : ''}${e.isDefault ? ' (padrão)' : ''}`),
  deviceChanged: events.filter((e) => e.event === 'device-changed').length,
  aec: events.filter((e) => e.event === 'aec'),
  peak,
  maxSampleJump: maxJump,
  switchedAtMs: switchAt,
  backAtMs: backAt,
};
console.log(JSON.stringify(report, null, 2));
