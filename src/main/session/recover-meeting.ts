import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { formatSegmentLine, MEETING_FILES, readMeta, readMeetingText, updateMeta } from '../store/meeting-files';
import { meetingSessions } from '../../shared/sessions';
import { toLocalIso } from '../../shared/naming';
import type { Segment, Speaker, TranscriptionLanguage } from '../../shared/types';
import type { AsrPipeline } from '../asr/pipeline';
import { forEachStereoFrame, recoverOrphanAudio, wavDataRange } from './audio-recovery';
import { TranscriptSink } from '../store/transcript-sink';
import { readdir } from 'node:fs/promises';

export type RecoverDeps = {
  createPipeline: (language: TranscriptionLanguage) => Promise<AsrPipeline>;
  generateNotes: (dir: string) => Promise<void>;
  language: (dir: string) => Promise<TranscriptionLanguage>;
  keepAudio: () => boolean;
  encode?: Parameters<typeof recoverOrphanAudio>[1]['encode'];
  concat?: Parameters<typeof recoverOrphanAudio>[1]['concat'];
};

export type RecoverResult = { tailSegments: number; audioRecovered: boolean; notes: boolean };

const LINE = /^\*\*\[(\d{2}):(\d{2}):(\d{2})\]\s+(.+?):\*\*\s*(.*)$/;
const MIN_TAIL_MS = 3000;

/**
 * Último instante (ms desde o início da gravação `startedAt`) já coberto pela transcrição, por canal. A fala mais
 * recente tem só o início, então estimamos o fim pelo tamanho do texto (~15 caracteres por segundo).
 */
export function transcribedUntil(transcript: string, startedAt: Date): Record<Speaker, number> {
  const out: Record<Speaker, number> = { Eu: 0, Outros: 0 };
  const base = startedAt.getHours() * 3600 + startedAt.getMinutes() * 60 + startedAt.getSeconds();
  let day = 0;
  let prev = base;
  for (const raw of transcript.split('\n')) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (sec < prev - 12 * 3600) day++;
    prev = sec;
    const startMs = (sec + day * 86_400 - base) * 1000;
    if (startMs < 0) continue; // fala de uma gravação anterior
    const who: Speaker = m[4] === 'Eu' ? 'Eu' : 'Outros';
    out[who] = Math.max(out[who], startMs + Math.max(2000, (m[5] ?? '').length * 65));
  }
  return out;
}

/**
 * "Recuperar reunião": o áudio órfão ganha forma final (m4a), o que ficou sem texto depois da última fala é transcrito
 * a partir do próprio áudio, a reunião sai de "interrompida" e as notas são geradas.
 */
export async function recoverMeeting(dir: string, deps: RecoverDeps): Promise<RecoverResult> {
  const meta = await readMeta(dir);
  const sessions = meetingSessions(meta);
  const last = sessions[sessions.length - 1]!;
  const startedAt = new Date(last.startedAt);
  const orphan = (await readdir(dir)).filter((n) => /^audio(-\d+)?\.wav$/.test(n)).sort().pop();

  let tailSegments = 0;
  if (orphan) {
    const wav = join(dir, orphan);
    const covered = transcribedUntil(await readMeetingText(dir, 'transcript'), startedAt);
    const { bytes } = await wavDataRange(wav);
    const totalMs = (bytes / 4 / 16000) * 1000;
    const from = Math.min(covered.Eu, covered.Outros);
    if (totalMs - from >= MIN_TAIL_MS) {
      const segments = await transcribeRange(wav, from, covered, deps, await deps.language(dir));
      const sink = new TranscriptSink({ path: join(dir, MEETING_FILES.transcript) });
      for (const segment of segments) await sink.append(formatSegmentLine(startedAt, segment));
      tailSegments = segments.length;
    }
  }
  const audio = await recoverOrphanAudio(dir, { keepAudio: deps.keepAudio(), ...(deps.encode ? { encode: deps.encode } : {}), ...(deps.concat ? { concat: deps.concat } : {}) });

  const durationMs = orphan ? audio.durationMs || (await wavDataRange(join(dir, orphan)).then((r) => (r.bytes / 4 / 16000) * 1000).catch(() => 0)) : 0;
  const endedAt = toLocalIso(new Date(startedAt.getTime() + durationMs));
  await updateMeta(dir, (m) => {
    const list = meetingSessions(m).map((s) => ({ ...s }));
    const lastSession = list[list.length - 1]!;
    if (!lastSession.endedAt) lastSession.endedAt = endedAt;
    return { ...m, state: 'done', endedAt: m.endedAt ?? endedAt, sessions: list };
  });
  const hasText = (await readMeetingText(dir, 'transcript')).includes('**[');
  let notes = false;
  if (hasText) {
    await deps.generateNotes(dir);
    notes = true;
  }
  if (orphan && !audio.recovered) await rm(join(dir, '.audio-recuperado.m4a'), { force: true }).catch(() => {});
  return { tailSegments, audioRecovered: audio.recovered, notes };
}

async function transcribeRange(wav: string, fromMs: number, covered: Record<Speaker, number>, deps: RecoverDeps, language: TranscriptionLanguage): Promise<Segment[]> {
  const pipeline = await deps.createPipeline(language);
  const segments: Segment[] = [];
  pipeline.on('segment', (s: Segment) => segments.push(s));
  try {
    await forEachStereoFrame(wav, fromMs, (timestampMs, mic, sys) => {
      if (timestampMs >= covered.Eu) pipeline.pushFrame({ source: 'mic', timestampMs, pcm: mic });
      if (timestampMs >= covered.Outros) pipeline.pushFrame({ source: 'sys', timestampMs, pcm: sys });
    });
    await pipeline.finish();
  } catch (err) {
    await pipeline.finish().catch(() => {});
    throw err;
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}
