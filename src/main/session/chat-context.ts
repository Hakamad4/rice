import type { TranscriptionLanguage } from '../../shared/types';
import { digestText, parseLines, readDigest } from './long-notes';

/** Acima disso a transcrição inteira não vai para o chat: entram as extrações por parte e os trechos mais relevantes. */
export const CHAT_DIRECT_MAX_CHARS = 60_000;
const WINDOW_LINES = 12;

const STOP = new Set(('para com uma que dos das nos nas por mais como mas foi sao tem ser ela ele isso esta este esse essa sobre entre ' +
  'qual quais quem quando onde falou disse fala foram fazer feito that this with from what when where who which have about were was the and for are').split(' '));

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Palavras da pergunta que valem como chave (4+ letras, sem as comuns), sem acento e minúsculas. */
export function keywordsOf(question: string): string[] {
  return [...new Set(fold(question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

/** Quantas chaves aparecem no texto; casa pelo prefixo de 5 letras para pegar plural e conjugações. */
function score(text: string, keys: readonly string[]): number {
  const words = new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  let n = 0;
  for (const k of keys) {
    const stem = k.slice(0, 5);
    if (words.has(k) || [...words].some((w) => w.startsWith(stem))) n++;
  }
  return n;
}

const LABELS = {
  pt: { digest: 'Resumo da reunião por partes (decisões, ações, tópicos e citações, com horário):', excerpts: 'Trechos da transcrição mais relacionados à pergunta:', gap: '[…]' },
  en: { digest: 'Meeting summary by part (decisions, actions, topics and quotes, with times):', excerpts: 'Transcript excerpts most related to the question:', gap: '[…]' },
};

/**
 * Transcrição que o chat deve enviar. Curta: ela mesma. Longa: as extrações guardadas (se as notas já foram
 * geradas) mais os trechos mais relevantes por palavra-chave, em ordem de horário, dentro de `limit` caracteres.
 */
export async function chatTranscript(dir: string, transcript: string, question: string, language: TranscriptionLanguage, limit = CHAT_DIRECT_MAX_CHARS): Promise<string> {
  if (transcript.length <= limit) return transcript;
  const labels = LABELS[language === 'en' ? 'en' : 'pt'];
  const digest = await readDigest(dir);
  const digestBudget = digest ? Math.floor(limit / 2) : 0;
  let digestPart = '';
  if (digest) {
    const full = digestText(digest);
    digestPart = full.length <= digestBudget ? full : full.slice(0, digestBudget);
  }
  const excerptBudget = limit - digestPart.length;
  const lines = parseLines(transcript).filter((l) => !l.raw.startsWith('# '));
  const windows: { at: number; text: string; score: number }[] = [];
  for (let i = 0; i < lines.length; i += WINDOW_LINES) {
    const text = lines.slice(i, i + WINDOW_LINES).map((l) => l.raw).join('\n\n');
    windows.push({ at: i, text, score: 0 });
  }
  const keys = keywordsOf(question);
  for (const w of windows) w.score = keys.length > 0 ? score(w.text, keys) : 0;
  const ranked = (keys.length > 0 && windows.some((w) => w.score > 0)
    ? windows.filter((w) => w.score > 0).sort((a, b) => b.score - a.score || a.at - b.at)
    : [...windows].reverse() // sem chave útil: o que foi dito por último
  );
  const chosen: typeof windows = [];
  let used = 0;
  for (const w of ranked) {
    if (used + w.text.length > excerptBudget) continue;
    chosen.push(w);
    used += w.text.length + 8;
  }
  chosen.sort((a, b) => a.at - b.at);
  const excerpts: string[] = [];
  chosen.forEach((w, i) => {
    if (i > 0 && w.at !== chosen[i - 1]!.at + WINDOW_LINES) excerpts.push(labels.gap);
    excerpts.push(w.text);
  });
  return [digestPart ? `${labels.digest}\n${digestPart}` : '', `${labels.excerpts}\n${excerpts.join('\n\n')}`].filter(Boolean).join('\n\n');
}
