import { expect, test } from 'vitest';
import { logMelFeatures } from '../../src/main/asr/fbank';

const tone = (hz: number, seconds: number, amp = 0.5): Float32Array => Float32Array.from({ length: Math.floor(16_000 * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 16_000));
const concat = (...a: Float32Array[]): Float32Array => Float32Array.from(a.flatMap((x) => [...x]));
/** Ruído branco determinístico e baixo, para as partes "sem sinal" (o log de silêncio digital seria ruído numérico). */
const hiss = (seconds: number): Float32Array => { let s = 12345; return Float32Array.from({ length: Math.floor(16_000 * seconds) }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.002); };

test('um quadro de 25 ms a cada 10 ms, 80 filtros, sem preencher as bordas', () => {
  expect(logMelFeatures(new Float32Array(399)).frames).toBe(0);
  expect(logMelFeatures(new Float32Array(400)).frames).toBe(1);
  const { data, frames } = logMelFeatures(hiss(1));
  expect(frames).toBe(98); // 1 + (16000 - 400) / 160
  expect(data).toHaveLength(98 * 80);
});

test('cada dimensão sai com média zero ao longo do tempo (global-mean dos modelos de voz)', () => {
  const { data, frames } = logMelFeatures(concat(tone(300, 0.5), hiss(0.5), tone(2000, 0.5)));
  for (let b = 0; b < 80; b++) {
    let sum = 0;
    for (let f = 0; f < frames; f++) sum += data[f * 80 + b]!;
    expect(Math.abs(sum / frames)).toBeLessThan(1e-3);
  }
});

test('o tom aparece no filtro mel certo: graves nos primeiros filtros, agudos nos últimos', () => {
  const peakBin = (hz: number) => {
    const { data, frames } = logMelFeatures(concat(tone(hz, 0.6), hiss(0.6)));
    const avg = new Float32Array(80);
    for (let f = 0; f < 40; f++) for (let b = 0; b < 80; b++) avg[b]! += data[f * 80 + b]! / 40; // só a parte com tom
    expect(frames).toBeGreaterThan(100);
    return avg.indexOf(Math.max(...avg));
  };
  const low = peakBin(300);
  const mid = peakBin(1000);
  const high = peakBin(4000);
  expect(low).toBeLessThan(mid);
  expect(mid).toBeLessThan(high);
  expect(low).toBeLessThan(20);
  expect(high).toBeGreaterThan(55);
});

test('componente DC (offset do microfone) não muda as features', () => {
  const x = concat(tone(500, 0.4), hiss(0.4));
  const shifted = Float32Array.from(x, (v) => v + 0.1);
  const a = logMelFeatures(x).data;
  const b = logMelFeatures(shifted).data;
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  expect(worst).toBeLessThan(0.05);
});
