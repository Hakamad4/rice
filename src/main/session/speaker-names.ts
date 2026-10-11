import type { AiRunner } from '../ai/types';
import { buildSpeakerNamesPrompt } from '../claude/prompts';
import { cleanSpeakerName, personIds } from '../../shared/speakers';
import type { TranscriptionLanguage } from '../../shared/types';

/**
 * A IA lê a transcrição e sugere nomes para "Pessoa N" só quando a conversa deixa claro ("Obrigado, Ana").
 * É SUGESTÃO: quem chama mostra ao usuário, nunca aplica sozinho. Devolve `{ "2": "Ana" }` só com pessoas que existem.
 */
export async function suggestSpeakerNames(
  runner: Pick<AiRunner, 'run'>,
  transcript: string,
  language: TranscriptionLanguage,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const ids = personIds(transcript);
  if (ids.length === 0) return {};
  const { system, prompt } = buildSpeakerNamesPrompt(transcript, ids, language);
  const gen = runner.run({ system, prompt, ...(signal ? { signal } : {}) });
  let step = await gen.next();
  while (!step.done) step = await gen.next();
  const json = /\{[\s\S]*\}/.exec(step.value)?.[0];
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      const name = cleanSpeakerName(value);
      if (ids.includes(Number(key)) && name) out[String(Number(key))] = name;
    }
  }
  return out;
}
