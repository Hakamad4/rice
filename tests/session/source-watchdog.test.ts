import { expect, test } from 'vitest';
import { SourceWatchdog, type WatchdogEvent } from '../../src/main/session/source-watchdog';

const sound = Buffer.alloc(3200, 3);
const quiet = Buffer.alloc(3200, 0);

/** Roda `seconds` de relógio simulado: blocos de 100 ms por fonte quando `feed` devolve um buffer; tick a cada 1 s. */
function run(w: SourceWatchdog, from: number, seconds: number, feed: (t: number, source: 'mic' | 'sys') => Buffer | null): { events: WatchdogEvent[]; end: number } {
  const events: WatchdogEvent[] = [];
  let t = from;
  for (let i = 0; i < seconds * 10; i++, t += 100) {
    for (const source of ['mic', 'sys'] as const) {
      const pcm = feed(t, source);
      if (pcm) events.push(...w.onFrame(source, pcm, t));
    }
    if (t % 1000 === 0) events.push(...w.tick(t));
  }
  return { events, end: t };
}
const types = (e: WatchdogEvent[]) => e.map((x) => `${x.type}:${'source' in x ? x.source : ''}`);

test('fontes saudáveis não geram nada', () => {
  const w = new SourceWatchdog();
  w.captureStarted(0);
  expect(run(w, 0, 120, () => sound).events).toEqual([]);
});

test('sistema para de entregar blocos: detecta em ~7 s, pede reinício com espera crescente e desiste depois do teto', () => {
  const w = new SourceWatchdog({ maxStallRestarts: 3 });
  w.captureStarted(0);
  const { events } = run(w, 0, 120, (t, s) => (s === 'mic' || t < 10_000 ? sound : null));
  const stalled = events.find((e) => e.type === 'stalled')! as Extract<WatchdogEvent, { type: 'stalled' }>;
  expect(stalled.source).toBe('sys');
  expect(stalled.since).toBeGreaterThanOrEqual(9900);
  const restarts = events.filter((e) => e.type === 'restart');
  expect(restarts.map((e) => (e as { attempt: number }).attempt)).toEqual([1, 2, 3]);
  expect(types(events)).toContain('failed:sys');
  expect(events.filter((e) => e.type === 'failed')).toHaveLength(1); // uma vez só: sem laço de avisos
  expect(types(events).filter((x) => x.endsWith(':mic'))).toEqual([]); // o microfone segue saudável
});

test('volta a entregar sinal: "recovered" com o início da queda (para a lacuna) e o contador zera', () => {
  const w = new SourceWatchdog();
  w.captureStarted(0);
  const first = run(w, 0, 30, (t, s) => (s === 'sys' && t >= 5000 && t < 20_000 ? null : sound));
  expect(types(first.events)).toContain('stalled:sys');
  const recovered = first.events.find((e) => e.type === 'recovered') as Extract<WatchdogEvent, { type: 'recovered' }>;
  expect(recovered.gapFrom).toBeGreaterThanOrEqual(4900);
  expect(w.state('sys')).toBe('ok');
  expect(w.isFailed('sys')).toBe(false);
});

test('captura reiniciada ganha período de graça: não é considerada travada no mesmo segundo', () => {
  const w = new SourceWatchdog({ graceMs: 5000 });
  w.captureStarted(0);
  const a = run(w, 0, 10, (t, s) => (s === 'mic' ? sound : null));
  expect(types(a.events)).toContain('restart:sys');
  const count = a.events.filter((e) => e.type === 'restart').length;
  w.captureStarted(a.end);
  const b = run(w, a.end, 4, (_t, s) => (s === 'mic' ? sound : null)); // 4 s < graça: nada de novo
  expect(b.events.filter((e) => e.type === 'restart')).toHaveLength(0);
  expect(count).toBe(1);
});

test('mic com zeros exatos por 30 s: avisa "silent" e reinicia UMA vez; depois só o aviso, sem mais reinícios', () => {
  const w = new SourceWatchdog();
  w.captureStarted(0);
  const mic = run(w, 0, 400, (_t, s) => (s === 'mic' ? quiet : sound));
  expect(types(mic.events)).toContain('silent:mic');
  expect(mic.events.filter((e) => e.type === 'restart')).toHaveLength(1);
  expect(mic.events.filter((e) => e.type === 'failed')).toEqual([{ type: 'failed', source: 'mic', reason: 'silent' }]);
});

test('silêncio exato do SISTEMA nunca é falha: 30 min de zeros com o mic falando = nenhum evento', () => {
  const w = new SourceWatchdog();
  w.captureStarted(0);
  expect(run(w, 0, 30 * 60, (_t, s) => (s === 'sys' ? quiet : sound)).events).toEqual([]);
});

test('qualquer sinal acima de zero encerra o episódio de silêncio', () => {
  const w = new SourceWatchdog();
  w.captureStarted(0);
  const a = run(w, 0, 70, (_t, s) => (s === 'mic' ? quiet : sound));
  expect(types(a.events)).toContain('silent:mic');
  const b = run(w, a.end, 2, () => sound);
  expect(types(b.events)).toContain('recovered:mic');
  const c = run(w, b.end, 40, () => sound);
  expect(c.events).toEqual([]);
});

test('fonte que o usuário não quer vigiar (setExpected false) é ignorada', () => {
  const w = new SourceWatchdog();
  w.setExpected('sys', false);
  w.captureStarted(0);
  expect(run(w, 0, 60, (_t, s) => (s === 'mic' ? sound : null)).events).toEqual([]);
});
