import { describe, expect, test } from 'vitest';
import { WarRoomEngine } from '../../src/main/warroom/engine';
import { createWarRoom } from '../../src/main/warroom/ipc';
import { resolveSource } from '../../src/main/warroom/source';
import { contextFacts, defaultConfig, normalizeConfig, readConfig, writeConfig, type Fact } from '../../src/main/warroom/store';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTmpDir } from '../helpers/tmp';
import { until } from '../helpers/until';

const f = (id: string, over: Partial<Fact> = {}): Fact => ({ id, at: '', text: `achado ${id}`, source: { type: 'audio', ref: '' }, ...over });

describe('migração dos achados', () => {
  test('confirmado → fixado; pendente → achado normal; descartado continua descartado', () => {
    const cfg = normalizeConfig({ facts: [
      { id: 'a', text: 'confirmado', source: { type: 'url', ref: 'x' }, status: 'confirmed' },
      { id: 'b', text: 'pendente', source: { type: 'url', ref: 'x' }, status: 'pending' },
      { id: 'c', text: 'descartado', source: { type: 'url', ref: 'x' }, status: 'dismissed' },
      { id: 'd', text: 'novo modelo', source: { type: 'url', ref: 'x' }, pinned: true },
    ] });
    expect(cfg.facts.map((x) => [x.id, x.pinned === true, x.dismissed === true])).toEqual([['a', true, false], ['b', false, false], ['c', false, true], ['d', true, false]]);
    expect(cfg.facts.every((x) => !('status' in x))).toBe(true);
  });
});

describe('contexto dos próximos ciclos', () => {
  test('fixados primeiro + os N mais recentes não descartados (mais novo primeiro); descartados nunca', () => {
    const facts = [f('1'), f('2', { pinned: true }), f('3', { dismissed: true }), f('4'), f('5'), f('6')];
    const cfg = { ...defaultConfig(), facts };
    expect(contextFacts(cfg, 2).map((x) => x.id)).toEqual(['2', '6', '5']);
    expect(contextFacts(cfg).map((x) => x.id)).toEqual(['2', '6', '5', '4', '1']);
  });
  test('limite de tamanho: corta no teto de caracteres (sempre leva ao menos o primeiro)', () => {
    const big = Array.from({ length: 30 }, (_, i) => f(String(i), { text: 'x'.repeat(400) }));
    const out = contextFacts({ ...defaultConfig(), facts: big }, 30, 1500);
    expect(out.length).toBeLessThan(6);
    expect(out.length).toBeGreaterThan(0);
  });
  test('o ciclo de investigação leva ao prompt os fixados e os recentes (não só confirmados)', async () => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom', facts: [f('p', { pinned: true, text: 'FIXADO' }), f('r', { text: 'RECENTE' }), f('d', { text: 'DESCARTADO', dismissed: true })] });
    const prompts: string[] = [];
    const engine = new WarRoomEngine({
      runner: () => ({ async *run(o: any) { prompts.push(o.prompt); yield ''; return '[]'; } }) as any,
      transcript: async () => '**[00:00:00] Outros:** ' + 'precisamos decidir o preço do plano. '.repeat(10),
      language: async () => 'pt-BR', support: async () => ({ web: false, mcp: false, folder: false }), emit: () => {},
    });
    expect(await engine.tick(dir, { manual: true })).toBe('ran');
    expect(prompts[0]).toContain('FIXADO');
    expect(prompts[0]).toContain('RECENTE');
    expect(prompts[0]).not.toContain('DESCARTADO');
  });
});

describe('fixar, descartar, desfazer e pausar (IPC)', () => {
  async function host() {
    const dir = await makeTmpDir();
    const handlers = new Map<string, (...a: any[]) => any>();
    const calls = { reveal: [] as string[], external: [] as string[] };
    const wr = createWarRoom({
      handle: (c: string, fn: any) => void handlers.set(c, fn), send: () => {}, checkedDir: async (d: unknown) => String(d), runner: { async *run() { return '[]'; } } as any, lightRunner: () => ({ async *run() { return '[]'; } }) as any,
      provider: async () => 'claude-sub', language: async () => 'pt-BR', transcript: async () => '', isRecording: () => false, pickFolder: async () => null, saveAnnotations: async () => {}, userData: dir, openPath: async () => '',
      openExternal: async (u: string) => void calls.external.push(u), reveal: (p: string) => void calls.reveal.push(p),
    } as any);
    return { dir, handlers, calls, wr };
  }
  test('fixar / desafixar / descartar / desfazer (volta fixado se estava fixado)', async () => {
    const h = await host();
    await writeConfig(h.dir, { ...defaultConfig(), facts: [f('a'), f('b', { pinned: true })] });
    const act = (id: string, a: string) => h.handlers.get('warroom:fact')!(null, h.dir, id, a);
    await act('a', 'pin');
    expect((await readConfig(h.dir)).facts.find((x) => x.id === 'a')!.pinned).toBe(true);
    await act('a', 'unpin');
    expect((await readConfig(h.dir)).facts.find((x) => x.id === 'a')!.pinned).toBeUndefined();
    await act('b', 'dismiss');
    const gone = (await readConfig(h.dir)).facts.find((x) => x.id === 'b')!;
    expect([gone.dismissed, gone.pinned]).toEqual([true, undefined]);
    await act('b', 'undo');
    expect((await readConfig(h.dir)).facts.find((x) => x.id === 'b')!.dismissed).toBeUndefined();
    expect((await h.handlers.get('warroom:fact')!(null, h.dir, 'a', 'confirm')).ok).toBe(false); // a ação antiga não existe mais
  });
  test('pausar a investigação persiste por reunião (fontes intactas) e "Parar" é um IPC', async () => {
    const h = await host();
    await writeConfig(h.dir, { ...defaultConfig(), kind: 'warroom', sources: { web: true, mcp: false, folder: null } });
    await h.handlers.get('warroom:set')!(null, h.dir, { investigationPaused: true });
    let cfg = await readConfig(h.dir);
    expect([cfg.investigation.paused, cfg.sources.web, cfg.kind]).toEqual([true, true, 'warroom']);
    await h.handlers.get('warroom:set')!(null, h.dir, { investigationPaused: false });
    expect((await readConfig(h.dir)).investigation.paused).toBe(false);
    expect(await h.handlers.get('warroom:stop')!(null, h.dir)).toEqual({ ok: true });
  });
  test('fonte: https abre no navegador; arquivo só dentro da pasta de trabalho (revela no Finder); resto recusado', async () => {
    const h = await host();
    const folder = await makeTmpDir();
    await writeFile(join(folder, 'notas.md'), 'x');
    const outside = await makeTmpDir();
    await writeFile(join(outside, 'segredo.txt'), 'x');
    await symlink(outside, join(folder, 'link'));
    await mkdir(join(folder, 'sub'));
    await writeFile(join(folder, 'sub', 'a.ts'), 'x');
    await writeConfig(h.dir, { ...defaultConfig(), sources: { web: false, mcp: false, folder }, facts: [
      f('u', { source: { type: 'url', ref: 'https://exemplo.com/a' } }), f('h', { source: { type: 'url', ref: 'http://inseguro.com' } }), f('j', { source: { type: 'url', ref: 'javascript:alert(1)' } }),
      f('f', { source: { type: 'file', ref: 'sub/a.ts:12' } }), f('o', { source: { type: 'file', ref: join(outside, 'segredo.txt') } }), f('l', { source: { type: 'file', ref: 'link/segredo.txt' } }),
      f('d', { source: { type: 'file', ref: '../fora.txt' } }), f('t', { source: { type: 'tool', ref: 'notion' } }),
    ] });
    const open = (id: string) => h.handlers.get('warroom:open-source')!(null, h.dir, id);
    expect((await open('u')).ok).toBe(true);
    expect(h.calls.external).toEqual(['https://exemplo.com/a']);
    expect((await open('f')).ok).toBe(true);
    expect(h.calls.reveal[0]).toMatch(/sub[\\/]a\.ts$/);
    for (const id of ['h', 'j', 'o', 'l', 'd', 't']) expect((await open(id)).ok, id).toBe(false);
    expect(h.calls.external).toHaveLength(1);
    expect(h.calls.reveal).toHaveLength(1);
    expect(await resolveSource({ type: 'file', ref: 'x' }, null)).toBeNull(); // sem pasta de trabalho
  });
});

describe('Parar e pausar no motor', () => {
  test('"Parar" aborta o ciclo em andamento sem erro e a investigação pausada não roda', async () => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom' });
    let release: (() => void) | undefined;
    const engine = new WarRoomEngine({
      runner: () => ({ async *run(o: any) { await new Promise<void>((resolve, reject) => { release = resolve; o.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }); }); yield ''; return '[]'; } }) as any,
      transcript: async () => '**[00:00:00] Outros:** ' + 'precisamos decidir o preço do plano. '.repeat(10),
      language: async () => 'pt-BR', support: async () => ({ web: false, mcp: false, folder: false }), emit: () => {},
    });
    const running = engine.tick(dir, { manual: true, track: 'investigation' });
    await until(() => expect(engine.state(dir).running).toBe(true));
    engine.abort(dir);
    expect(await running).toBe('skipped');
    expect(engine.state(dir).investigation.error).toBe('');
    expect(engine.state(dir).running).toBe(false);
    void release;
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom', investigation: { intervalMin: 5, paused: true } });
    expect(await engine.tick(dir, { manual: true, track: 'investigation' })).toBe('skipped'); // pausada: nenhum ciclo
  });
});
