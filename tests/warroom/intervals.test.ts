import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWarRoom } from '../../src/main/warroom/ipc';
import { defaultConfig, normalizeConfig, readConfig, writeConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';

const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));
afterEach(() => vi.useRealTimers());

const speech = (tag: string) => `**[00:00:00] Outros:** ${`${tag} precisamos decidir o preço do plano. `.repeat(8)}\n`;
const IDEAS = '[{"kind":"idea","text":"ideia nova"}]';
const FACTS = '[{"text":"fato checado","source":{"type":"audio","ref":"Outros"}}]';

async function rig() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const dir = await makeTmpDir();
  const handlers = new Map<string, (...a: any[]) => any>();
  const calls: { kind: 'ideas' | 'investigation'; at: number }[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const state = { transcript: speech('a') };
  const runner = {
    async *run(o: any) {
      const kind = /investiga/i.test(o.system) ? 'investigation' : 'ideas';
      calls.push({ kind, at: Date.now() });
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((r) => realSetTimeout(r, 20)); // um ciclo leva um tempinho: dois ao mesmo tempo seriam vistos
      concurrent--;
      yield '';
      return kind === 'investigation' ? FACTS : IDEAS;
    },
  };
  const wr = createWarRoom({
    handle: (c: string, f: any) => void handlers.set(c, f), send: () => {}, checkedDir: async (d: unknown) => String(d), runner: runner as any, lightRunner: () => runner as any,
    provider: async () => 'claude-sub', language: async () => 'pt-BR', transcript: async () => state.transcript, isRecording: () => true, pickFolder: async () => null, saveAnnotations: async () => {}, userData: dir, openPath: async () => '',
  } as any);
  const minutes = async (n: number) => {
    for (let i = 0; i < Math.round((n * 60) / 5); i++) {
      await vi.advanceTimersByTimeAsync(5000);
      await realSleep(25);
    }
  };
  const count = (kind: string) => calls.filter((c) => c.kind === kind).length;
  return { dir, wr, handlers, state, minutes, count, maxConcurrent: () => maxConcurrent };
}

describe('ideias e investigação com intervalos independentes', () => {
  test('cada trilha roda no seu intervalo (ideias a cada 2 min, investigação a cada 10)', async () => {
    const r = await rig();
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', ideas: { on: true, intervalMin: 2 }, investigation: { intervalMin: 10, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await vi.waitFor(() => expect([r.count('ideas'), r.count('investigation')]).toEqual([1, 1])); // primeiro ciclo de cada uma, logo
    r.state.transcript += speech('b');
    await r.minutes(2.5);
    expect([r.count('ideas'), r.count('investigation')]).toEqual([2, 1]); // só as ideias venceram
    r.state.transcript += speech('c');
    await r.minutes(8);
    expect(r.count('investigation')).toBe(2); // aos 10 min a investigação lê o que acumulou
    expect(r.count('ideas')).toBeGreaterThanOrEqual(3);
    r.wr.engine.stop(r.dir);
  });

  test('vencendo juntas, uma roda e a outra logo depois (nunca duas ao mesmo tempo)', async () => {
    const r = await rig();
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', ideas: { on: true, intervalMin: 2 }, investigation: { intervalMin: 2, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await vi.waitFor(() => expect([r.count('ideas'), r.count('investigation')]).toEqual([1, 1]));
    r.state.transcript += speech('b');
    await r.minutes(2.6);
    expect([r.count('ideas'), r.count('investigation')]).toEqual([2, 2]);
    expect(r.maxConcurrent()).toBe(1);
    r.wr.engine.stop(r.dir);
  });

  test('o IPC muda um intervalo sem tocar no outro (e o estado traz o próximo ciclo de cada trilha)', async () => {
    const r = await rig();
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom' });
    await r.handlers.get('warroom:set')!(null, r.dir, { investigationMin: 15 });
    let cfg = await readConfig(r.dir);
    expect([cfg.ideas.intervalMin, cfg.investigation.intervalMin]).toEqual([5, 15]);
    await r.handlers.get('warroom:set')!(null, r.dir, { intervalMin: 2 });
    cfg = await readConfig(r.dir);
    expect([cfg.ideas.intervalMin, cfg.investigation.intervalMin]).toEqual([2, 15]);
    await r.handlers.get('warroom:set')!(null, r.dir, { investigationMin: 7 }); // inválido: ignora
    expect((await readConfig(r.dir)).investigation.intervalMin).toBe(15);
    const view = await r.handlers.get('warroom:get')!(null, r.dir);
    expect(view.state.investigation).toMatchObject({ error: '', note: '' });
    expect(typeof view.state.investigation.nextAt).toBe('number'); // gravando: já agendada, no intervalo dela
  });
});

describe('migração do warroom.json', () => {
  test('sem investigation: herda o intervalo das ideias; com valor válido, mantém; inválido, cai no das ideias', () => {
    expect(normalizeConfig({ ideas: { on: true, intervalMin: 10 } }).investigation.intervalMin).toBe(10);
    expect(normalizeConfig({ ideas: { intervalMin: 10 }, investigation: { intervalMin: 15, paused: false } }).investigation.intervalMin).toBe(15);
    expect(normalizeConfig({ ideas: { intervalMin: 2 }, investigation: { intervalMin: 99, paused: false } }).investigation.intervalMin).toBe(2);
    expect(normalizeConfig({}).investigation.intervalMin).toBe(5);
    expect(defaultConfig().investigation.intervalMin).toBe(5);
  });
});
