import type { Folder, FolderRetention, MeetingState } from '../../shared/types';
import { effectiveRetention, retentionSource } from './folder-rules';

/**
 * Retenção por pasta: o que venceu vai para a Lixeira do sistema (nunca é apagado em definitivo) e o Rice avisa uma vez.
 * Aqui só o PLANO (puro e testável); quem move para a Lixeira é o main (`shell.trashItem`).
 */
export type SweepMeeting = {
  dir: string;
  state: MeetingState;
  startedAt: string;
  endedAt?: string;
  folderId?: string;
  /** Nomes dos arquivos de áudio que existem na pasta (`audio.m4a`, `audio.wav`). */
  audio: readonly string[];
};

export type SweepAction = { kind: 'audio' | 'meeting'; dir: string; /** arquivos de áudio a mover (kind audio) */ files: readonly string[]; /** pasta que define a regra; null = o padrão das configurações */ source: string | null };

/** Estados em que a reunião NUNCA é tocada: gravando, finalizando as notas, interrompida (recuperável) ou danificada. */
const UNTOUCHABLE: readonly MeetingState[] = ['recording', 'finishing', 'interrupted', 'damaged'];
const DAY = 86_400_000;

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function planSweep(input: { meetings: readonly SweepMeeting[]; folders: readonly Folder[]; fallback: FolderRetention | undefined; now: Date; /** pastas de reuniões em uso agora (a gravação nunca é afetada) */ busy: ReadonlySet<string> }): SweepAction[] {
  const out: SweepAction[] = [];
  const nameOf = (folderId: string | undefined, key: keyof FolderRetention): string | null => {
    const src = retentionSource(input.folders, folderId, key);
    return src ? src.name : null;
  };
  for (const m of input.meetings) {
    if (UNTOUCHABLE.includes(m.state) || input.busy.has(m.dir)) continue;
    const rule = effectiveRetention(input.folders, m.folderId, input.fallback);
    const started = new Date(m.startedAt);
    const ended = new Date(m.endedAt ?? m.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    // reunião inteira vencida: vai tudo (o áudio vai junto, sem outra ação)
    if (rule.meetingMonths > 0 && addMonths(started, rule.meetingMonths).getTime() <= input.now.getTime()) {
      out.push({ kind: 'meeting', dir: m.dir, files: [], source: nameOf(m.folderId, 'meetingMonths') });
      continue;
    }
    if (m.state === 'done' && rule.audioDays > 0 && m.audio.length > 0 && input.now.getTime() - (Number.isNaN(ended.getTime()) ? started : ended).getTime() >= rule.audioDays * DAY) {
      out.push({ kind: 'audio', dir: m.dir, files: m.audio, source: nameOf(m.folderId, 'audioDays') });
    }
  }
  return out;
}

type Tn = (key: string, n: number, vars?: Record<string, string | number>) => string;

/** Uma linha por (tipo, pasta): "3 áudios antigos foram para a Lixeira pela regra da pasta Jurídico". */
export function sweepNotice(done: readonly SweepAction[], tn: Tn): string[] {
  const groups = new Map<string, { kind: SweepAction['kind']; source: string | null; n: number }>();
  for (const a of done) {
    const key = `${a.kind}|${a.source ?? ''}`;
    const g = groups.get(key) ?? { kind: a.kind, source: a.source, n: 0 };
    g.n++;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => tn(`retention.notice.${g.kind}${g.source ? '' : '.default'}`, g.n, { folder: g.source ?? '' }));
}
