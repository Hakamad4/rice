import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTranslateLang, type TranslateLang } from './offline';

/** Traduções da reunião, no arquivo próprio da pasta da sessão (uma linha JSON por trecho). Nunca mexe na transcrição. */
export const TRANSLATION_FILE = 'traducao.jsonl';

export type TranslateVia = 'ai' | 'offline';
/** `key` = a linha da transcrição (`**[hh:mm:ss] Quem:** texto`, sem espaços nas pontas): é por ela que a tela casa a tradução com a fala. */
export type TranslationRecord = { key: string; lang: TranslateLang; text: string; via: TranslateVia };

export async function appendTranslation(dir: string, record: TranslationRecord): Promise<void> {
  await appendFile(join(dir, TRANSLATION_FILE), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/** Lê com tolerância (linha ruim é ignorada); a última tradução de cada (trecho, idioma) vence. */
export async function readTranslations(dir: string, lang?: TranslateLang): Promise<TranslationRecord[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, TRANSLATION_FILE), 'utf8');
  } catch {
    return [];
  }
  const byKey = new Map<string, TranslationRecord>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Partial<TranslationRecord>;
      if (typeof o.key !== 'string' || typeof o.text !== 'string' || !isTranslateLang(o.lang)) continue;
      if (lang && o.lang !== lang) continue;
      byKey.set(`${o.lang}\n${o.key}`, { key: o.key, lang: o.lang, text: o.text, via: o.via === 'offline' ? 'offline' : 'ai' });
    } catch {
      // linha malformada
    }
  }
  return [...byKey.values()];
}
