import { t } from '../i18n';
import { aiError } from './errors';
import { getJson, streamText, type FetchLike, type SseStep } from './http-stream';
import type { ApiRunnerConfig } from './claude-api';
import type { AiRunner } from './types';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** A chave vai SÓ no cabeçalho `x-goog-api-key`, nunca na URL. */
const headers = (key: string) => ({ 'x-goog-api-key': key });

/** `streamGenerateContent?alt=sse`: cada evento é um JSON com `candidates[0].content.parts[].text` (ou `error`). */
export function geminiStep(event: { event: string; data: string }): SseStep {
  let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>; error?: { code?: number; message?: string; status?: string } };
  try {
    data = JSON.parse(event.data);
  } catch {
    return {};
  }
  if (data.error) {
    const code = data.error.code ?? 0;
    const status = data.error.status ?? '';
    const kind = code === 401 || code === 403 || /UNAUTHENTICATED|PERMISSION_DENIED/.test(status) || /api key/i.test(data.error.message ?? '') ? 'auth' : code === 429 || status === 'RESOURCE_EXHAUSTED' ? 'rate-limit' : 'other';
    return { error: aiError('gemini-api', kind, data.error.message) };
  }
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => p.thought !== true && typeof p.text === 'string').map((p) => p.text as string).join('');
  return text ? { delta: text } : {};
}

export function createGeminiApiRunner(config: ApiRunnerConfig): AiRunner {
  const fetchImpl = config.fetch ?? ((url, init) => fetch(url, init));
  return {
    async *run({ system, prompt, signal, images }) {
      const key = await config.getKey();
      if (!key) throw aiError('gemini-api', 'auth');
      const model = config.model || GEMINI_DEFAULT_MODEL;
      if (!MODEL_RE.test(model)) throw aiError('gemini-api', 'other', t('ai.err.model-name'));
      return yield* streamText(
        'gemini-api',
        fetchImpl,
        {
          url: `${BASE}/models/${model}:streamGenerateContent?alt=sse`,
          headers: headers(key),
          body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }, ...(images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))] }] },
        },
        key,
        geminiStep,
        { signal },
      );
    },
  };
}

export async function listGeminiModels(key: string, fetchImpl: FetchLike = (url, init) => fetch(url, init)): Promise<string[]> {
  const json = (await getJson('gemini-api', fetchImpl, { url: `${BASE}/models?pageSize=100`, headers: headers(key) }, key)) as {
    models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
  };
  return (json.models ?? [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent') && typeof m.name === 'string')
    .map((m) => (m.name as string).replace(/^models\//, ''))
    .filter((id) => MODEL_RE.test(id) && id.startsWith('gemini'))
    .sort();
}
