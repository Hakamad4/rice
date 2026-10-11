// Uso: npx tsx scripts/inspect-frames.ts dump.bin
import { readFileSync } from 'node:fs';
import { FrameDecoder } from '../src/shared/frames';

const frames = new FrameDecoder().push(readFileSync(process.argv[2]!));
for (const source of ['mic', 'sys'] as const) {
  const list = frames.filter((f) => f.source === source);
  const samples = list.reduce((n, f) => n + f.pcm.length / 2, 0);
  let peak = 0;
  for (const f of list) for (let i = 0; i < f.pcm.length; i += 2) peak = Math.max(peak, Math.abs(f.pcm.readInt16LE(i)));
  console.log(`${source}: ${list.length} frames, ${(samples / 16000).toFixed(1)} s, pico ${peak}`);
}
