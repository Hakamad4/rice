import { afterEach, describe, expect, test, vi } from 'vitest';
import { WarRoomEngine } from '../../src/main/warroom/engine';
import { createWarRoom } from '../../src/main/warroom/ipc';
import { defaultConfig, readConfig, readIdeas, writeConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';
import { until } from '../helpers/until';

afterEach(() => vi.useRealTimers());

const speech = (n: number) => `**[00:00:00] Outros:** ${'precisamos decidir o preço do plano Pro. '.repeat(n)}`;

function setup(runner: (call: number) => Promise<string>, over: Record<string, unknown> = {}) {
  let transcript = speech(10);
  let now = 1_000_000;
  let calls = 0;
  const engine = new WarRoomEngine({
    runner: () => ({
      async *run() {
        yield '';
        return runner(++calls);
      },
    }),
    transcript: async () => transcript,
    language: async () => 'pt-BR',
    support: async () => ({ web: false, mcp: false, folder: false }),
    emit: () => {},
    clock: () => now,
    heartbeatMs: 1000,
    ...over,
  } as any);
  return { engine, calls: () => calls, say: (more: number) => (transcript += speech(more)), advance: (ms: number) => (now += ms) };
}

describe('ideias ligadas no MEIO da gravação (regressão)', () => {
  test('ao ligar, o primeiro ciclo roda logo (sem esperar o intervalo) e agenda o próximo', async () => {
    vi.useFakeTimers();
    const dir = await makeTmpDir();
    const f = setup(async () => '[{"kind":"idea","text":"Testar o preço com 5 clientes"}]');
    await writeConfig(dir, defaultConfig()); // a gravação começou com tudo desligado
    await f.engine.start(dir); // 'recording' → nada a agendar
    expect(f.engine.isScheduled(dir)).toBe(false);
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom', ideas: { on: true, intervalMin: 2 }, investigation: { intervalMin: 2, paused: false } }); // 23:10: usuário liga no meio
    await f.engine.start(dir);
    await until(async () => expect((await readIdeas(dir)).length).toBe(1));
    await until(async () => { const c = await readConfig(dir); expect([c.ideasCycles, c.investigationCycles]).toEqual([1, 1]); }); // uma trilha de ideias e uma de investigação, cada uma com o seu ciclo e contagem própria
    expect(f.engine.isScheduled(dir)).toBe(true);
    expect(f.engine.state(dir).nextAt).toBe(1_000_000 + 2 * 60_000);
    expect(f.engine.state(dir).investigation.nextAt).toBe(1_000_000 + 2 * 60_000);
    f.engine.stop(dir);
  });

  test('o relógio de parede dispara o ciclo seguinte quando passa o intervalo e há fala nova', async () => {
    vi.useFakeTimers();
    const dir = await makeTmpDir();
    const f = setup(async (n) => `[{"text":"ideia ${n}"}]`);
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 } });
    await f.engine.start(dir);
    await until(() => expect(f.calls()).toBe(1));
    await until(() => expect(f.engine.state(dir).running).toBe(false)); // ciclo 1 fechado (o runner ter sido chamado não basta), antes de o relógio andar
    f.say(10);
    f.advance(2 * 60_000 + 1);
    await vi.advanceTimersByTimeAsync(1500);
    await until(async () => expect((await readIdeas(dir)).map((i) => i.text)).toEqual(['ideia 1', 'ideia 2'])); // o runner ser chamado não é o ciclo gravado
    await until(() => expect(f.engine.state(dir).running).toBe(false));
    f.engine.stop(dir);
  });

  test('erro do ciclo fica no estado (visível), não repete sozinho antes do intervalo e some no sucesso', async () => {
    vi.useFakeTimers();
    const dir = await makeTmpDir();
    let fail = true;
    const f = setup(async () => {
      if (fail) throw new Error('OpenCode: limite do modelo gratuito');
      return '[{"text":"ok"}]';
    });
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 } });
    await f.engine.start(dir);
    await until(() => expect(f.engine.state(dir).error).toContain('limite do modelo'));
    expect(f.engine.state(dir).running).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls()).toBe(1); // sem martelar o provedor
    fail = false;
    expect(await f.engine.tick(dir, { manual: true })).toBe('ran'); // "Tentar agora"
    expect(f.engine.state(dir).error).toBe('');
    expect((await readIdeas(dir)).length).toBe(1);
    f.engine.stop(dir);
  });

  test('resposta em prosa (modelo que não segue o formato) vira erro visível, não ciclo vazio calado', async () => {
    const dir = await makeTmpDir();
    const f = setup(async () => 'Claro! Aqui vão algumas ideias para a reunião sobre preço...');
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 } });
    expect(await f.engine.tick(dir)).toBe('failed');
    expect(f.engine.state(dir).error).toContain('formato');
    expect((await readConfig(dir)).ideasCycles).toBe(0);
  });

  test('"Gerar agora" sem fala nova suficiente avisa em vez de falhar calado', async () => {
    const dir = await makeTmpDir();
    const f = setup(async () => '[]', { transcript: async () => 'curto' });
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 } });
    expect(await f.engine.tick(dir, { manual: true })).toBe('skipped');
    expect(f.engine.state(dir).note).toBe('little-speech');
  });

  test('rede de segurança: ensure() agenda a reunião que está gravando mesmo sem passar pelo caminho normal', async () => {
    vi.useFakeTimers();
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 5 } });
    const wr = createWarRoom({
      handle: () => {},
      send: () => {},
      checkedDir: async (d: unknown) => String(d),
      runner: { async *run() { return '[]'; } } as any,
      lightRunner: () => ({ async *run() { return '[]'; } }) as any,
      provider: async () => 'claude-sub',
      language: async () => 'pt-BR',
      transcript: async () => '',
      isRecording: () => true,
      pickFolder: async () => null,
      saveAnnotations: async () => {},
    } as any);
    expect(wr.engine.isScheduled(dir)).toBe(false);
    wr.ensure(dir);
    await until(() => expect(wr.engine.isScheduled(dir)).toBe(true));
    wr.engine.stop(dir);
  });
});
