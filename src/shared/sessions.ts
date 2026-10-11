import type { MeetingMeta, RecordingSession } from './types';

/** Gravações da reunião; metas antigas (sem `sessions`) viram uma sessão a partir de `startedAt`/`endedAt`. */
export function meetingSessions(meta: Pick<MeetingMeta, 'startedAt' | 'endedAt' | 'sessions'>): RecordingSession[] {
  if (Array.isArray(meta.sessions) && meta.sessions.length > 0) return meta.sessions;
  return [{ startedAt: meta.startedAt, ...(meta.endedAt ? { endedAt: meta.endedAt } : {}) }];
}

/** Soma das gravações já encerradas, em ms. */
export function totalRecordedMs(meta: Pick<MeetingMeta, 'startedAt' | 'endedAt' | 'sessions'>): number {
  let total = 0;
  for (const s of meetingSessions(meta)) {
    if (!s.endedAt) continue;
    const ms = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
    if (ms > 0) total += ms;
  }
  return total;
}
