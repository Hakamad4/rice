import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Folder } from '../../src/shared/types';
import { effectiveRetention, isSensitiveFolder } from '../../src/main/privacy/folder-rules';
import { planSweep, sweepNotice, type SweepMeeting } from '../../src/main/privacy/retention';
import { createFolder, parseRetention, readFolders, setFolderPrivacy } from '../../src/main/store/folders';
import { tn } from '../../src/main/i18n';
import { makeTmpDir } from '../helpers/tmp';

const NOW = new Date('2026-10-13T12:00:00-03:00');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const f = (id: string, name: string, extra: Partial<Folder> = {}): Folder => ({ id, name, createdAt: '', order: 0, ...extra });
const meeting = (dir: string, over: Partial<SweepMeeting> = {}): SweepMeeting => ({ dir, state: 'done', startedAt: daysAgo(100), endedAt: daysAgo(100), audio: ['audio.m4a'], ...over });
const plan = (meetings: SweepMeeting[], folders: Folder[], fallback = undefined as Parameters<typeof planSweep>[0]['fallback'], busy = new Set<string>()) => planSweep({ meetings, folders, fallback, now: NOW, busy });

describe('regras da pasta e herança', () => {
  const tree = [f('a', 'Jurídico', { sensitive: true, retention: { audioDays: 30, meetingMonths: 12 } }), f('b', 'Contratos', { parentId: 'a' }), f('c', 'Rascunhos', { parentId: 'b', retention: { audioDays: 7 } }), f('d', 'Outra')];

  test('subpasta herda da mãe (cada regra, de forma independente); a própria regra vale sobre a da mãe', () => {
    expect(effectiveRetention(tree, 'b', undefined)).toEqual({ audioDays: 30, meetingMonths: 12 });
    expect(effectiveRetention(tree, 'c', undefined)).toEqual({ audioDays: 7, meetingMonths: 12 }); // áudio próprio, reunião herdada
    expect(effectiveRetention(tree, 'd', undefined)).toEqual({ audioDays: 0, meetingMonths: 0 }); // sem regra: manter sempre
  });
  test('"manter sempre" explícito (0) vale contra a mãe e contra o padrão; sem pasta vale o padrão global', () => {
    const t = [f('a', 'A', { retention: { audioDays: 30 } }), f('b', 'B', { parentId: 'a', retention: { audioDays: 0 } })];
    expect(effectiveRetention(t, 'b', { audioDays: 90 }).audioDays).toBe(0);
    expect(effectiveRetention(t, undefined, { audioDays: 90, meetingMonths: 6 })).toEqual({ audioDays: 90, meetingMonths: 6 });
    expect(effectiveRetention(t, 'inexistente', { audioDays: 90 }).audioDays).toBe(90);
  });
  test('pasta sensível: a própria ou qualquer mãe; ciclo em arquivo editado à mão não trava', () => {
    expect(isSensitiveFolder(tree, 'c')).toBe(true);
    expect(isSensitiveFolder(tree, 'd')).toBe(false);
    expect(isSensitiveFolder(tree, undefined)).toBe(false);
    const loop = [f('x', 'X', { parentId: 'y' }), f('y', 'Y', { parentId: 'x' })];
    expect(isSensitiveFolder(loop, 'x')).toBe(false);
    expect(effectiveRetention(loop, 'x', { audioDays: 7 }).audioDays).toBe(7);
  });
});

describe('quem vence, quando', () => {
  const folders = [f('j', 'Jurídico', { retention: { audioDays: 30, meetingMonths: 6 } })];

  test('áudio: só depois do prazo; a reunião (notas e transcrição) fica', () => {
    expect(plan([meeting('/R/a', { folderId: 'j', startedAt: daysAgo(29), endedAt: daysAgo(29) })], folders)).toEqual([]);
    const out = plan([meeting('/R/b', { folderId: 'j', startedAt: daysAgo(31), endedAt: daysAgo(31) })], folders);
    expect(out).toEqual([{ kind: 'audio', dir: '/R/b', files: ['audio.m4a'], source: 'Jurídico' }]);
  });
  test('reunião inteira: vence em meses (6 meses) e leva tudo, sem ação extra de áudio', () => {
    const old = meeting('/R/c', { folderId: 'j', startedAt: new Date('2026-04-10T10:00:00-03:00').toISOString(), endedAt: new Date('2026-04-10T11:00:00-03:00').toISOString() });
    const young = meeting('/R/d', { folderId: 'j', startedAt: new Date('2026-04-14T10:00:00-03:00').toISOString(), endedAt: new Date('2026-04-14T11:00:00-03:00').toISOString() });
    expect(plan([old, young], folders)).toEqual([{ kind: 'meeting', dir: '/R/c', files: [], source: 'Jurídico' }, { kind: 'audio', dir: '/R/d', files: ['audio.m4a'], source: 'Jurídico' }]);
  });
  test('sem pasta usa o padrão global; sem nenhuma regra nada acontece', () => {
    expect(plan([meeting('/R/e')], [], { audioDays: 90 })).toEqual([{ kind: 'audio', dir: '/R/e', files: ['audio.m4a'], source: null }]);
    expect(plan([meeting('/R/e', { startedAt: daysAgo(80), endedAt: daysAgo(80) })], [], { audioDays: 90 })).toEqual([]);
    expect(plan([meeting('/R/e', { startedAt: daysAgo(4000), endedAt: daysAgo(4000) })], [], undefined)).toEqual([]);
  });
  test('herda da mãe: o aviso cita a pasta que definiu a regra', () => {
    const tree = [f('a', 'Jurídico', { retention: { audioDays: 7 } }), f('b', 'Contratos', { parentId: 'a' })];
    expect(plan([meeting('/R/f', { folderId: 'b' })], tree)).toEqual([{ kind: 'audio', dir: '/R/f', files: ['audio.m4a'], source: 'Jurídico' }]);
  });
  test('reunião sem áudio (já removido) não gera ação: nada é reprocessado', () => {
    expect(plan([meeting('/R/g', { folderId: 'j', audio: [] })], folders)).toEqual([]);
  });
});

describe('a gravação nunca é afetada', () => {
  const folders = [f('j', 'Jurídico', { retention: { audioDays: 7, meetingMonths: 6 } })];
  test('gravando, finalizando, interrompida ou danificada: nunca, por mais velha que seja', () => {
    const states = ['recording', 'finishing', 'interrupted', 'damaged'] as const;
    expect(plan(states.map((state, i) => meeting(`/R/${i}`, { state, folderId: 'j', startedAt: daysAgo(900), endedAt: daysAgo(900) })), folders)).toEqual([]);
  });
  test('a reunião que a sessão está usando agora fica de fora mesmo que o meta pareça vencido', () => {
    expect(plan([meeting('/R/live', { folderId: 'j', startedAt: daysAgo(900) })], folders, undefined, new Set(['/R/live']))).toEqual([]);
  });
  test('rascunho vencido por "reunião inteira" vai; rascunho nunca perde "áudio" (não tem)', () => {
    expect(plan([meeting('/R/h', { state: 'draft', folderId: 'j', audio: [], startedAt: daysAgo(400) })], folders)).toEqual([{ kind: 'meeting', dir: '/R/h', files: [], source: 'Jurídico' }]);
    expect(plan([meeting('/R/i', { state: 'draft', folderId: 'j', audio: [] })], [f('j', 'J', { retention: { audioDays: 7 } })])).toEqual([]);
  });
});

describe('aviso uma vez (Lixeira, nunca definitivo)', () => {
  test('uma linha por tipo e pasta, com plural', () => {
    const done = [
      { kind: 'audio' as const, dir: '/R/1', files: ['audio.m4a'], source: 'Jurídico' },
      { kind: 'audio' as const, dir: '/R/2', files: ['audio.m4a'], source: 'Jurídico' },
      { kind: 'audio' as const, dir: '/R/3', files: ['audio.m4a'], source: 'Jurídico' },
      { kind: 'meeting' as const, dir: '/R/4', files: [], source: null },
    ];
    expect(sweepNotice(done, (k, n, v) => tn(k, n, v))).toEqual(['3 áudios antigos foram para a Lixeira pela regra da pasta Jurídico', '1 reunião antiga foi para a Lixeira pela regra padrão de guarda']);
  });
});

describe('guardado em folders.json', () => {
  test('pasta sensível e retenção persistem, só com valores oferecidos; null volta a herdar; subpasta continua com a mãe', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'Jurídico');
    const b = await createFolder(root, 'Contratos', a.id);
    await setFolderPrivacy(root, a.id, { sensitive: true, retention: { audioDays: 30, meetingMonths: 12 } });
    const read = await readFolders(root);
    expect(read.find((x) => x.id === a.id)).toMatchObject({ sensitive: true, retention: { audioDays: 30, meetingMonths: 12 } });
    expect(read.find((x) => x.id === b.id)).not.toHaveProperty('sensitive');
    expect(isSensitiveFolder(read, b.id)).toBe(true);
    expect(JSON.parse(await readFile(join(root, '.rice', 'folders.json'), 'utf8')).folders[0].retention).toEqual({ audioDays: 30, meetingMonths: 12 });
    await setFolderPrivacy(root, a.id, { retention: { audioDays: 15, meetingMonths: 99, lixo: 1 } }); // 15 e 99 não são opções: ignorados
    expect((await readFolders(root)).find((x) => x.id === a.id)!.retention).toBeUndefined();
    await setFolderPrivacy(root, a.id, { retention: { audioDays: 7 }, sensitive: false });
    expect((await readFolders(root)).find((x) => x.id === a.id)).toMatchObject({ retention: { audioDays: 7 } });
    expect((await readFolders(root)).find((x) => x.id === a.id)).not.toHaveProperty('sensitive');
    await setFolderPrivacy(root, a.id, { retention: null });
    expect((await readFolders(root)).find((x) => x.id === a.id)!.retention).toBeUndefined();
    await expect(setFolderPrivacy(root, 'nao-existe', { sensitive: true })).rejects.toThrow();
    expect(parseRetention({ audioDays: 90, meetingMonths: 6 })).toEqual({ audioDays: 90, meetingMonths: 6 });
    expect(parseRetention('lixo')).toBeUndefined();
  });
});
