import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MicMuteMonitor, MUTE_SILENCE_MS, rmsDb } from '../../src/main/session/mic-mute';

const frame = (amp: number): Buffer => {
  const b = Buffer.alloc(3200); // 100 ms a 16 kHz
  for (let i = 0; i < 1600; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 3)), i * 2);
  return b;
};
const LOUD = frame(8000);
const QUIET = frame(5);

/** Alimenta `seconds` s de frames de 100 ms. */
function run(m: MicMuteMonitor, from: number, seconds: number, mic: Buffer, sys: Buffer): number {
  let t = from;
  for (let i = 0; i < seconds * 10; i++, t += 100) {
    m.feed('mic', mic, t);
    m.feed('sys', sys, t);
  }
  return t;
}

describe('aviso de microfone mudo', () => {
  it('nível: tom forte passa do limiar de voz, silêncio não', () => {
    expect(rmsDb(LOUD)).toBeGreaterThan(-20);
    expect(rmsDb(QUIET)).toBeLessThan(-60);
    expect(rmsDb(Buffer.alloc(0))).toBe(-120);
  });

  it('mic sem voz por 20 s COM fala do sistema: é hora de olhar as outras entradas, e só uma vez', () => {
    const m = new MicMuteMonitor();
    m.reset(0);
    let t = run(m, 0, 19, QUIET, LOUD);
    expect(m.due(t)).toBe(false); // ainda não deu 20 s
    t = run(m, t, 2, QUIET, LOUD);
    expect(m.due(t)).toBe(true);
    expect(m.due(t + 100)).toBe(false); // não olha de novo na hora
    m.markWarned();
    t = run(m, t, 30, QUIET, LOUD);
    expect(m.due(t)).toBe(false); // no máximo 1 aviso por gravação
  });

  it('sem fala do sistema (ou com o usuário falando no mic): nada', () => {
    const quietSys = new MicMuteMonitor();
    quietSys.reset(0);
    expect(quietSys.due(run(quietSys, 0, 30, QUIET, QUIET))).toBe(false);
    const talking = new MicMuteMonitor();
    talking.reset(0);
    expect(talking.due(run(talking, 0, 30, LOUD, LOUD))).toBe(false);
  });

  it('voz no mic reinicia a contagem dos 20 s', () => {
    const m = new MicMuteMonitor();
    m.reset(0);
    let t = run(m, 0, 15, QUIET, LOUD);
    t = run(m, t, 1, LOUD, LOUD); // o usuário falou
    t = run(m, t, 10, QUIET, LOUD);
    expect(m.due(t)).toBe(false);
    t = run(m, t, 12, QUIET, LOUD);
    expect(m.due(t)).toBe(true);
  });

  it('trocar o microfone reabre o aviso (nova contagem)', () => {
    const m = new MicMuteMonitor();
    m.reset(0);
    let t = run(m, 0, 21, QUIET, LOUD);
    expect(m.due(t)).toBe(true);
    m.markWarned();
    m.reset(t); // trocou de microfone
    t = run(m, t, MUTE_SILENCE_MS / 1000 + 1, QUIET, LOUD);
    expect(m.due(t)).toBe(true);
  });
});

describe('memória do monitor (nada cresce, nada aloca por frame)', () => {
  const gcNow = (): (() => void) => {
    v8.setFlagsFromString('--expose-gc');
    return runInNewContext('gc') as () => void;
  };

  it('10 min de frames simulados (mic calado, sistema falando, voz volta e meio, trocas): o heap fica estável', () => {
    const gc = gcNow();
    const m = new MicMuteMonitor();
    m.reset(0);
    let t = 0;
    const step = (secs: number, mic: Buffer, sys: Buffer) => {
      for (let i = 0; i < secs * 10; i++, t += 100) {
        m.feed('mic', mic, t);
        m.feed('sys', sys, t);
        m.due(t);
      }
    };
    step(30, QUIET, LOUD); // aquece (JIT, caches)
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let round = 0; round < 10; round++) {
      step(20, QUIET, LOUD); // calado com o sistema falando: due() roda o tempo todo
      step(20, LOUD, LOUD);
      step(10, QUIET, QUIET);
      step(10, LOUD, QUIET);
      m.reset(t); // trocou de microfone
      m.markWarned();
    }
    gc();
    const grown = process.memoryUsage().heapUsed - before;
    expect(t / 1000).toBeGreaterThanOrEqual(600); // ≥ 10 min simulados (12 000 frames)
    expect(grown).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('o estado é de tamanho fixo: o mesmo objeto depois de horas não guarda mais nada', () => {
    const m = new MicMuteMonitor();
    m.reset(0);
    run(m, 0, 3600, QUIET, LOUD); // 1 h
    const own = Object.values(m as unknown as Record<string, unknown>);
    expect(own.filter((v) => Array.isArray(v))).toEqual([]); // sem arrays que crescem
    expect(own.filter((v) => ArrayBuffer.isView(v)).every((v) => (v as Float64Array).length === 21)).toBe(true);
  });
});
