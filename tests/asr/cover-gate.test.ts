import { describe, expect, test } from 'vitest';
import { COVER_POLLS_TO_PAUSE, COVER_THRESHOLD, CoverTracker, partialsWanted } from '../../src/main/asr/partials-gate';

describe('gate dos parciais', () => {
  test('visível e descoberta: pede; coberta: não; nub expandido pede sempre', () => {
    expect(partialsWanted(true, false, false)).toBe(true);
    expect(partialsWanted(true, false, true)).toBe(false);
    expect(partialsWanted(false, false, false)).toBe(false);
    expect(partialsWanted(true, true, true)).toBe(true); // nub expandido continua contando como visível, mesmo com a janela coberta
    expect(partialsWanted(false, true, true)).toBe(true);
  });
  test('sem o terceiro argumento o comportamento anterior (visível/oculta) não muda', () => {
    expect(partialsWanted(true, false)).toBe(true);
    expect(partialsWanted(false, false)).toBe(false);
  });
});

describe('CoverTracker (1 amostra por segundo do rice-detector)', () => {
  test('pausa só depois de 2 amostras seguidas >= 95%', () => {
    const t = new CoverTracker();
    expect(COVER_POLLS_TO_PAUSE).toBe(2);
    expect(t.sample(true, 1)).toBe(false);
    expect(t.sample(true, 1)).toBe(true);
    expect(t.covered).toBe(true);
  });
  test('uma amostra descoberta retoma na hora', () => {
    const t = new CoverTracker();
    t.sample(true, 1);
    t.sample(true, 0.99);
    expect(t.covered).toBe(true);
    expect(t.sample(true, 0.5)).toBe(false);
  });
  test('um piscar (coberta, descoberta, coberta) não pausa: a sequência recomeça', () => {
    const t = new CoverTracker();
    t.sample(true, 1);
    t.sample(true, 0);
    expect(t.sample(true, 1)).toBe(false);
  });
  test('limiar: 94% não pausa, 95% pausa', () => {
    expect(COVER_THRESHOLD).toBe(0.95);
    const a = new CoverTracker();
    a.sample(true, 0.94);
    expect(a.sample(true, 0.94)).toBe(false);
    const b = new CoverTracker();
    b.sample(true, 0.95);
    expect(b.sample(true, 0.95)).toBe(true);
  });
  test('fora da tela (outro Space, minimizada) conta como coberta', () => {
    const t = new CoverTracker();
    t.sample(false, 0);
    expect(t.sample(false, 0)).toBe(true);
  });
  test('reset (detector caiu, gravação acabou) volta a pedir parciais', () => {
    const t = new CoverTracker();
    t.sample(true, 1);
    t.sample(true, 1);
    t.reset();
    expect(t.covered).toBe(false);
    expect(t.sample(true, 1)).toBe(false); // a contagem recomeça
  });
});
