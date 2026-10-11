import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { modelsDir } from '../../src/main/asr/config';
import { SPEAKER_MODEL } from '../../src/main/asr/model-download';
import { OnnxSpeakerEmbedder } from '../../src/main/asr/speaker-embedder';
import { OnlineSpeakerClusterer } from '../../src/main/asr/speaker-cluster';
import { makeTmpDir } from '../helpers/tmp';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const model = join(modelsDir(), SPEAKER_MODEL.name);
// precisa do modelo já baixado (a primeira gravação com a opção ligada baixa) e do `say` do macOS
const enabled = existsSync(model) && process.platform === 'darwin';

async function say(voice: string, text: string, dir: string, name: string): Promise<Buffer> {
  await run('say', ['-v', voice, '-o', join(dir, `${name}.aiff`), text]);
  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(dir, `${name}.aiff`), join(dir, `${name}.wav`)]);
  return (await readFile(join(dir, `${name}.wav`))).subarray(44);
}

describe.skipIf(!enabled)('identificação de vozes com o modelo real (precisa do modelo baixado)', () => {
  test('3 vozes do `say` viram 3 pessoas, e a mesma voz volta à mesma pessoa', async () => {
    const dir = await makeTmpDir();
    const voices = ['Luciana', 'Eddy (Português (Brasil))', 'Daniel'];
    const texts = ['Bom dia pessoal, vamos começar a reunião revisando as metas do trimestre.', 'Eu preparei os números do orçamento e queria apresentar os custos de infraestrutura.', 'Thanks everyone for joining, I will share the roadmap for the new release.'];
    const order = [0, 1, 2, 0, 2, 1, 0];
    const embedder = await OnnxSpeakerEmbedder.create(model);
    const clusters = new OnlineSpeakerClusterer();
    const ids: Array<number | null> = [];
    for (const [i, who] of order.entries()) {
      const pcm = await say(voices[who]!, texts[who]!, dir, `${i}`);
      ids.push(clusters.assign(await embedder.embed(pcm), (pcm.length / 2 / 16_000) * 1000));
    }
    await embedder.close();
    expect(ids).toEqual([1, 2, 3, 1, 3, 2, 1]);
  }, 60_000);

  test('trecho curto demais para extrair a voz rejeita; depois de fechar, também', async () => {
    const embedder = await OnnxSpeakerEmbedder.create(model);
    await expect(embedder.embed(Buffer.alloc(200))).rejects.toThrow('curto demais');
    await embedder.close();
    await expect(embedder.embed(Buffer.alloc(32_000))).rejects.toThrow('parado');
  }, 30_000);
});
