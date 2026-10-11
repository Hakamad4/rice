// Uso: npx tsx scripts/perf/fbank-check.ts <modelo.onnx> <ref.json> <pasta-com-wavs>   (ref.json: embeddings do sherpa-onnx-node)
// Compara os embeddings do pipeline próprio (fbank + onnxruntime-node) com os de referência do sherpa-onnx.
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import { logMelFeatures } from '../../src/main/asr/fbank';

const [model, refPath, wavDir] = process.argv.slice(2) as [string, string, string];
const ref = JSON.parse(readFileSync(refPath, 'utf8')) as Record<string, number[]>;
const session = await ort.InferenceSession.create(model, { intraOpNumThreads: 1, interOpNumThreads: 1 });
const cos = (a: ArrayLike<number>, b: ArrayLike<number>) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]!; } return d / Math.sqrt(x * y); };
const sims: number[] = [];
for (const [n, expected] of Object.entries(ref)) {
  const wav = readFileSync(`${wavDir}/${n}.wav`);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
  const { data, frames } = logMelFeatures(Float32Array.from(pcm, (v) => v / 32768));
  const out = await session.run({ x: new ort.Tensor('float32', data, [1, frames, 80]) });
  sims.push(cos((out.embedding as ort.Tensor).data as Float32Array, expected));
}
console.log(JSON.stringify({ min: Math.min(...sims), mean: sims.reduce((a, b) => a + b, 0) / sims.length, sims: sims.map((s) => +s.toFixed(4)) }));
