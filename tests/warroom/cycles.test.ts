import { afterEach, describe, expect, test, vi } from 'vitest';
import { overlapStart } from '../../src/main/warroom/engine';
import { createWarRoom } from '../../src/main/warroom/ipc';
import { defaultConfig, readConfig, writeConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';
import { quiesce, until } from '../helpers/until';

// o motor de cada teste para ao fim dele, mesmo que a asserção falhe (senão o ciclo pendente escreve numa pasta já apagada e derruba os testes seguintes)
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
/** Uma fala longa o bastante (≥200 caracteres) no segundo `s` da reunião. */
const line = (s: number, tag: string) => `**[${clock(s)}] Outros:** ${`${tag} falamos do preço do plano Pro e do concorrente. `.repeat(5)}\n`;

async function rig(opts: { transcript?: string } = {}) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const dir = await makeTmpDir();
  const handlers = new Map<string, (...a: any[]) => any>();
  const calls: any[] = [];
  const state = { transcript: opts.transcript ?? '', partials: [] as string[], partialReads: 0, reply: '[{"text":"fato novo","source":{"type":"audio","ref":"Outros"}}]' };
  const runner = {
    async *run(o: any) {
      calls.push({ ...o, at: Date.now() });
      yield '';
      return /investiga/i.test(o.system) ? state.reply : '[{"kind":"idea","text":"ideia"}]';
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
    partials: () => (state.partialReads++, state.partials),
    isRecording: () => true,
    pickFolder: async () => null,
    saveAnnotations: async () => {},
    userData: dir,
    openPath: async () => '',
  } as any);
  const call = (channel: string, ...args: any[]) => handlers.get(channel)!(null, dir, ...args);
  const minutes = async (n: number) => {
    for (let i = 0; i < Math.round((n * 60) / 5); i++) {
      await vi.advanceTimersByTimeAsync(5000);
      await quiesce(() => wr.engine.state(dir).running, () => calls.length);
    }
  };
  const inv = () => calls.filter((c) => /investiga/i.test(c.system));
  stops.push(() => wr.engine.stop(dir));
  const idle = () => quiesce(() => wr.engine.state(dir).running, () => calls.length);
  return { dir, wr, calls, state, call, minutes, inv, idle };
}

describe('sem rajadas: o intervalo é respeitado', () => {
  test('mexer no painel (confirmar/descartar, fontes, tipo) a cada 30 s com a conversa crescendo NÃO dispara ciclos extras', async () => {
    const r = await rig({ transcript: line(10, 'a') });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 5, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await until(() => expect(r.inv()).toHaveLength(1)); // o primeiro ciclo imediato
    await r.idle();
    let t = 20;
    for (let i = 0; i < 9; i++) {
      // a cada 30 s: fala nova + um clique no painel (cada um passa por warroom:set / warroom:fact → engine.start)
      r.state.transcript += line((t += 30), `fala${i}`);
      const cfg = await readConfig(r.dir);
      const fact = cfg.facts[0];
      if (i % 3 === 0 && fact) await r.call('warroom:fact', fact.id, i % 2 ? 'dismiss' : 'confirm');
      if (i % 3 === 1) await r.call('warroom:set', { web: i % 2 === 0 });
      if (i % 3 === 2) await r.call('warroom:set', { kind: 'warroom' });
      await r.minutes(0.5);
    }
    // ~4,5 min depois: continua 1 (o próximo só vence aos 5 min)
    expect(r.inv()).toHaveLength(1);
    await r.minutes(1);
    await until(() => expect(r.inv()).toHaveLength(2));
    await r.idle();
    r.wr.engine.stop(r.dir);
  });

  test('o primeiro ciclo imediato acontece UMA vez por ativação (desligar e ligar de novo conta como outra ativação)', async () => {
    const r = await rig({ transcript: line(10, 'a') });
    await writeConfig(r.dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 5 } });
    await r.wr.engine.start(r.dir);
    await r.wr.engine.start(r.dir);
    await r.wr.engine.start(r.dir);
    await until(() => expect(r.calls).toHaveLength(1));
    await r.idle();
    await r.minutes(0.3);
    await r.wr.engine.start(r.dir);
    expect(r.calls).toHaveLength(1);
    await r.call('warroom:set', { ideasOn: false });
    await r.call('warroom:set', { ideasOn: true });
    r.state.transcript += line(100, 'b');
    await until(() => expect(r.calls).toHaveLength(2));
    await r.idle();
    r.wr.engine.stop(r.dir);
  });

  test('"Investigar agora" não encurta nem multiplica o automático: o próximo conta de novo a partir dele', async () => {
    const r = await rig({ transcript: line(10, 'a') });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 5, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await until(() => expect(r.inv()).toHaveLength(1));
    await r.idle();
    await r.minutes(3);
    r.state.transcript += line(200, 'b');
    await r.call('warroom:run-now', 'investigation'); // manual aos ~3 min
    await until(() => expect(r.inv()).toHaveLength(2));
    await r.idle();
    r.state.transcript += line(260, 'c');
    await r.minutes(4); // 4 min depois do manual: ainda NÃO venceu (o relógio recomeçou nele)
    expect(r.inv()).toHaveLength(2);
    await r.minutes(1.3);
    await until(() => expect(r.inv()).toHaveLength(3));
    await r.idle();
    r.wr.engine.stop(r.dir);
  });
});

describe('o que acabou de ser dito não se perde', () => {
  test('o recorte volta 60 s antes do ponto já lido e o prompt traz os achados existentes (para não repetir)', async () => {
    const t0 = line(10, 'ANTIGA') + line(100, 'DENTRO-DA-JANELA') + line(150, 'FIM-DO-CICLO-1');
    const r = await rig({ transcript: t0 });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 2, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await until(() => expect(r.inv()).toHaveLength(1));
    await r.idle();
    r.state.transcript += line(200, 'NOVA');
    await r.minutes(2.3);
    await until(() => expect(r.inv()).toHaveLength(2));
    await r.idle();
    const prompt: string = r.inv()[1].prompt;
    expect(prompt).toContain('FIM-DO-CICLO-1'); // sobreposição
    expect(prompt).toContain('DENTRO-DA-JANELA'); // até 60 s antes da última linha lida (150 s → corte em 90 s)
    expect(prompt).toContain('NOVA');
    expect(prompt).not.toContain('ANTIGA'); // fora da janela
    expect(prompt).toContain('fato novo'); // achado do ciclo 1, listado como já existente
    r.wr.engine.stop(r.dir);
  });

  test('overlapStart: corte por relógio da transcrição; sem relógio, volta um trecho fixo', () => {
    const full = line(0, 'a') + line(70, 'b') + line(130, 'c');
    const consumed = full.length;
    const at = overlapStart(full, consumed);
    expect(full.slice(at)).toContain('c falamos');
    expect(full.slice(at)).toContain('b falamos'); // 130−60 = 70
    expect(full.slice(at)).not.toContain('a falamos');
    expect(overlapStart('texto sem relógio '.repeat(300), 5000)).toBe(3500);
    expect(overlapStart(full, 0)).toBe(0);
  });

  test('a fala AINDA não finalizada entra no ciclo como provisória e conta como fala nova', async () => {
    const r = await rig({ transcript: '**[00:00:10] Outros:** curto\n' });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 2, paused: false } });
    r.state.partials = ['Outros: ' + 'TEXTO-PARCIAL sobre o orçamento que ainda estou terminando de dizer, '.repeat(4)];
    r.wr.onSessionState('recording', r.dir);
    await until(() => expect(r.inv()).toHaveLength(1)); // só com o parcial já passa do mínimo
    await r.idle();
    expect(r.inv()[0].prompt).toContain('[Provisório');
    expect(r.inv()[0].prompt).toContain('TEXTO-PARCIAL');
    r.wr.engine.stop(r.dir);
  });

  test('fala no fim do intervalo com a transcrição atrasada: entra no ciclo certo (provisória) e no seguinte (final, pela sobreposição)', async () => {
    const r = await rig({ transcript: line(10, 'base') });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 2, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await until(() => expect(r.inv()).toHaveLength(1));
    await r.idle();
    // 1:58 → alguém fala; o segmento só chega ao arquivo depois do ciclo
    await r.minutes(1.9);
    r.state.partials = ['Outros: ' + 'CITADO-NO-FIM do intervalo, ainda sendo transcrito. '.repeat(6)];
    await r.minutes(0.3);
    await until(() => expect(r.inv()).toHaveLength(2));
    await r.idle();
    expect(r.inv()[1].prompt).toContain('CITADO-NO-FIM'); // não esperou o outro ciclo
    // depois o segmento fecha e vai para a transcrição
    r.state.partials = [];
    r.state.transcript += line(125, 'CITADO-NO-FIM final');
    await r.minutes(2.3);
    await until(() => expect(r.inv()).toHaveLength(3));
    await r.idle();
    expect(r.inv()[2].prompt).toContain('CITADO-NO-FIM final');
    r.wr.engine.stop(r.dir);
  });

  test('"Investigar agora" espera (até ~3 s) a fala em andamento fechar; se não fechar, segue sem esperar mais', async () => {
    const r = await rig({ transcript: line(10, 'a') });
    await writeConfig(r.dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 5, paused: false } });
    r.wr.onSessionState('recording', r.dir);
    await until(() => expect(r.inv()).toHaveLength(1));
    await r.idle();
    r.state.partials = ['Outros: ' + 'fala aberta que fecha em breve, '.repeat(8)];
    const before = Date.now();
    r.state.transcript += line(30, 'FECHOU-NO-ARQUIVO');
    // o relógio é falso e o disco é de verdade: o pedido confere as falas abertas a cada 250 ms (cada conferência lê `partials`),
    // então só se avança o tempo (250 ms) depois de uma nova conferência, e nunca enquanto ele está lendo o disco
    const drive = async (start: () => Promise<unknown>, onStep?: (elapsed: number) => void) => {
      let done = false;
      let seen = r.state.partialReads; // antes de pedir: a 1ª conferência já conta
      const p = start();
      void p.then(() => (done = true));
      for (let elapsed = 0; !done && elapsed < 8000; elapsed += 250) {
        await until(() => done || r.state.partialReads > seen);
        if (done) break;
        seen = r.state.partialReads;
        onStep?.(elapsed);
        await vi.advanceTimersByTimeAsync(250);
      }
      await p;
    };
    await drive(() => r.call('warroom:run-now', 'investigation'), (elapsed) => {
      if (elapsed >= 1000) r.state.partials = []; // a fala fechou em ~1 s
    });
    expect(Date.now() - before).toBeLessThan(3000); // não esperou os 3 s inteiros
    expect(r.inv()[1].prompt).toContain('FECHOU-NO-ARQUIVO');
    expect(r.inv()[1].prompt).not.toContain('[Provisório'); // já não há parcial aberto
    // fala que nunca fecha: espera no máximo ~3 s
    r.state.partials = ['Outros: ' + 'nunca fecha, '.repeat(30)];
    r.state.transcript += line(60, 'outra');
    const t1 = Date.now();
    await drive(() => r.call('warroom:run-now', 'investigation'));
    expect(Date.now() - t1).toBeGreaterThanOrEqual(2900);
    expect(Date.now() - t1).toBeLessThan(6000); // desiste em ~3 s, não fica esperando para sempre
    r.wr.engine.stop(r.dir);
  });
});
