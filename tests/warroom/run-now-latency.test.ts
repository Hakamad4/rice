import { describe, expect, test } from 'vitest';
import { WarRoomEngine } from '../../src/main/warroom/engine';
import { defaultConfig, writeConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';

const speech = `**[00:00:00] Outros:** ${'precisamos decidir o preço do plano Pro. '.repeat(10)}`;

/** Marcos de um "Gerar agora" com fala parcial ainda em andamento: o botão tem de mudar já no clique, não depois de settle/leituras. */
async function measure() {
  const dir = await makeTmpDir();
  await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 5 } });
  const marks: Record<string, number> = {};
  let t0 = 0;
  const since = () => Date.now() - t0;
  let partialsLeft = 4; // ~1 s de fala parcial: o settle espera até ela fechar
  const engine = new WarRoomEngine({
    runner: () => ({
      async *run() {
        marks.runner ??= since();
        yield '';
        marks.firstChunk ??= since();
        return '[{"kind":"idea","text":"Testar o preço"}]';
      },
    }),
    transcript: async () => speech,
    partials: () => (partialsLeft-- > 0 ? ['…'] : []),
    language: async () => 'pt-BR',
    support: async () => ({ web: false, mcp: false, folder: false }),
    emit: () => {
      if (engine.state(dir).running) marks.running ??= since();
    },
  } as any);
  t0 = Date.now();
  await engine.tick(dir, { manual: true, track: 'ideas' });
  marks.done = since();
  return { marks, engine, dir };
}

describe('Gerar agora: latência até o botão mudar', () => {
  test('o estado "rodando" aparece no clique, antes do settle e das leituras', async () => {
    const { marks } = await measure();
    expect(marks.running).toBeLessThan(100);
  });
});

describe('Gerar agora: etapas e parada', () => {
  const base = async (over: Record<string, unknown> = {}) => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 5 } });
    const seen: string[] = [];
    let engine!: WarRoomEngine;
    engine = new WarRoomEngine({
      runner: () => ({
        async *run() {
          yield '';
          yield '[';
          return '[{"kind":"idea","text":"Testar o preço"}]';
        },
      }),
      transcript: async () => speech,
      language: async () => 'pt-BR',
      support: async () => ({ web: false, mcp: false, folder: false }),
      emit: () => {
        const s = engine.state(dir);
        const label = s.running ? s.phase : 'idle';
        if (seen[seen.length - 1] !== label) seen.push(label);
      },
      ...over,
    } as any);
    return { engine, dir, seen };
  };

  test('preparando → pensando → escrevendo → fim', async () => {
    const { engine, dir, seen } = await base();
    await engine.tick(dir, { manual: true, track: 'ideas' });
    expect(seen).toEqual(['preparing', 'thinking', 'writing', 'idle']);
  });

  test('"Parar" durante a preparação cancela sem erro e sem chamar a IA', async () => {
    let called = false;
    const { engine, dir } = await base({
      partials: () => ['…'],
      runner: () => ({ async *run() { called = true; return '[]'; } }),
    });
    const done = engine.tick(dir, { manual: true, track: 'ideas' });
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.state(dir).running).toBe(true);
    engine.abort(dir);
    expect(await done).toBe('skipped');
    expect(called).toBe(false);
    expect(engine.state(dir).running).toBe(false);
    expect(engine.state(dir).error).toBe('');
  });

  test('disparo automático sem fala nova não pisca "rodando"', async () => {
    const { engine, dir, seen } = await base({ transcript: async () => '' });
    await engine.tick(dir, { track: 'ideas' });
    expect(seen).not.toContain('preparing');
    expect(engine.state(dir).running).toBe(false);
  });
});

/** Espera por condição (não por tempo fixo): o ciclo só marca "rodando" depois de ler a config do disco, o que sob carga passa de 20 ms. */
async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condição não atingida');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('todas as trilhas: clique/ativação → "rodando"', () => {
  const cfgWar = { ...defaultConfig(), kind: 'warroom' as const, ideas: { on: true, intervalMin: 5 }, investigation: { intervalMin: 5, paused: false } };
  const make = async (partials: () => string[]) => {
    const dir = await makeTmpDir();
    await writeConfig(dir, cfgWar);
    const t0 = { v: 0 };
    const marks: Record<string, number> = {};
    let engine!: WarRoomEngine;
    engine = new WarRoomEngine({
      runner: () => ({ async *run() { yield ''; return '[{"kind":"idea","text":"x"}]'; } }),
      transcript: async () => speech,
      partials,
      language: async () => 'pt-BR',
      support: async () => ({ web: false, mcp: false, folder: false }),
      emit: () => {
        const s = engine.state(dir);
        if (s.running) marks[s.track] ??= Date.now() - t0.v;
      },
    } as any);
    return { engine, dir, marks, t0 };
  };

  test.each(['ideas', 'investigation'] as const)('"%s" manual com fala parcial: rodando em <100 ms', async (track) => {
    let left = 4;
    const { engine, dir, marks, t0 } = await make(() => (left-- > 0 ? ['…'] : []));
    t0.v = Date.now();
    await engine.tick(dir, { manual: true, track });
    expect(marks[track]).toBeLessThan(100);
  });

  test.each(['ideas', 'investigation'] as const)('"%s": clique duplo (segundo tick) devolve busy e não abre outro ciclo', async (track) => {
    const { engine, dir } = await make(() => ['…']);
    const first = engine.tick(dir, { manual: true, track });
    await until(() => engine.state(dir).track === track);
    expect(await engine.tick(dir, { manual: true, track })).toBe('busy');
    engine.abort(dir);
    await first;
  });

  test.each(['ideas', 'investigation'] as const)('"%s": Parar na preparação cancela sem erro', async (track) => {
    const { engine, dir } = await make(() => ['…']);
    const done = engine.tick(dir, { manual: true, track });
    await until(() => engine.state(dir).track === track);
    expect(engine.state(dir).phase).toBe('preparing');
    engine.abort(dir);
    expect(await done).toBe('skipped');
    const s = engine.state(dir);
    expect([s.running, s.track, s.error, s.investigation.error]).toEqual([false, '', '', '']);
  });

  test('ativar (start): o primeiro ciclo de cada trilha marca rodando sem demora', async () => {
    const { engine, dir, marks, t0 } = await make(() => []);
    t0.v = Date.now();
    await engine.start(dir);
    await new Promise((r) => setTimeout(r, 300));
    expect(marks.ideas).toBeLessThan(100);
    expect(marks.investigation).toBeLessThan(300);
    engine.stop(dir);
  });
});
