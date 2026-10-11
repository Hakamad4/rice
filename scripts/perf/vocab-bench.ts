// Uso: npx tsx scripts/perf/vocab-bench.ts [pasta-de-saída]
// Fala frases com nomes difíceis (`say`, voz Luciana), transcreve com o whisper-server real SEM e COM o vocabulário
// no prompt e compara: WER e acertos de grafia exata dos termos (maiúsculas e acentos contam).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whisperServerBinary, modelsDir } from '../../src/main/asr/config';
import { WhisperServer } from '../../src/main/asr/whisper-server';
import { whisperVocabularyPrompt } from '../../src/main/asr/vocabulary';
import { pcmToWav, readWav } from '../../src/shared/wav';
import { ttsWav } from '../../tests/helpers/tts';
import { wer } from '../../tests/helpers/wer';

const TERMS = ['Uirapuru Tecnologia', 'Jéssica Albuquerque', 'OKR', 'Bem-te-vi', 'Itaú BBA', 'Kubernetes', 'Nubank', 'sprint'];
const SENTENCES = [
  'A Jéssica Albuquerque apresentou os OKR do trimestre para a Uirapuru Tecnologia.',
  'O time do Bem-te-vi vai migrar o serviço para o Kubernetes antes da próxima sprint.',
  'O Itaú BBA e o Nubank pediram uma reunião com a Jéssica Albuquerque na sexta.',
  'Precisamos revisar os OKR da Uirapuru Tecnologia e falar com o Itaú BBA.',
  'A Jéssica Albuquerque confirmou que o Nubank entra na sprint de outubro.',
];

const dir = mkdtempSync(join(tmpdir(), 'vocab-'));
const model = join(modelsDir(), 'ggml-large-v3-turbo-q5_0.bin');
const server = new WhisperServer({ binary: whisperServerBinary(), modelPath: model });
await server.start();
const prompt = whisperVocabularyPrompt(TERMS);
let hits = { without: 0, with: 0 };
let total = 0;
const werSum = { without: 0, with: 0 };
const rows: unknown[] = [];
try {
  for (const ref of SENTENCES) {
    const { pcm } = readWav(await ttsWav(ref, dir));
    const wav = pcmToWav(pcm);
    const without = (await server.transcribe(wav, { language: 'pt' })).trim();
    const withVocab = (await server.transcribe(wav, { language: 'pt', prompt })).trim();
    const present = TERMS.filter((t) => ref.includes(t));
    total += present.length;
    hits.without += present.filter((t) => without.includes(t)).length;
    hits.with += present.filter((t) => withVocab.includes(t)).length;
    werSum.without += wer(ref, without);
    werSum.with += wer(ref, withVocab);
    rows.push({ ref, without, with: withVocab });
  }
} finally {
  await server.dispose();
}
const n = SENTENCES.length;
console.log(JSON.stringify({ prompt, termosNasFrases: total, grafiaExata: hits, werMedio: { without: +(werSum.without / n).toFixed(3), with: +(werSum.with / n).toFixed(3) }, rows }, null, 1));
