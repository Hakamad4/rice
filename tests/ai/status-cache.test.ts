import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { resolveAiSettings, type RunnerDeps } from '../../src/main/ai/factory';
import { aiStatus, invalidateAiStatus, LOGIN_CACHE_MS, NO_LOGIN_CACHE_MS } from '../../src/main/ai/service';
import { makeTmpDir } from '../helpers/tmp';

/** opencode falso: `auth list` demora 300 ms e conta quantas vezes rodou. */
async function fakeOpenCode(dir: string, loggedIn = true) {
  const counter = join(dir, 'calls');
  const bin = join(dir, 'opencode');
  await writeFile(bin, `#!/bin/sh\necho x >> "${counter}"\nsleep 0.3\n${loggedIn ? 'echo "1 credentials"' : 'echo "No authenticated integrations"'}\n`);
  await chmod(bin, 0o755);
  return { bin, calls: async () => ((await import('node:fs/promises')).readFile(counter, 'utf8').catch(() => '')).then((t) => t.split('\n').filter(Boolean).length) };
}

const deps = (bin: string, workDir: string): RunnerDeps => ({
  getSecret: async () => null,
  binaries: { claude: 'claude', codex: 'codex', opencode: bin, agy: '/nao/existe/agy' },
  workDir,
});

beforeEach(() => invalidateAiStatus());

describe('aiStatus', () => {
  test('o login do OpenCode é consultado uma vez e vale por alguns minutos', async () => {
    const dir = await makeTmpDir();
    const oc = await fakeOpenCode(dir);
    const settings = resolveAiSettings(undefined);
    const t0 = Date.now();
    const first = await aiStatus(settings, deps(oc.bin, dir), t0);
    const slow = Date.now() - t0;
    const t1 = Date.now();
    const second = await aiStatus(settings, deps(oc.bin, dir), t0 + 60_000);
    const fast = Date.now() - t1;
    expect(first.providers['opencode-sub'].loggedIn).toBe(second.providers['opencode-sub'].loggedIn);
    expect(await oc.calls()).toBe(1);
    expect(slow).toBeGreaterThanOrEqual(250);
    expect(fast).toBeLessThan(150);
    await aiStatus(settings, deps(oc.bin, dir), t0 + LOGIN_CACHE_MS + 1); // venceu: consulta de novo
    expect(await oc.calls()).toBe(2);
  });

  test('invalidar (testar, trocar ou salvar chave) força nova consulta', async () => {
    const dir = await makeTmpDir();
    const oc = await fakeOpenCode(dir);
    const settings = resolveAiSettings(undefined);
    await aiStatus(settings, deps(oc.bin, dir), 1000);
    invalidateAiStatus();
    await aiStatus(settings, deps(oc.bin, dir), 2000);
    expect(await oc.calls()).toBe(2);
  });

  test('"não logado" fica em cache só por segundos: o login feito no terminal aparece logo', async () => {
    const dir = await makeTmpDir();
    const oc = await fakeOpenCode(dir, false);
    const settings = resolveAiSettings(undefined);
    expect((await aiStatus(settings, deps(oc.bin, dir), 1000)).providers['opencode-sub'].loggedIn).toBe(false);
    await aiStatus(settings, deps(oc.bin, dir), 2000);
    expect(await oc.calls()).toBe(1); // dentro de 20 s: não repete
    await aiStatus(settings, deps(oc.bin, dir), 1000 + NO_LOGIN_CACHE_MS + 1);
    expect(await oc.calls()).toBe(2);
  });

  test('chamadas simultâneas dividem a mesma consulta', async () => {
    const dir = await makeTmpDir();
    const oc = await fakeOpenCode(dir);
    const settings = resolveAiSettings(undefined);
    await Promise.all([aiStatus(settings, deps(oc.bin, dir), 1000), aiStatus(settings, deps(oc.bin, dir), 1000)]);
    expect(await oc.calls()).toBe(1);
  });
});
