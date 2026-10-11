import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { modelsDir, whisperServerBinary } from '../../src/main/asr/config';
import { ensureModel, WHISPER_MODEL } from '../../src/main/asr/model-download';
import { createSileroSession, SileroVad } from '../../src/main/asr/silero-vad';
import { transcribePcm } from '../../src/main/asr/transcribe-pcm';
import { WhisperServer } from '../../src/main/asr/whisper-server';
import { readWav } from '../../src/shared/wav';
import { makeTmpDir } from '../helpers/tmp';
import { ttsWav } from '../helpers/tts';
import { wer } from '../helpers/wer';

const enabled = process.env.RICE_ASR_E2E === '1';

describe.skipIf(!enabled)('ASR real (RICE_ASR_E2E=1)', () => {
  let server: WhisperServer;
  beforeAll(async () => {
    server = new WhisperServer({ binary: whisperServerBinary(), modelPath: await ensureModel(WHISPER_MODEL, modelsDir()) });
    await server.start();
  }, 600_000);
  afterAll(() => server?.stop());

  test('transcreve pt-BR com WER < 0,35', async () => {
    const reference = 'Bom dia a todos. Hoje vamos decidir o orçamento do próximo trimestre. A entrega do projeto fica para sexta-feira.';
    const { pcm } = readWav(await ttsWav(reference, await makeTmpDir()));
    const session = await createSileroSession();
    const { segments } = await transcribePcm({ pcm, source: 'sys' }, { createDetector: () => new SileroVad(session), transcriber: server });
    const hypothesis = segments.map((s) => s.text).join(' ');
    expect(segments.every((s) => s.source === 'Outros')).toBe(true);
    expect(wer(reference, hypothesis)).toBeLessThan(0.35);
  }, 120_000);
});
