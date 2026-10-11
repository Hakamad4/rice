import { execFile } from 'node:child_process';
import { open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MEETING_FILES } from '../store/meeting-files';
import { concatM4a, encodeM4a } from './wav-writer';

const run = promisify(execFile);
const RATE = 16_000;
const FRAME_BYTES = 4; // estéreo s16

/**
 * Áudio órfão (app morto no meio da gravação). O WAV é gravado em blocos e o tamanho no cabeçalho só era acertado ao
 * fechar, mas os dados em si estão no arquivo: bastam o tamanho do arquivo e um cabeçalho novo. (Desde R-27 o cabeçalho
 * também é regravado a cada ~10 s; isto cobre o resto e os arquivos de versões antigas.)
 */
export async function repairWavHeader(path: string): Promise<{ durationMs: number } | null> {
  const info = await stat(path);
  if (info.size <= 44) return null;
  const dataBytes = Math.floor((info.size - 44) / FRAME_BYTES) * FRAME_BYTES;
  const handle = await open(path, 'r+');
  try {
    const head = Buffer.alloc(44);
    await handle.read(head, 0, 44, 0);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 36, 40) !== 'data') return null;
    head.writeUInt32LE(36 + dataBytes, 4);
    head.writeUInt32LE(dataBytes, 40);
    await handle.write(head, 0, 44, 0);
  } finally {
    await handle.close();
  }
  return { durationMs: (dataBytes / FRAME_BYTES / RATE) * 1000 };
}

const ORPHAN_WAV = /^audio(-\d+)?\.wav$/;

export type AudioRecoveryOptions = {
  /** `false`: o usuário não quer guardar o áudio; os WAVs órfãos são só apagados. */
  keepAudio: boolean;
  encode?: typeof encodeM4a;
  concat?: typeof concatM4a;
};

export type AudioRecovery = { recovered: boolean; durationMs: number; error?: string };

/**
 * Repara os WAVs órfãos da pasta, codifica para m4a e junta ao `audio.m4a` que já existir (retomadas anteriores).
 * Idempotente: sem WAV órfão não faz nada. Se algo falhar o WAV (já com cabeçalho certo, tocável) fica na pasta.
 */
export async function recoverOrphanAudio(dir: string, options: AudioRecoveryOptions): Promise<AudioRecovery> {
  const files = await readdir(dir);
  const names = files.filter((n) => ORPHAN_WAV.test(n)).sort();
  const encode = options.encode ?? encodeM4a;
  const concat = options.concat ?? concatM4a;
  let total = 0;
  let recovered = false;
  let error: string | undefined;
  // sobras de uma finalização interrompida: a parte da retomada já codificada ainda não juntada ao audio.m4a
  if (files.includes('.audio-junto.m4a')) await rm(join(dir, '.audio-junto.m4a'), { force: true });
  if (files.includes('.audio-retomada.m4a')) {
    try {
      await mergePart(dir, join(dir, '.audio-retomada.m4a'), concat);
      recovered = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  if (names.length === 0) return { recovered, durationMs: 0, ...(error ? { error } : {}) };
  for (const name of names) {
    const wav = join(dir, name);
    try {
      const fixed = await repairWavHeader(wav);
      if (!fixed) {
        await rm(wav, { force: true }); // só o cabeçalho: nada a recuperar
        continue;
      }
      if (!options.keepAudio) {
        await rm(wav, { force: true });
        continue;
      }
      total += fixed.durationMs;
      const part = join(dir, `.audio-recuperado.m4a`);
      await encode(wav, part);
      await mergePart(dir, part, concat);
      await rm(wav, { force: true });
      recovered = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await rm(join(dir, '.audio-recuperado.m4a'), { force: true }).catch(() => {});
      await rm(join(dir, '.audio-junto.m4a'), { force: true }).catch(() => {});
    }
  }
  return { recovered, durationMs: total, ...(error ? { error } : {}) };
}

/** Junta `part` ao audio.m4a (se existir) ou o transforma no audio.m4a. */
async function mergePart(dir: string, part: string, concat: typeof concatM4a): Promise<void> {
  const m4a = join(dir, MEETING_FILES.audio);
  if (await exists(m4a)) {
    const merged = join(dir, '.audio-junto.m4a');
    await concat(m4a, part, merged);
    await rename(merged, m4a);
    await rm(part, { force: true });
  } else {
    await rename(part, m4a);
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** m4a → WAV estéreo 16 kHz (para ler o PCM de novo, ex.: transcrever o que ficou sem texto). */
export async function decodeToWav(m4a: string, wav: string): Promise<void> {
  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '2', m4a, wav]);
}

/** Posição (bytes) e tamanho dos dados do WAV, achados lendo só o início do arquivo. */
export async function wavDataRange(path: string): Promise<{ offset: number; bytes: number }> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    let pos = 12;
    while (pos + 8 <= bytesRead) {
      const id = head.toString('ascii', pos, pos + 4);
      const size = head.readUInt32LE(pos + 4);
      if (id === 'data') {
        const total = (await handle.stat()).size;
        return { offset: pos + 8, bytes: Math.min(size, total - (pos + 8)) };
      }
      pos += 8 + size + (size % 2);
    }
    throw new Error('WAV sem chunk data');
  } finally {
    await handle.close();
  }
}

/** Entrega o WAV estéreo a partir de `fromMs` em pedaços de 100 ms (mic, sys), sem carregar o arquivo inteiro. */
export async function forEachStereoFrame(path: string, fromMs: number, onFrame: (timestampMs: number, mic: Buffer, sys: Buffer) => void | Promise<void>): Promise<void> {
  const { offset, bytes } = await wavDataRange(path);
  const frameBytes = (RATE / 10) * FRAME_BYTES; // 100 ms
  const start = Math.floor((fromMs / 100)) * frameBytes;
  const handle = await open(path, 'r');
  try {
    for (let pos = start; pos < bytes; pos += frameBytes) {
      const want = Math.min(frameBytes, bytes - pos);
      const buf = Buffer.alloc(want);
      await handle.read(buf, 0, want, offset + pos);
      const samples = want / FRAME_BYTES;
      const mic = Buffer.alloc(samples * 2);
      const sys = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) {
        mic.writeInt16LE(buf.readInt16LE(i * 4), i * 2);
        sys.writeInt16LE(buf.readInt16LE(i * 4 + 2), i * 2);
      }
      await onFrame((pos / frameBytes) * 100, mic, sys);
    }
  } finally {
    await handle.close();
  }
}
