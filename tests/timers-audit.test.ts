import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Auditoria dos timers do processo principal (Windows "otimizado"): nada acorda o computador à toa. Todo setInterval tem `.unref()` ou é
 * guardado para ser limpo, e os que rodam sempre têm intervalo >= 1 min; o único mais curto (batimento do war room, 15 s) só existe gravando.
 */
const main = readFileSync('src/main/app/main.ts', 'utf8');
const lines = main.split('\n');

describe('timers do main', () => {
  const intervals = lines.map((l, i) => ({ l, i })).filter(({ l }) => /\bsetInterval\(/.test(l) && !l.trim().startsWith('//'));

  it('existem e cada um é conhecido (lista fechada: qualquer timer novo precisa ser pensado aqui)', () => {
    const summary = intervals.map(({ l }) => (/\d[\d_]* ?\* ?\d[\d_]*( ?\* ?\d[\d_]*)?|ICS_REFRESH_MS|\d[\d_]*/.exec(l.split('setInterval(')[1] ?? '') ?? [''])[0]);
    expect(intervals.length).toBeGreaterThanOrEqual(6);
    expect(intervals.length).toBeLessThanOrEqual(10);
    expect(summary.length).toBe(intervals.length);
  });

  it('todo setInterval tem unref() ou é guardado numa variável para ser limpo', () => {
    for (const { l, i } of intervals) {
      const block = lines.slice(i, i + 3).join('\n');
      expect(/\.unref\(\)/.test(block) || /(?:=|:)\s*setInterval\(/.test(l), `linha ${i + 1}: ${l.trim()}`).toBe(true);
    }
  });

  it('os intervalos que rodam o tempo todo são de pelo menos 1 minuto; só o batimento do war room é curto e fica preso à gravação', () => {
    for (const { l, i } of intervals) {
      const m = /,\s*(\d[\d_]*)(?:\s*\*\s*(\d[\d_]*))?(?:\s*\*\s*(\d[\d_]*))?\)/.exec(l);
      const ms = m ? [m[1], m[2], m[3]].filter(Boolean).reduce((a, x) => a * Number(String(x).replace(/_/g, '')), 1) : l.includes('ICS_REFRESH_MS') ? 600_000 : null;
      if (ms === null) continue;
      if (ms < 60_000) {
        expect(l, `linha ${i + 1}`).toContain('warRoom.ensure'); // o único curto
        const before = lines.slice(Math.max(0, i - 6), i).join('\n');
        expect(before).toMatch(/state === 'recording'/); // criado só ao começar a gravar
      }
    }
  });

  it('a verificação de atualização do Windows, a agenda ICS e a varredura de retenção usam intervalos de horas ou de minutos, nunca segundos', () => {
    expect(main).toMatch(/setInterval\(checkUpdate, 6 \* 3_600_000\)/);
    expect(main).toMatch(/ICS_REFRESH_MS/);
    expect(main).toMatch(/sweepRetention\(\)[\s\S]{0,120}24 \* 3_600_000/);
  });
});
