// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
afterEach(() => vi.useRealTimers());

it('o ponto de gravação não usa animação CSS infinita (mantinha renderer e GPU a 60 quadros/s, ~15% de um núcleo)', () => {
  const css = readFileSync('src/renderer/index.html', 'utf8');
  expect(css).not.toMatch(/animation:\s*pulse/);
  expect(css).not.toMatch(/@keyframes pulse/);
  expect(css).toMatch(/body\.beat-off \.live-dot:not\(\.paused\)/);
});

it('a batida é de 1 Hz pelo timer da gravação e para (sem classe) ao parar', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const t = bootRenderer({ sessionState: async () => ({ state: 'recording', dir: '/R/a', paused: false }) });
  await Promise.resolve();
  await t.handlers['session:state']!('recording');
  await vi.advanceTimersByTimeAsync(1000);
  expect(g.document.body.classList.contains('beat-off')).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(g.document.body.classList.contains('beat-off')).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(g.document.body.classList.contains('beat-off')).toBe(true);
  await t.handlers['session:state']!('idle');
  expect(g.document.body.classList.contains('beat-off')).toBe(false);
  await vi.advanceTimersByTimeAsync(3000);
  expect(g.document.body.classList.contains('beat-off')).toBe(false); // timer parado: nada acorda o renderer
});
