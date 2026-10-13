import { beforeAll, expect, test } from 'vitest';
import { createSileroSession, int16ToFloat32, SileroVad, VAD_WINDOW } from '../../src/main/asr/silero-vad';
import { readWav } from '../../src/shared/wav';
import { makeTmpDir } from '../helpers/tmp';
import { ttsWav } from '../helpers/tts';
import type { InferenceSession } from 'onnxruntime-node';

let session: InferenceSession;
beforeAll(async () => {
  session = await createSileroSession();
});

async function probabilities(vad: SileroVad, samples: Int16Array): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) {
    out.push(await vad.probability(int16ToFloat32(samples.subarray(i, i + VAD_WINDOW))));
  }
  return out;
}

test('int16ToFloat32 normaliza para [-1, 1)', () => {
  expect(Array.from(int16ToFloat32(Int16Array.from([0, 16384, -32768])))).toEqual([0, 0.5, -1]);
});

test('silêncio tem probabilidade baixa', async () => {
  const probs = await probabilities(new SileroVad(session), new Int16Array(16_000));
  expect(Math.max(...probs)).toBeLessThan(0.1);
});

test.skipIf(process.platform !== 'darwin')('fala pt-BR tem probabilidade alta', async () => {
  const { pcm } = readWav(await ttsWav('Bom dia a todos, vamos começar a reunião de planejamento.', await makeTmpDir()));
  const probs = await probabilities(new SileroVad(session), new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2));
  expect(Math.max(...probs)).toBeGreaterThan(0.8);
});

test('janela de tamanho errado lança erro', async () => {
  await expect(new SileroVad(session).probability(new Float32Array(100))).rejects.toThrow('512');
});

test('reset zera o estado', async () => {
  const vad = new SileroVad(session);
  const window = new Float32Array(VAD_WINDOW);
  const first = await vad.probability(window);
  await vad.probability(window.map((_, i) => Math.sin(i / 3) * 0.5));
  vad.reset();
  expect(await vad.probability(window)).toBeCloseTo(first, 5);
});
