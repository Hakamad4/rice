import { expect, test } from 'vitest';
import { transcribePcm } from '../../src/main/asr/transcribe-pcm';
import type { VoiceDetector } from '../../src/main/asr/silero-vad';
import type { Transcriber } from '../../src/main/asr/whisper-server';

const input = { pcm: Buffer.alloc(3200 * 50), source: 'mic' as const };

function detector(probability: VoiceDetector['probability'] = async () => 0.95): VoiceDetector {
  return { probability, reset() {} };
}

function transcriber(text = 'fala reconhecida'): Transcriber {
  return { async transcribe() { return text; }, async restart() {} };
}

test('transcreve PCM e mapeia mic para source Eu', async () => {
  const result = await transcribePcm(input, { createDetector: () => detector(), transcriber: transcriber() });
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({ source: 'Eu', text: 'fala reconhecida' });
  expect(result.warnings).toEqual([]);
});

test('falha persistente é propagada como erro de transcrição', async () => {
  const alwaysFails: Transcriber = { async transcribe() { throw new Error(''); }, async restart() {} };
  await expect(transcribePcm(input, {
    createDetector: () => detector(),
    transcriber: alwaysFails,
    backoffMs: [0],
  })).rejects.toThrow('transcrição falhou');
});

test('avisos do detector são devolvidos', async () => {
  let windows = 0;
  const sometimesFails = detector(async () => {
    if (windows++ % 5 === 0) throw new Error('VAD intermitente');
    return 0.95;
  });
  const result = await transcribePcm(input, { createDetector: () => sometimesFails, transcriber: transcriber() });
  expect(result.warnings.length).toBeGreaterThan(0);
});
