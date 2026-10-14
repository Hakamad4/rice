import { t } from '../i18n';
import { renameRetry } from '../platform/fs';
import { isLocalMode, LocalModeError } from '../privacy/local-mode';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

/** `sha256`/`bytes` fixos: para fontes que não publicam o hash nos cabeçalhos (ex.: releases do GitHub); o conferido é sempre este. */
export type ModelSpec = { name: string; url: string; sha256?: string; bytes?: number };
export type DownloadProgress = { receivedBytes: number; totalBytes: number };

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/**
 * Variantes do large-v3-turbo. O padrão é a q5_0: ~0,75 GB de RAM em vez de ~1,7 GB, mesma velocidade
 * e qualidade equivalente em pt-BR nos testes (ver .superpowers/perf-report.md). `RICE_WHISPER_MODEL=f16`
 * (ou `q8_0`) volta ao modelo maior.
 */
export const WHISPER_MODELS = {
  // SHA-256 e tamanho fixos no código: o padrão não depende do hash que o servidor anuncia (q8_0 e f16 só por `RICE_WHISPER_MODEL`)
  q5_0: { name: 'ggml-large-v3-turbo-q5_0.bin', url: `${HF}/ggml-large-v3-turbo-q5_0.bin`, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', bytes: 574_041_195 },
  q8_0: { name: 'ggml-large-v3-turbo-q8_0.bin', url: `${HF}/ggml-large-v3-turbo-q8_0.bin` },
  f16: { name: 'ggml-large-v3-turbo.bin', url: `${HF}/ggml-large-v3-turbo.bin` },
} satisfies Record<string, ModelSpec>;

export function whisperModelFor(variant: string | undefined = process.env.RICE_WHISPER_MODEL): ModelSpec {
  return (variant && Object.hasOwn(WHISPER_MODELS, variant) ? WHISPER_MODELS[variant as keyof typeof WHISPER_MODELS] : undefined) ?? WHISPER_MODELS.q5_0;
}

export const WHISPER_MODEL: ModelSpec = whisperModelFor();

/**
 * Modelo de embedding de voz (3D-Speaker CAM++ zh+en, ONNX, 27 MB) usado para separar "Pessoa 1, 2…" no canal do sistema.
 * SHA-256 do `checksum.txt` da release `speaker-recongition-models` do k2-fsa/sherpa-onnx.
 */
export const SPEAKER_MODEL: ModelSpec = {
  name: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
  bytes: 28_281_164,
};

async function alreadyVerified(path: string): Promise<boolean> {
  try {
    const [info, sidecar] = await Promise.all([stat(path), readFile(`${path}.sha256`, 'utf8')]);
    if (!info.isFile() || info.size <= 0) return false;

    const value = sidecar.trim();
    const currentFormat = /^([0-9a-f]{64}) (\d+)$/.exec(value);
    if (currentFormat) return Number(currentFormat[2]) === info.size;

    if (!/^[0-9a-f]{64}$/.test(value)) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== value) return false;
    await writeFile(`${path}.sha256`, `${value} ${info.size}\n`);
    return true;
  } catch {
    return false;
  }
}

async function closeWriteStream(stream: WriteStream | undefined): Promise<void> {
  if (!stream) return;
  if (!stream.destroyed) stream.destroy();
  if (!stream.closed) await new Promise<void>((resolve) => stream.once('close', () => resolve()));
}

export async function ensureModel(
  spec: ModelSpec,
  dir: string,
  options: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const dest = join(dir, spec.name);
  if (await alreadyVerified(dest)) return dest;
  // Modo 100% local: o modelo precisa já estar baixado (aqui só entra quem ainda não está); avisa em vez de tentar a rede
  if (isLocalMode()) throw new LocalModeError(t('local.mode.model-missing', { name: spec.name }));
  await mkdir(dir, { recursive: true });

  let expectedSha = spec.sha256?.toLowerCase() ?? '';
  let totalBytes = spec.bytes ?? 0;
  if (!spec.sha256) {
    let head: Response;
    try {
      head = await fetch(spec.url, { method: 'HEAD', redirect: 'manual', signal: options.signal });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      throw new Error(`não foi possível baixar o modelo ${spec.name}: ${(err as Error).message}`);
    }
    expectedSha = head.headers.get('x-linked-etag')?.replace(/"/g, '').toLowerCase() ?? '';
    totalBytes = Number(head.headers.get('x-linked-size') ?? head.headers.get('content-length') ?? 0);
    if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
      throw new Error(`não foi possível obter o SHA-256 do modelo ${spec.name} (HTTP ${head.status})`);
    }
  }

  const part = `${dest}.part`;
  let out: WriteStream | undefined;
  try {
    const response = await fetch(spec.url, { signal: options.signal });
    if (!response.ok || !response.body) throw new Error(`não foi possível baixar o modelo ${spec.name}: HTTP ${response.status}`);
    const hash = createHash('sha256');
    let receivedBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer | Uint8Array, _encoding, callback) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(data);
        receivedBytes += data.byteLength;
        try {
          options.onProgress?.({ receivedBytes, totalBytes });
          callback(null, data);
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });
    out = createWriteStream(part);
    await pipeline(
      Readable.fromWeb(response.body as NodeWebReadableStream<Uint8Array>),
      meter,
      out,
      { signal: options.signal },
    );
    const actual = hash.digest('hex');
    if (actual !== expectedSha) throw new Error(`SHA-256 do modelo não confere (esperado ${expectedSha}, obtido ${actual})`);
    await renameRetry(part, dest);
    await writeFile(`${dest}.sha256`, `${actual} ${receivedBytes}\n`);
    return dest;
  } catch (err) {
    await closeWriteStream(out);
    await rm(part, { force: true });
    if (options.signal?.aborted) throw err;
    throw err;
  }
}
