import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWarRoom } from '../../src/main/warroom/ipc';
import { defaultConfig, readConfig, readIdeas, writeConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';
import { quiesce, until } from '../helpers/until';

// o motor de cada teste para ao fim dele, mesmo que a asserção falhe (senão o ciclo pendente escreve numa pasta já apagada e derruba os testes seguintes)
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

const speech = (tag: string, n = 8) => `**[00:00:00] Outros:** ${`${tag} precisamos decidir o preço do plano. `.repeat(n)}\n`;
const IDEAS = '[{"kind":"idea","text":"ideia nova"}]';
const FACTS = '[{"text":"fato checado","source":{"type":"audio","ref":"Outros"}}]';

/** Sessão de mentira: a reunião grava, a transcrição cresce e o usuário mexe no painel pelos mesmos IPCs do app. */
async function rig(opts: { recording?: boolean; transcript?: string; hang?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const dir = await makeTmpDir();
  const handlers = new Map<string, (...a: any[]) => any>();
  const calls: any[] = [];
  const state = { recording: opts.recording ?? true, transcript: opts.transcript ?? '' };
  const runner = {
    async *run(o: any) {
      calls.push({ ...o, at: Date.now() });
      await new Promise<void>((resolve, reject) => {
        if (o.signal?.aborted) return reject(new Error('abort'));
        o.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
        if (!opts.hang) resolve(); // com `hang`, só termina por abort
      });
      yield '';
      return /investiga/i.test(o.system) ? FACTS : IDEAS;
    },
  };
  const wr = createWarRoom({
    handle: (c: string, f: any) => void handlers.set(c, f),
    send: () => {},
    checkedDir: async (d: unknown) => String(d),
    runner: runner as any,
    provider: async () => 'claude-sub',
    language: async () => 'pt-BR',
    transcript: async () => state.transcript,
    isRecording: () => state.recording,
    pickFolder: async () => null,
    saveAnnotations: async () => {},
    userData: dir,
    openPath: async () => '',
  } as any);
  const set = (patch: Record<string, unknown>) => handlers.get('warroom:set')!(null, dir, patch);
  const session = (s: string) => wr.onSessionState(s, dir);
  // o relógio é falso, o disco é de verdade: avança de 5 em 5 s e espera as leituras e escritas assentarem
  const minutes = async (n: number) => {
    for (let i = 0; i < Math.round((n * 60) / 5); i++) {
      await vi.advanceTimersByTimeAsync(5000);
      await quiesce(() => wr.engine.state(dir).running, () => calls.length);
    }
  };
  const investigations = () => calls.filter((c) => /investiga/i.test(c.system));
  const ideas = () => calls.filter((c) => !/investiga/i.test(c.system));
  // ciclo FECHADO: nada rodando e nada mudando (o runner já ter sido chamado não quer dizer que o ciclo terminou e agendou o próximo)
  stops.push(() => wr.engine.stop(dir));
  const idle = () => quiesce(() => wr.engine.state(dir).running, () => calls.length);
  return { dir, wr, calls, state, set, session, minutes, investigations, ideas, idle };
}

describe('Ideias e Investigação ativadas no MEIO da reunião', () => {
  test('(1) reunião normal gravando → "Ativar War room" no meio: a investigação roda logo e depois no intervalo', async () => {
    const r = await rig({ transcript: speech('antes') });
    await writeConfig(r.dir, { ...defaultConfig(), ideas: { on: false, intervalMin: 2 }, investigation: { intervalMin: 2, paused: false } }); // começou como reunião comum
    r.session('recording');
    await r.minutes(0.17);
    expect(r.calls).toHaveLength(0);
    await r.set({ kind: 'warroom' }); // 23:10: ativa no meio
    await until(() => expect(r.investigations()).toHaveLength(1)); // logo, sem esperar o intervalo
    await r.idle();
    expect((await readConfig(r.dir)).facts.map((f) => f.text)).toEqual(['fato checado']);
    r.state.transcript += speech('depois');
    await r.minutes(2.7);
    await until(() => expect(r.investigations()).toHaveLength(2)); // e de novo no intervalo
    await r.idle();
    r.wr.engine.stop(r.dir);
  });

  test('(2) ligar uma fonte no meio: o próximo ciclo já roda com ela (args do runner)', async () => {
    const r = await rig({ transcript: speech('a') });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', ideas: { on: false, intervalMin: 2 }, investigation: { intervalMin: 2, paused: false } });
    r.session('recording');
    await until(() => expect(r.investigations()).toHaveLength(1));
    await r.idle();
    expect(r.investigations()[0].tools).toBeUndefined(); // começou sem fontes
    await r.set({ web: true });
    await r.set({ mcp: true });
    r.state.transcript += speech('b');
    await r.minutes(2.7);
    await until(() => expect(r.investigations()).toHaveLength(2));
    await r.idle();
    expect(r.investigations()[1].tools).toMatchObject({ web: true, mcp: true });
    r.wr.engine.stop(r.dir);
  });

  test('(3) ligar Ideias no meio: o primeiro ciclo roda logo e o seguinte no intervalo', async () => {
    const r = await rig({ transcript: speech('a') });
    await writeConfig(r.dir, defaultConfig());
    r.session('recording');
    await r.set({ ideasOn: true });
    await r.set({ intervalMin: 2 });
    await until(async () => expect((await readIdeas(r.dir)).length).toBe(1));
    await until(() => expect(r.wr.engine.state(r.dir).running).toBe(false)); // ciclo 1 fechado e próximo agendado: conta 2 min a partir daqui
    r.state.transcript += speech('b');
    await r.minutes(2.7);
    await until(async () => expect((await readIdeas(r.dir)).length).toBe(2));
    r.wr.engine.stop(r.dir);
  });

  test('(4) ativar antes de gravar: começa quando a gravação começa', async () => {
    const r = await rig({ recording: false, transcript: '' });
    await r.set({ kind: 'warroom' }); // reunião parada: só guarda a configuração
    expect(r.calls).toHaveLength(0);
    expect(r.wr.engine.isScheduled(r.dir)).toBe(false);
    r.state.recording = true;
    r.session('recording');
    await r.minutes(0.1);
    r.state.transcript = speech('primeira fala');
    await r.minutes(2.7);
    await until(() => expect(r.investigations()).toHaveLength(1));
    await r.idle();
    r.wr.engine.stop(r.dir);
  });

  test('(5) "Continuar gravação" de uma reunião War room: os ciclos voltam', async () => {
    const r = await rig({ transcript: speech('parte 1') });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', ideas: { on: true, intervalMin: 2 } });
    r.session('recording');
    await until(() => expect(r.investigations()).toHaveLength(1));
    await r.idle();
    r.session('finishing');
    r.session('idle');
    r.state.recording = false;
    expect(r.wr.engine.isScheduled(r.dir)).toBe(false);
    r.state.recording = true; // retomou
    r.state.transcript += speech('parte 2');
    r.session('recording');
    await until(() => expect(r.investigations()).toHaveLength(2));
    await r.idle();
    expect(r.wr.engine.isScheduled(r.dir)).toBe(true);
    r.wr.engine.stop(r.dir);
  });

  test('(6) o primeiro ciclo após ativar considera a conversa ANTERIOR à ativação (recorte recente do todo)', async () => {
    const r = await rig({ transcript: speech('ASSUNTO-ANTIGO', 30) });
    r.session('recording');
    await r.set({ kind: 'warroom' });
    await until(() => expect(r.investigations()).toHaveLength(1));
    await r.idle();
    expect(r.investigations()[0].prompt).toContain('ASSUNTO-ANTIGO');
    r.wr.engine.stop(r.dir);
  });

  test('(7) desativar no meio para os ciclos e aborta o que estiver rodando', async () => {
    const r = await rig({ transcript: speech('a'), hang: true });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', ideas: { on: true, intervalMin: 2 } });
    r.session('recording');
    await until(() => expect(r.wr.engine.state(r.dir).running).toBe(true));
    await r.set({ kind: 'meeting', ideasOn: false });
    await until(() => expect(r.wr.engine.state(r.dir).running).toBe(false));
    expect(r.wr.engine.isScheduled(r.dir)).toBe(false);
    expect(r.wr.engine.state(r.dir).error).toBe(''); // cancelado por escolha: sem erro
    const before = r.calls.length;
    r.state.transcript += speech('b');
    await r.minutes(5);
    expect(r.calls.length).toBe(before); // nenhum ciclo novo
    expect((await readConfig(r.dir)).facts).toEqual([]); // e nada do ciclo abortado foi gravado
  });
});
