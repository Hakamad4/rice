import { aiError } from './errors';
import { getJson, streamText, type SseStep } from './http-stream';
import type { ApiRunnerConfig } from './claude-api';
import type { FetchLike } from './http-stream';
import type { AiRunner } from './types';

export const OPENAI_DEFAULT_MODEL = 'gpt-5-mini';
const BASE = 'https://api.openai.com/v1';

const headers = (key: string) => ({ authorization: `Bearer ${key}` });

/** Responses API com streaming. Eventos: `response.output_text.delta`, `response.completed`, `response.failed`, `error`. */
export function openaiStep(event: { event: string; data: string }): SseStep {
  let data: { type?: string; delta?: string; annotation?: { type?: string; url?: unknown; title?: unknown }; message?: string; code?: string; response?: { error?: { message?: string; code?: string } } };
  try {
    data = JSON.parse(event.data);
  } catch {
    return {};
  }
  if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') return { delta: data.delta };
  if (data.type === 'response.output_text.annotation.added' && data.annotation?.type === 'url_citation' && typeof data.annotation.url === 'string') return { sources: [{ url: data.annotation.url, title: typeof data.annotation.title === 'string' ? data.annotation.title : '' }] };
  if (data.type === 'response.completed' || data.type === 'response.incomplete') return { done: true };
  if (data.type === 'response.failed' || data.type === 'error') {
    const message = data.type === 'error' ? data.message : data.response?.error?.message;
    const code = (data.type === 'error' ? data.code : data.response?.error?.code) ?? '';
    const kind = /invalid_api_key|authentication/.test(code) ? 'auth' : /rate_limit|insufficient_quota/.test(code) ? 'rate-limit' : 'other';
    return { error: aiError('openai-api', kind, message) };
  }
  return {};
}

export function createOpenAiApiRunner(config: ApiRunnerConfig): AiRunner {
  const fetchImpl = config.fetch ?? ((url, init) => fetch(url, init));
  return {
    async *run({ system, prompt, signal, images, tools }) {
      const key = await config.getKey();
      if (!key) throw aiError('openai-api', 'auth');
      return yield* streamText(
        'openai-api',
        fetchImpl,
        {
          url: `${BASE}/responses`,
          headers: headers(key),
          body: { model: config.model || OPENAI_DEFAULT_MODEL, instructions: system, input: images?.length ? [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.data}` }))] }] : prompt, stream: true, store: false, ...(tools?.web ? { tools: [{ type: 'web_search' }] } : {}) },
        },
        key,
        openaiStep,
        { signal, ...(tools?.web && tools.onSources ? { onSources: tools.onSources } : {}) },
      );
    },
  };
}

/** Só modelos de texto/chat conhecidos; a lista da OpenAI também traz embeddings, áudio, imagem… */
export async function listOpenAiModels(key: string, fetchImpl: FetchLike = (url, init) => fetch(url, init)): Promise<string[]> {
  const json = (await getJson('openai-api', fetchImpl, { url: `${BASE}/models`, headers: headers(key) }, key)) as { data?: Array<{ id?: unknown }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && /^(gpt-|o\d|chatgpt-)/.test(id) && !/(embedding|audio|realtime|image|tts|transcribe|moderation|search|codex)/.test(id))
    .sort();
}
