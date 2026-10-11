import { aiError } from './errors';
import { getJson, streamText, type FetchLike, type SseStep } from './http-stream';
import type { AiRunner } from './types';

export const CLAUDE_API_DEFAULT_MODEL = 'claude-sonnet-5-5';
const BASE = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';
const MAX_TOKENS = 8192;

export type ApiRunnerConfig = {
  getKey: () => Promise<string | null> | string | null;
  model?: string;
  fetch?: FetchLike;
};

const headers = (key: string) => ({ 'x-api-key': key, 'anthropic-version': VERSION });

/** Messages API com `stream: true`. Eventos: `content_block_delta` (texto), `message_stop`, `error`. */
export function claudeApiStep(event: { event: string; data: string }): SseStep {
  let data: { type?: string; delta?: { type?: string; text?: string }; error?: { type?: string; message?: string } };
  try {
    data = JSON.parse(event.data);
  } catch {
    return {};
  }
  if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') return { delta: data.delta.text };
  if (data.type === 'message_stop') return { done: true };
  if (data.type === 'error') {
    const t = data.error?.type ?? '';
    const kind = /authentication|permission/.test(t) ? 'auth' : /rate_limit|overloaded/.test(t) ? 'rate-limit' : 'other';
    return { error: aiError('claude-api', kind, data.error?.message) };
  }
  return {};
}

export function createClaudeApiRunner(config: ApiRunnerConfig): AiRunner {
  const fetchImpl = config.fetch ?? ((url, init) => fetch(url, init));
  return {
    async *run({ system, prompt, signal, images }) {
      const key = await config.getKey();
      if (!key) throw aiError('claude-api', 'auth');
      return yield* streamText(
        'claude-api',
        fetchImpl,
        {
          url: `${BASE}/messages`,
          headers: headers(key),
          body: {
            model: config.model || CLAUDE_API_DEFAULT_MODEL,
            max_tokens: MAX_TOKENS,
            stream: true,
            system,
            messages: [{ role: 'user', content: images?.length ? [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text: prompt }] : prompt }],
          },
        },
        key,
        claudeApiStep,
        { signal },
      );
    },
  };
}

export async function listClaudeModels(key: string, fetchImpl: FetchLike = (url, init) => fetch(url, init)): Promise<string[]> {
  const json = (await getJson('claude-api', fetchImpl, { url: `${BASE}/models?limit=100`, headers: headers(key) }, key)) as { data?: Array<{ id?: unknown }> };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
}

