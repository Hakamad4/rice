import { afterEach, expect, it } from 'vitest';
import { setLightFactor } from '../../src/main/platform/light';
import { defaultConfig } from '../../src/main/warroom/store';

afterEach(() => setLightFactor(1));

it('modo leve: os intervalos padrão de ideias e war room dobram (5 → 10 min); ideias seguem desligadas por padrão', () => {
  expect(defaultConfig().ideas).toMatchObject({ on: false, intervalMin: 5 });
  setLightFactor(2);
  const cfg = defaultConfig();
  expect(cfg.ideas).toMatchObject({ on: false, intervalMin: 10 });
  expect(cfg.investigation.intervalMin).toBe(10);
  setLightFactor(0); // valor inválido volta ao normal
  expect(defaultConfig().ideas.intervalMin).toBe(5);
});
