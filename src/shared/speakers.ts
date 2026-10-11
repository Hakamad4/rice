import type { MeetingMeta } from './types';

/** No arquivo a pessoa é sempre `Pessoa N`; os nomes dados pelo usuário ficam em `meta.speakers` e entram só na hora de usar o texto. */
const PERSON_LINE = /^(\*\*\[\d{2}:\d{2}:\d{2}\]\s+)Pessoa (\d+)(:\*\*)/gm;

/** Troca `Pessoa N` pelo nome dado a ela (notas, chat e sugestões usam os nomes); sem nome, fica "Pessoa N". */
export function applySpeakerNames(transcript: string, speakers: MeetingMeta['speakers']): string {
  if (!speakers || Object.keys(speakers).length === 0) return transcript;
  return transcript.replace(PERSON_LINE, (whole, head: string, id: string, tail: string) => {
    const name = speakers[id]?.trim();
    return name ? `${head}${name}${tail}` : whole;
  });
}

/** Números das pessoas que aparecem na transcrição. */
export function personIds(transcript: string): number[] {
  const ids = new Set<number>();
  for (const m of transcript.matchAll(PERSON_LINE)) ids.add(Number(m[2]));
  return [...ids].sort((a, b) => a - b);
}

/** Nome válido para uma pessoa: texto curto de uma linha, sem marcação que possa quebrar o Markdown da transcrição. */
export function cleanSpeakerName(raw: unknown): string {
  return String(raw ?? '').replace(/[\r\n*_`<>[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
