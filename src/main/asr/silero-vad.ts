import * as ort from 'onnxruntime-node';
import { sileroModelPath } from './config';

export const VAD_WINDOW = 512;
const CONTEXT = 64;
const STATE_SIZE = 2 * 1 * 128;

export interface VoiceDetector {
  probability(window: Float32Array): Promise<number>;
  reset(): void;
}

export async function createSileroSession(modelPath = sileroModelPath()): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelPath, { intraOpNumThreads: 1, interOpNumThreads: 1 });
}

export function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / 32768;
  return out;
}

/** Silero VAD v5 com estado próprio; a sessão ONNX pode ser compartilhada entre canais. */
export class SileroVad implements VoiceDetector {
  private state = new Float32Array(STATE_SIZE);
  private context = new Float32Array(CONTEXT);
  private readonly sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);

  constructor(private readonly session: ort.InferenceSession) {}

  reset(): void {
    this.state = new Float32Array(STATE_SIZE);
    this.context = new Float32Array(CONTEXT);
  }

  async probability(window: Float32Array): Promise<number> {
    if (window.length !== VAD_WINDOW) throw new Error(`janela do VAD deve ter ${VAD_WINDOW} amostras, recebeu ${window.length}`);
    const input = new Float32Array(CONTEXT + VAD_WINDOW);
    input.set(this.context, 0);
    input.set(window, CONTEXT);
    const result = await this.session.run({
      input: new ort.Tensor('float32', input, [1, input.length]),
      state: new ort.Tensor('float32', this.state, [2, 1, 128]),
      sr: this.sr,
    });
    this.state = Float32Array.from(result.stateN!.data as Float32Array);
    this.context = input.slice(input.length - CONTEXT);
    return (result.output!.data as Float32Array)[0]!;
  }
}
