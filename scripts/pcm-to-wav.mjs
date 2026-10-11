#!/usr/bin/env node
// Uso: node scripts/pcm-to-wav.mjs entrada.pcm saida.wav  (s16le 16 kHz mono)
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('uso: pcm-to-wav.mjs entrada.pcm saida.wav');
  process.exit(1);
}
const pcm = readFileSync(input);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(16000, 24);
header.writeUInt32LE(32000, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync(output, Buffer.concat([header, pcm]));
