import type { AiRunner } from '../../src/main/ai/types';

export type FakeCall = { system: string; prompt: string };

/** AiRunner de teste: `reply` decide a resposta de cada chamada; `calls` guarda o que o app mandou, na ordem. */
export function fakeRunner(reply: (call: FakeCall, index: number) => string | Promise<string>): AiRunner & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    calls,
    async *run({ system, prompt }) {
      const call = { system, prompt };
      calls.push(call);
      const text = await reply(call, calls.length - 1);
      yield text;
      return text;
    },
  };
}
