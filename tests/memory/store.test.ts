import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MemoryStore, memoryFile } from '../../src/main/memory/store';
import type { Fact } from '../../src/main/memory/types';
import { makeTmpDir } from '../helpers/tmp';

export const fact = (over: Partial<Fact> = {}): Fact => ({
  id: over.id ?? Math.random().toString(36).slice(2), kind: 'commitment', who: 'Ana', org: 'acme', about: 'proposta', text: 'Ana manda a proposta', confidence: 0.9,
  source: { dir: '/R/a', title: 'Kickoff', date: '2026-10-01T10:00:00-03:00' }, status: 'open', updatedAt: '2026-10-01T12:00:00Z', mine: false, ...over,
});

describe('MemoryStore', () => {
  test('grava por acréscimo, relê, e o último registro de cada id vale', async () => {
    const root = await makeTmpDir();
    const a = new MemoryStore(root);
    await a.put(fact({ id: '1', text: 'v1' }));
    await a.put(fact({ id: '1', text: 'v2' }));
    await a.put(fact({ id: '2', who: 'Carlos', org: undefined }));
    await a.remove(['2']);
    await a.flush();
    const b = new MemoryStore(root);
    await b.ready();
    expect(b.all().map((f) => [f.id, f.text])).toEqual([['1', 'v2']]);
    expect((await readFile(memoryFile(root), 'utf8')).trim().split('\n').length).toBe(4);
  });
  test('índice por pessoa, empresa e reunião (sem acento, sem diferenciar caixa), atualizado a cada escrita', async () => {
    const s = new MemoryStore(await makeTmpDir());
    await s.put(fact({ id: '1', who: 'José' }));
    await s.put(fact({ id: '2', who: 'jose', org: 'Acme' }));
    await s.put(fact({ id: '3', who: 'Bia', org: 'beta', source: { dir: '/R/b', title: 'B', date: '2026-10-02' } }));
    expect(s.ofPerson('JOSÉ').map((f) => f.id).sort()).toEqual(['1', '2']);
    expect(s.ofOrg('acme').map((f) => f.id).sort()).toEqual(['1', '2']);
    expect(s.ofDir('/R/b').map((f) => f.id)).toEqual(['3']);
    await s.put(fact({ id: '2', who: 'Carla', org: 'beta' })); // muda de pessoa e de empresa
    expect(s.ofPerson('jose').map((f) => f.id)).toEqual(['1']);
    expect(s.ofOrg('beta').map((f) => f.id).sort()).toEqual(['2', '3']);
  });
  test('arquivo com linha quebrada ou lixo não derruba nada', async () => {
    const root = await makeTmpDir();
    await mkdir(join(root, '.rice'));
    await writeFile(memoryFile(root), `{"op":"put","fact":${JSON.stringify(fact({ id: 'ok' }))}}\n{quebrado\n{"op":"put","fact":{"id":1}}\nnull\n`);
    const s = new MemoryStore(root);
    await s.ready();
    expect(s.all().map((f) => f.id)).toEqual(['ok']);
  });
  test('apagar uma reunião remove os fatos dela e reabre o que ela tinha fechado em outras', async () => {
    const s = new MemoryStore(await makeTmpDir());
    await s.put(fact({ id: 'a', source: { dir: '/R/1', title: 'R1', date: '2026-10-01' } }));
    await s.put(fact({ id: 'b', status: 'done', source: { dir: '/R/1', title: 'R1', date: '2026-10-01' }, doneBy: { dir: '/R/2', title: 'R2', date: '2026-10-05' }, doneAt: '2026-10-05' }));
    await s.put(fact({ id: 'c', who: 'Carlos', status: 'done', source: { dir: '/R/3', title: 'R3', date: '2026-10-03' }, doneBy: { dir: '/R/2', title: 'R2', date: '2026-10-05' }, doneAt: '2026-10-05' }));
    await s.put(fact({ id: 'd', source: { dir: '/R/2', title: 'R2', date: '2026-10-05' } }));
    await s.markExtracted('/R/2');
    await s.removeMeeting('/R/2');
    expect(s.get('d')).toBeUndefined();
    expect(s.isExtracted('/R/2')).toBe(false);
    expect(s.get('c')).toMatchObject({ status: 'open' }); // quem a fechou foi apagada
    expect(s.get('c')?.doneBy).toBeUndefined();
    expect(s.get('a')).toBeDefined();
    await s.flush();
    const again = new MemoryStore(s['root' as never]);
    await again.ready();
    expect(again.get('d')).toBeUndefined();
    expect(again.get('c')?.status).toBe('open');
  });
  test('esquecer pessoa/empresa e apagar tudo', async () => {
    const s = new MemoryStore(await makeTmpDir());
    await s.putMany([fact({ id: '1', who: 'Ana', org: 'acme' }), fact({ id: '2', who: 'Bia', org: 'acme' }), fact({ id: '3', who: 'Cid', org: 'beta' })]);
    expect(await s.forget('person', 'ana')).toBe(1);
    expect(await s.forget('org', 'ACME')).toBe(1);
    expect(s.all().map((f) => f.id)).toEqual(['3']);
    await s.clear();
    expect(s.size).toBe(0);
    const again = new MemoryStore((s as never as { root: string }).root);
    await again.ready();
    expect(again.size).toBe(0);
  });
  test('pendências abertas daquelas pessoas e empresas, mais recentes primeiro, com teto', async () => {
    const s = new MemoryStore(await makeTmpDir());
    const many = Array.from({ length: 40 }, (_, i) => fact({ id: `f${i}`, updatedAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` }));
    await s.putMany([...many, fact({ id: 'dec', kind: 'decision' }), fact({ id: 'done', status: 'done' }), fact({ id: 'other', who: 'Zed', org: 'zzz' })]);
    const open = s.openFor(['ana'], ['acme'], 30);
    expect(open).toHaveLength(30);
    expect(open.every((f) => f.status === 'open' && (f.kind === 'commitment' || f.kind === 'request'))).toBe(true);
    expect(open.some((f) => f.id === 'other')).toBe(false);
  });
  test('compacta quando há muito lixo no arquivo', async () => {
    const root = await makeTmpDir();
    const s = new MemoryStore(root);
    await s.ready();
    for (let i = 0; i < 260; i++) await s.put(fact({ id: 'x', text: `v${i}` }));
    await s.flush();
    const again = new MemoryStore(root);
    await again.ready();
    await again.flush();
    expect((await readFile(memoryFile(root), 'utf8')).trim().split('\n')).toHaveLength(1);
    expect(again.get('x')?.text).toBe('v259');
  });
});
