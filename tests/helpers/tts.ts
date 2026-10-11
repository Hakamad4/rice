import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
let counter = 0;

/** Fala `text` com a voz pt-BR Luciana e devolve um WAV 16 kHz mono s16le. */
export async function ttsWav(text: string, dir: string): Promise<Buffer> {
  const base = join(dir, `tts-${process.pid}-${counter++}`);
  await run('say', ['-v', 'Luciana', '-o', `${base}.aiff`, text]);
  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', `${base}.aiff`, `${base}.wav`]);
  return readFile(`${base}.wav`);
}
