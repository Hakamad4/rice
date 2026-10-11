import { expect, test } from 'vitest';
import { pcmToWav, readWav } from '../../src/shared/wav';

test('pcmToWav + readWav fazem ida e volta', () => {
  const pcm = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) pcm.writeInt16LE(i - 800, i * 2);
  const wav = pcmToWav(pcm);
  expect(wav.length).toBe(44 + 3200);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(readWav(wav)).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, pcm });
});

test('readWav pula chunks desconhecidos antes de data', () => {
  const base = pcmToWav(Buffer.from([1, 0, 2, 0]));
  const extra = Buffer.alloc(8 + 4);
  extra.write('FLLR', 0);
  extra.writeUInt32LE(4, 4);
  const wav = Buffer.concat([base.subarray(0, 36), extra, base.subarray(36)]);
  wav.writeUInt32LE(wav.length - 8, 4);
  expect(readWav(wav).pcm).toEqual(Buffer.from([1, 0, 2, 0]));
});

test('readWav rejeita arquivo que não é WAV PCM', () => {
  expect(() => readWav(Buffer.from('não é wav'))).toThrow('WAV');
});
