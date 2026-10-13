import { SHOT_ID_RE, shotId, type Shot } from '../../shared/screenshots';
import { listShots } from './store';

export type ShotNote = { id: string; clock: string; caption: string };

const clockOf = (shot: Shot): string => /T(\d{2}:\d{2}:\d{2})/.exec(shot.at)?.[1] ?? '';

/** Capturas com legenda (as sem legenda não dizem nada à IA), com o horário no mesmo relógio da transcrição. */
export async function shotsForNotes(meetingDir: string): Promise<ShotNote[]> {
  return (await listShots(meetingDir)).filter((s) => s.caption.trim()).map((s) => ({ id: shotId(s.file), clock: clockOf(s), caption: s.caption }));
}

/**
 * Deixa nas notas só citações válidas: id que existe, uma vez por captura, cada uma numa linha própria (logo depois da linha
 * em que a IA a escreveu). Qualquer outra coisa que pareça o marcador é removida; nada de HTML da IA chega ao renderer.
 */
export function sanitizeShotMarkers(notes: string, known: ReadonlySet<string>): string {
  const used = new Set<string>();
  const out: string[] = [];
  for (const line of notes.split('\n')) {
    const found: string[] = [];
    const rest = line.replace(/<!--\s*shot:([^>]*?)\s*-->/g, (_all, raw: string) => {
      const id = String(raw).trim();
      if (SHOT_ID_RE.test(id) && known.has(id) && !used.has(id) && !found.includes(id)) found.push(id);
      return '';
    });
    const had = line.includes('shot:') && /<!--\s*shot:/.test(line);
    if (rest.trim() || !had) out.push(had ? rest.trimEnd() : line);
    for (const id of found) {
      used.add(id);
      out.push(`<!--shot:${id}-->`);
    }
  }
  return out.join('\n');
}
