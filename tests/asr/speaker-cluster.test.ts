import { expect, test } from 'vitest';
import { OnlineSpeakerClusterer } from '../../src/main/asr/speaker-cluster';

/** Vozes sintéticas: um vetor-base por pessoa mais um pouco de ruído determinístico. */
const BASES = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
const voice = (who: number, jitter = 0.1, k = 0): number[] => BASES[who]!.map((v, i) => v + jitter * Math.sin(k * 7 + i * 3));

test('separa três pessoas e mantém cada uma no mesmo número', () => {
  const c = new OnlineSpeakerClusterer();
  const order = [0, 1, 2, 0, 1, 2, 2, 0, 1];
  expect(order.map((who, k) => c.assign(voice(who, 0.1, k), 4000))).toEqual([1, 2, 3, 1, 2, 3, 3, 1, 2]);
  expect(c.speakerCount).toBe(3);
});

test('trecho curto e estranho não cria pessoa nova: herda quem falava antes', () => {
  const c = new OnlineSpeakerClusterer();
  c.assign(voice(0), 4000);
  c.assign(voice(1), 4000);
  c.assign(voice(1), 4000);
  expect(c.assign([0.2, 0.2, 0.9, 0.2], 500)).toBe(2); // curto (500 ms) e longe de todos: o último que falou
  expect(c.speakerCount).toBe(2);
});

test('trecho curto parecido com alguém entra nesse alguém; sem nenhum grupo ainda devolve null', () => {
  const c = new OnlineSpeakerClusterer();
  expect(c.assign(voice(0), 500)).toBeNull();
  c.assign(voice(0), 4000);
  c.assign(voice(1), 4000);
  expect(c.assign(voice(0, 0.05, 3), 600)).toBe(1);
});

test('limite de pessoas: a partir dele, vozes novas entram no grupo mais próximo', () => {
  const c = new OnlineSpeakerClusterer({ maxSpeakers: 2 });
  c.assign(voice(0), 4000);
  c.assign(voice(1), 4000);
  expect(c.assign(voice(2), 4000)).toBeLessThanOrEqual(2);
  expect(c.speakerCount).toBe(2);
});

test('o estado pode ser salvo e retomado (continuar gravação) sem renumerar ninguém', () => {
  const a = new OnlineSpeakerClusterer();
  a.assign(voice(0), 4000);
  a.assign(voice(1), 4000);
  const b = new OnlineSpeakerClusterer({}, JSON.parse(JSON.stringify(a.snapshot())));
  expect(b.assign(voice(1, 0.05, 2), 4000)).toBe(2);
  expect(b.assign(voice(2), 4000)).toBe(3);
});
