import * as ort from 'onnxruntime-node';
import { logMelFeatures } from './fbank';

export interface SpeakerEmbedder {
  embed(pcm: Buffer): Promise<number[]>;
  close(): Promise<void>;
}

/**
 * Embedding de voz com o 3D-Speaker CAM++ (ONNX) pelo onnxruntime-node, o mesmo que o VAD já usa: sem dependência nova
 * nem processo extra. Features: `fbank.ts`. Sem arena de memória nem padrão de memória: os trechos têm durações
 * diferentes e a arena guardaria o maior (+100 MB medidos). A sessão é criada ao começar a gravar e liberada em `close()` (RAM volta).
 */
export class OnnxSpeakerEmbedder implements SpeakerEmbedder {
  private closed = false;
  /** Uma inferência por vez: a sessão é de 1 thread e os trechos já chegam em fila. */
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(private readonly session: ort.InferenceSession) {}

  static async create(modelPath: string): Promise<OnnxSpeakerEmbedder> {
    return new OnnxSpeakerEmbedder(await ort.InferenceSession.create(modelPath, { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false }));
  }

  embed(pcm: Buffer): Promise<number[]> {
    const run = this.chain.then(() => this.compute(pcm));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async compute(pcm: Buffer): Promise<number[]> {
    if (this.closed) throw new Error('identificador de vozes parado');
    const samples = new Float32Array(pcm.length >> 1);
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
    const { data, frames } = logMelFeatures(samples);
    if (frames === 0) throw new Error('trecho curto demais para extrair a voz');
    const out = await this.session.run({ x: new ort.Tensor('float32', data, [1, frames, 80]) });
    return Array.from(out.embedding!.data as Float32Array);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.chain.catch(() => undefined);
    await this.session.release();
  }
}
