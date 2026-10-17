#!/usr/bin/env node
// rice-audio falso para medições: repete um WAV (s16le 16 kHz mono, RICE_PERF_WAV) em tempo real
// como quadros do mic (a cada 100 ms) e um quadro de silêncio do sistema.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const wav = readFileSync(process.env.RICE_PERF_WAV);
const pcm = wav.subarray(44);
const gapFrames = 15; // 1,5 s de silêncio entre repetições
const frame = (source, ts, data) => {
  const h = Buffer.alloc(13);
  h.writeUInt8(source, 0);
  h.writeBigUInt64LE(BigInt(ts), 1);
  h.writeUInt32LE(data.length, 9);
  process.stdout.write(Buffer.concat([h, data]));
};
// RICE_PERF_CHANNEL=sys: o áudio vai no canal do sistema ("Outros") e o microfone fica em silêncio
const audioSource = process.env.RICE_PERF_CHANNEL === 'sys' ? 2 : 1;
const quietSource = audioSource === 1 ? 2 : 1;
let timer = null;
let seed = 12345;
const floorNoise = () => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < b.length; i += 2) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; b.writeInt16LE((seed >> 16) % 5 - 2, i); }
  return b;
};
createInterface({ input: process.stdin })
  .on('line', (line) => {
    const { cmd } = JSON.parse(line);
    if (process.env.RICE_PERF_AUDIO_LOG) appendFileSync(process.env.RICE_PERF_AUDIO_LOG, JSON.stringify({ t: Date.now(), cmd }) + '\n');
    if (cmd === 'start') {
      if (timer) clearInterval(timer); // um 'start' repetido não pode empilhar timers (dobraria o áudio)
      process.stderr.write('{"event":"started","mic":true,"sys":true}\n');
      let ts = 0;
      let pos = 0;
      let gap = 0;
      timer = setInterval(() => {
        const silence = Buffer.alloc(3200);
        if (gap > 0) {
          gap--;
          frame(audioSource, ts, silence);
        } else {
          const chunk = Buffer.alloc(3200);
          pcm.copy(chunk, 0, pos, Math.min(pos + 3200, pcm.length));
          pos += 3200;
          if (pos >= pcm.length) {
            pos = 0;
            gap = gapFrames;
          }
          frame(audioSource, ts, chunk);
        }
        frame(quietSource, ts, floorNoise()); // ruído de fundo mínimo: zeros digitais fariam o watchdog tratar o canal como morto e reiniciar a captura aos 30 s
        ts += 100;
      }, 100);
    } else if (cmd === 'stop') {
      clearInterval(timer);
      process.stderr.write('{"event":"stopped"}\n');
      process.exit(0);
    }
  })
  .on('close', () => process.exit(0));
