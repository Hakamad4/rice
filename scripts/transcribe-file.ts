// Uso: npx tsx scripts/transcribe-file.ts arquivo.wav [mic|sys]
// O WAV precisa ser 16 kHz mono 16-bit: afconvert -f WAVE -d LEI16@16000 -c 1 entrada saida.wav
import { readFile } from 'node:fs/promises';
import { modelsDir, whisperServerBinary } from '../src/main/asr/config';
import { ensureModel, WHISPER_MODEL } from '../src/main/asr/model-download';
import { createSileroSession, SileroVad } from '../src/main/asr/silero-vad';
import { transcribePcm } from '../src/main/asr/transcribe-pcm';
import { WhisperServer } from '../src/main/asr/whisper-server';
import { readWav } from '../src/shared/wav';

const [file, source = 'mic'] = process.argv.slice(2);
if (!file || (source !== 'mic' && source !== 'sys')) {
  console.error('uso: transcribe-file.ts arquivo.wav [mic|sys]');
  process.exit(1);
}
const wav = readWav(await readFile(file));
if (wav.sampleRate !== 16000 || wav.channels !== 1 || wav.bitsPerSample !== 16) {
  console.error(`WAV precisa ser 16 kHz mono 16-bit (recebido ${wav.sampleRate} Hz, ${wav.channels} canais, ${wav.bitsPerSample} bits)`);
  process.exit(1);
}

let lastPct = -1;
const modelPath = await ensureModel(WHISPER_MODEL, modelsDir(), {
  onProgress: ({ receivedBytes, totalBytes }) => {
    if (!totalBytes) return;
    const pct = Math.floor((receivedBytes / totalBytes) * 100);
    if (pct !== lastPct) process.stderr.write(`\rbaixando modelo: ${(lastPct = pct)}%`);
  },
});
const session = await createSileroSession();
const server = new WhisperServer({ binary: whisperServerBinary(), modelPath });
const t0 = Date.now();
try {
  await server.start();
  console.error(`\nwhisper-server pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const t1 = Date.now();
  const { segments, warnings } = await transcribePcm({ pcm: wav.pcm, source }, {
    createDetector: () => new SileroVad(session),
    transcriber: server,
  });
  for (const warning of warnings) console.error(`aviso: ${warning}`);
  for (const s of segments) console.log(`[${(s.startMs / 1000).toFixed(1)}–${(s.endMs / 1000).toFixed(1)}] ${s.source}: ${s.text}`);
  const audioSeconds = wav.pcm.length / 32000;
  console.error(`${audioSeconds.toFixed(1)} s de áudio em ${((Date.now() - t1) / 1000).toFixed(1)} s`);
} finally {
  await server.stop();
}
