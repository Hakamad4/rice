import type { AudioSource } from '../../shared/frames';
import type { Segment } from '../../shared/types';
import { AsrPipeline } from './pipeline';
import type { VoiceDetector } from './silero-vad';
import type { Transcriber } from './whisper-server';

const FRAME_BYTES = 3200;

export async function transcribePcm(
  input: { pcm: Buffer; source: AudioSource },
  deps: { createDetector: () => VoiceDetector; transcriber: Transcriber; backoffMs?: number[] },
): Promise<{ segments: Segment[]; warnings: string[] }> {
  const pipeline = new AsrPipeline({
    createDetector: deps.createDetector,
    transcriber: deps.transcriber,
    backoffMs: deps.backoffMs,
  });
  const segments: Segment[] = [];
  const warnings: string[] = [];
  let failed = false;
  let lastError: string | undefined;
  pipeline.on('segment', (s: Segment) => segments.push(s));
  pipeline.on('warning', (warning: { source: string; message: string }) => {
    warnings.push(`${warning.source}: ${warning.message}`);
  });
  pipeline.on('status', (s: { state: string; error?: string }) => {
    if (s.state === 'failed') {
      failed = true;
      lastError = s.error;
    }
  });
  for (let offset = 0, t = 0; offset < input.pcm.length; offset += FRAME_BYTES, t += 100) {
    pipeline.pushFrame({ source: input.source, timestampMs: t, pcm: input.pcm.subarray(offset, offset + FRAME_BYTES) });
  }
  await pipeline.finish();
  if (failed) throw new Error(`transcrição falhou: ${lastError ?? 'desconhecido'}`);
  return { segments, warnings };
}
