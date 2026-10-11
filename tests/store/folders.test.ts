import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { setLanguage } from '../../src/main/i18n';
import { createFolder, deleteFolder, depthOf, descendantIds, foldersFile, folderPaths, heightOf, moveFolder, readFolders, renameFolder, reorderFolders, setMeetingFolder } from '../../src/main/store/folders';
import { createMeeting, readMeta } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

afterEach(() => setLanguage('pt-BR'));
const at = new Date(2026, 9, 9, 9, 0);

describe('pastas', () => {
  test('sem arquivo: nenhuma pasta; criar grava <raiz>/.rice/folders.json com id, nome, data e ordem', async () => {
    const root = await makeTmpDir();
    expect(await readFolders(root)).toEqual([]);
    const a = await createFolder(root, '  Clientes   2026 ', undefined, () => new Date('2026-10-09T12:00:00Z'));
    const b = await createFolder(root, 'Time');
    expect(a).toMatchObject({ name: 'Clientes 2026', createdAt: '2026-10-09T12:00:00.000Z', order: 0 });
    expect(b.order).toBe(1);
    expect(JSON.parse(await readFile(foldersFile(root), 'utf8'))).toEqual({ folders: [a, b] });
    expect((await readFolders(root)).map((f) => f.name)).toEqual(['Clientes 2026', 'Time']);
  });

  test('nome vazio, longo demais ou repetido (sem diferenciar maiúsculas) dá erro em pt e en', async () => {
    const root = await makeTmpDir();
    await createFolder(root, 'Time');
    await expect(createFolder(root, '   ')).rejects.toThrow('Dê um nome para a pasta.');
    await expect(createFolder(root, 'tIME')).rejects.toThrow('Já existe uma pasta com esse nome.');
    await expect(createFolder(root, 'x'.repeat(61))).rejects.toThrow(/até 60 caracteres/);
    setLanguage('en');
    await expect(createFolder(root, '')).rejects.toThrow('Give the folder a name.');
    await expect(createFolder(root, 'TIME')).rejects.toThrow('A folder with this name already exists.');
    expect(await readFolders(root)).toHaveLength(1);
  });

  test('renomear: mantém id e ordem, aceita o próprio nome com outra caixa e recusa o de outra pasta', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'Time');
    const b = await createFolder(root, 'Clientes');
    expect(await renameFolder(root, a.id, 'TIME')).toMatchObject({ id: a.id, name: 'TIME', order: 0 });
    await expect(renameFolder(root, a.id, 'clientes')).rejects.toThrow('Já existe');
    await expect(renameFolder(root, 'nao-existe', 'X')).rejects.toThrow('Pasta não encontrada.');
    expect((await readFolders(root)).map((f) => f.name)).toEqual(['TIME', b.name]);
  });

  test('reordenar exige a lista completa de ids; ordem inválida não altera nada', async () => {
    const root = await makeTmpDir();
    const [a, b, c] = [await createFolder(root, 'A'), await createFolder(root, 'B'), await createFolder(root, 'C')];
    await reorderFolders(root, [c!.id, a!.id, b!.id]);
    expect((await readFolders(root)).map((f) => f.name)).toEqual(['C', 'A', 'B']);
    await expect(reorderFolders(root, [a!.id, b!.id])).rejects.toThrow('Ordem de pastas inválida.');
    await expect(reorderFolders(root, [a!.id, a!.id, b!.id])).rejects.toThrow('inválida');
    await expect(reorderFolders(root, [a!.id, b!.id, 'x'])).rejects.toThrow('inválida');
    expect((await readFolders(root)).map((f) => f.name)).toEqual(['C', 'A', 'B']);
  });

  test('apagar desagrupa: as reuniões voltam para "sem pasta" e as outras ficam como estão', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'A');
    const b = await createFolder(root, 'B');
    const m1 = await createMeeting(root, { title: 'um', startedAt: at, trigger: 'manual', folderId: a.id });
    const m2 = await createMeeting(root, { title: 'dois', startedAt: at, trigger: 'manual', folderId: b.id });
    const m3 = await createMeeting(root, { title: 'tres', startedAt: at, trigger: 'manual' });
    await deleteFolder(root, a.id);
    expect((await readFolders(root)).map((f) => f.id)).toEqual([b.id]);
    expect((await readMeta(m1.dir)).folderId).toBeUndefined();
    expect((await readMeta(m2.dir)).folderId).toBe(b.id);
    expect((await readMeta(m3.dir)).folderId).toBeUndefined();
    await expect(deleteFolder(root, a.id)).rejects.toThrow('Pasta não encontrada.');
  });

  test('escrita concorrente: 12 criações e renomeações ao mesmo tempo não perdem nenhuma', async () => {
    const root = await makeTmpDir();
    const created = await Promise.all(Array.from({ length: 12 }, (_, i) => createFolder(root, `Pasta ${i}`)));
    expect(new Set(created.map((f) => f.order)).size).toBe(12);
    await Promise.all(created.map((f, i) => renameFolder(root, f.id, `Nova ${i}`)));
    const list = await readFolders(root);
    expect(list).toHaveLength(12);
    expect(list.map((f) => f.name).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `Nova ${i}`).sort());
    expect(JSON.parse(await readFile(foldersFile(root), 'utf8')).folders).toHaveLength(12); // arquivo íntegro
  });

  test('arquivo corrompido ou com itens inválidos não derruba a lista', async () => {
    const root = await makeTmpDir();
    await createFolder(root, 'A');
    await writeFile(foldersFile(root), '{ não é json');
    expect(await readFolders(root)).toEqual([]);
    await writeFile(foldersFile(root), JSON.stringify({ folders: [{ id: 'x', name: 'Ok', order: 2 }, { nome: 'sem id' }, 7] }));
    expect((await readFolders(root)).map((f) => f.id)).toEqual(['x']);
  });
});

describe('meetings:set-folder (setMeetingFolder)', () => {
  test('põe e tira da pasta, sem mexer na pasta física da reunião', async () => {
    const root = await makeTmpDir();
    const f = await createFolder(root, 'A');
    const m = await createMeeting(root, { title: 'um', startedAt: at, trigger: 'manual' });
    await setMeetingFolder(root, m.dir, f.id);
    expect((await readMeta(m.dir)).folderId).toBe(f.id);
    expect((await readMeta(m.dir)).title).toBe('um'); // o resto do meta fica
    await setMeetingFolder(root, m.dir, null);
    expect((await readMeta(m.dir)).folderId).toBeUndefined();
    expect(await readFile(join(m.dir, 'meta.json'), 'utf8')).not.toContain('folderId');
  });

  test('valida o dir (fora da raiz, a própria raiz, vazio) e o id (inexistente, tipo errado)', async () => {
    const root = await makeTmpDir();
    const f = await createFolder(root, 'A');
    const m = await createMeeting(root, { title: 'um', startedAt: at, trigger: 'manual' });
    await expect(setMeetingFolder(root, '/etc', f.id)).rejects.toThrow('fora da pasta configurada');
    await expect(setMeetingFolder(root, `${root}/../outro`, f.id)).rejects.toThrow('fora da pasta');
    await expect(setMeetingFolder(root, root, f.id)).rejects.toThrow('fora da pasta');
    await expect(setMeetingFolder(root, '', f.id)).rejects.toThrow('fora da pasta');
    await expect(setMeetingFolder(root, m.dir, 'inexistente')).rejects.toThrow('Pasta não encontrada.');
    await expect(setMeetingFolder(root, m.dir, 42)).rejects.toThrow('Pasta não encontrada.');
    await expect(setMeetingFolder(root, m.dir, undefined)).rejects.toThrow('Pasta não encontrada.');
    expect((await readMeta(m.dir)).folderId).toBeUndefined();
  });

  test('reunião criada já numa pasta nasce com folderId', async () => {
    const root = await makeTmpDir();
    const f = await createFolder(root, 'A');
    const m = await createMeeting(root, { title: 'um', startedAt: at, trigger: 'manual', state: 'draft', folderId: f.id });
    expect(m.meta.folderId).toBe(f.id);
  });
});

describe('pastas dentro de pastas', () => {
  const names = async (root: string) => (await readFolders(root)).map((f) => `${f.name}${f.parentId ? '<' : ''}`);

  test('migração: pastas antigas (sem parentId) são da raiz e o arquivo só ganha parentId quando há pai', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'Clientes');
    expect(a.parentId).toBeUndefined();
    const sub = await createFolder(root, 'Acme', a.id);
    expect(sub.parentId).toBe(a.id);
    const raw = JSON.parse(await readFile(foldersFile(root), 'utf8')).folders;
    expect('parentId' in raw[0]).toBe(false);
    expect(raw[1].parentId).toBe(a.id);
    // arquivo legado escrito à mão, sem nenhum parentId
    await writeFile(foldersFile(root), JSON.stringify({ folders: [{ id: 'x', name: 'Velha', createdAt: '', order: 0 }, { id: 'y', name: 'Outra', createdAt: '', order: 1 }] }));
    expect((await readFolders(root)).map((f) => f.parentId)).toEqual([undefined, undefined]);
  });

  test('arquivo com pai inexistente, ciclo ou nível demais: vira pasta da raiz, nada se perde', async () => {
    const root = await makeTmpDir();
    const f = (id: string, parentId?: string, order = 0) => ({ id, name: id, createdAt: '', order, ...(parentId ? { parentId } : {}) });
    await createFolder(root, 'seed');
    await writeFile(foldersFile(root), JSON.stringify({ folders: [f('orfa', 'sumiu'), f('c1', 'c2'), f('c2', 'c1'), f('n1'), f('n2', 'n1'), f('n3', 'n2'), f('n4', 'n3'), f('n5', 'n4')] }));
    const read = await readFolders(root);
    expect(read).toHaveLength(8);
    const parent = (id: string) => read.find((x) => x.id === id)!.parentId;
    expect(parent('orfa')).toBeUndefined();
    expect([parent('c1'), parent('c2')].filter(Boolean).length).toBeLessThan(2); // o ciclo foi quebrado
    expect(parent('n4')).toBe('n3');
    expect(parent('n5')).toBeUndefined(); // 5º nível
  });

  test('profundidade: até 4 níveis, com erro amigável em pt e en', async () => {
    const root = await makeTmpDir();
    let parent: string | undefined;
    for (const n of ['N1', 'N2', 'N3', 'N4']) parent = (await createFolder(root, n, parent)).id;
    await expect(createFolder(root, 'N5', parent)).rejects.toThrow('As pastas podem ter até 4 níveis.');
    setLanguage('en');
    await expect(createFolder(root, 'N5', parent)).rejects.toThrow('Folders can be nested up to 4 levels deep.');
    expect(await readFolders(root)).toHaveLength(4);
  });

  test('nome único só entre irmãs: o mesmo nome em outro pai é permitido', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'A');
    const b = await createFolder(root, 'B');
    await createFolder(root, 'Acme', a.id);
    await createFolder(root, 'Acme', b.id); // outro pai: ok
    await createFolder(root, 'Acme'); // raiz: ok
    await expect(createFolder(root, 'ACME', a.id)).rejects.toThrow('Já existe');
    const x = await createFolder(root, 'X', a.id);
    await expect(renameFolder(root, x.id, 'acme')).rejects.toThrow('Já existe');
    expect((await renameFolder(root, x.id, 'Y')).name).toBe('Y');
  });

  test('pai que não existe ao criar dá erro', async () => {
    const root = await makeTmpDir();
    await expect(createFolder(root, 'X', 'nope')).rejects.toThrow('Pasta não encontrada.');
  });

  test('mover: para dentro de outra, de volta à raiz, e vai para o fim das novas irmãs', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'A');
    const b = await createFolder(root, 'B');
    const c = await createFolder(root, 'C', b.id);
    const moved = await moveFolder(root, a.id, b.id);
    expect(moved).toMatchObject({ parentId: b.id, order: c.order + 1 });
    expect(await names(root)).toContain('A<');
    expect((await readFolders(root)).filter((f) => f.parentId === b.id).map((f) => f.name)).toEqual(['C', 'A']);
    expect((await moveFolder(root, a.id, null)).parentId).toBeUndefined();
    expect(await moveFolder(root, a.id, null)).toMatchObject({ id: a.id }); // já na raiz: nada muda
    await expect(moveFolder(root, 'nope', null)).rejects.toThrow('Pasta não encontrada.');
    await expect(moveFolder(root, a.id, 'nope')).rejects.toThrow('Pasta não encontrada.');
  });

  test('mover: ciclo (para dentro de si ou de uma descendente) é recusado', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'A');
    const b = await createFolder(root, 'B', a.id);
    const c = await createFolder(root, 'C', b.id);
    await expect(moveFolder(root, a.id, a.id)).rejects.toThrow('dentro dela mesma');
    await expect(moveFolder(root, a.id, c.id)).rejects.toThrow('dentro dela mesma');
    setLanguage('en');
    await expect(moveFolder(root, a.id, b.id)).rejects.toThrow('cannot be moved into itself');
    expect((await readFolders(root)).find((f) => f.id === a.id)!.parentId).toBeUndefined();
  });

  test('mover: respeita o limite contando a subárvore inteira', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'A');
    const a2 = await createFolder(root, 'A2', a.id);
    await createFolder(root, 'A3', a2.id); // A > A2 > A3 (altura 3)
    const x = await createFolder(root, 'X');
    const x2 = await createFolder(root, 'X2', x.id); // X > X2 (profundidade 2)
    await expect(moveFolder(root, a.id, x2.id)).rejects.toThrow('4 níveis'); // 2 + 3 = 5
    await moveFolder(root, a.id, x.id); // 1 + 3 = 4: cabe
    expect((await readFolders(root)).find((f) => f.id === a.id)!.parentId).toBe(x.id);
  });

  test('mover: nome repetido entre as novas irmãs é recusado', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'A');
    await createFolder(root, 'Acme', a.id);
    const loose = await createFolder(root, 'acme');
    await expect(moveFolder(root, loose.id, a.id)).rejects.toThrow('Já existe');
  });

  test('reordenar vale entre irmãs: o conjunto tem que ser exatamente o das irmãs', async () => {
    const root = await makeTmpDir();
    const p = await createFolder(root, 'P');
    const [a, b, c] = [await createFolder(root, 'A', p.id), await createFolder(root, 'B', p.id), await createFolder(root, 'C', p.id)];
    await createFolder(root, 'Solta');
    await reorderFolders(root, [c.id, a.id, b.id]);
    expect((await readFolders(root)).filter((f) => f.parentId === p.id).map((f) => f.name)).toEqual(['C', 'A', 'B']);
    await expect(reorderFolders(root, [a.id, b.id])).rejects.toThrow('inválida');
    const solta = (await readFolders(root)).find((f) => f.name === 'Solta')!;
    await expect(reorderFolders(root, [a.id, solta.id, b.id, c.id])).rejects.toThrow('inválida'); // mistura pais
    expect((await readFolders(root)).find((f) => f.id === p.id)!.order).toBe(0); // a raiz não mexeu
  });

  test('apagar com filhos: subpastas e reuniões sobem para a pasta-mãe; nada é apagado', async () => {
    const root = await makeTmpDir();
    const top = await createFolder(root, 'Clientes');
    const mid = await createFolder(root, 'Acme', top.id);
    const leaf = await createFolder(root, 'Contratos', mid.id);
    const { dir: inMid } = await createMeeting(root, { title: 'No meio', startedAt: at, trigger: 'manual', state: 'draft', folderId: mid.id });
    const { dir: inLeaf } = await createMeeting(root, { title: 'Na folha', startedAt: at, trigger: 'manual', state: 'draft', folderId: leaf.id });
    await deleteFolder(root, mid.id);
    const after = await readFolders(root);
    expect(after.map((f) => f.name)).toEqual(['Clientes', 'Contratos']);
    expect(after.find((f) => f.name === 'Contratos')!.parentId).toBe(top.id);
    expect((await readMeta(inMid)).folderId).toBe(top.id); // subiu
    expect((await readMeta(inLeaf)).folderId).toBe(leaf.id); // a subpasta continua com a dela
  });

  test('apagar pasta da raiz: subpastas viram raiz e as reuniões ficam sem pasta; nome repetido ganha (2)', async () => {
    const root = await makeTmpDir();
    const top = await createFolder(root, 'Clientes');
    await createFolder(root, 'Acme');
    const inner = await createFolder(root, 'Acme', top.id);
    const { dir } = await createMeeting(root, { title: 'R', startedAt: at, trigger: 'manual', state: 'draft', folderId: top.id });
    await deleteFolder(root, top.id);
    const after = await readFolders(root);
    expect(after.map((f) => f.name)).toEqual(['Acme (2)', 'Acme']); // a filha entra no lugar da pasta apagada
    expect(after.every((f) => f.parentId === undefined)).toBe(true);
    expect(after.find((f) => f.id === inner.id)!.name).toBe('Acme (2)');
    expect((await readMeta(dir)).folderId).toBeUndefined();
    expect(new Set(after.map((f) => f.order)).size).toBe(2);
  });

  test('descendantIds, depthOf, heightOf e folderPaths', async () => {
    const root = await makeTmpDir();
    const a = await createFolder(root, 'Clientes');
    const b = await createFolder(root, 'Acme', a.id);
    const c = await createFolder(root, 'Contratos', b.id);
    const all = await readFolders(root);
    expect(descendantIds(all, a.id).sort()).toEqual([b.id, c.id].sort());
    expect(depthOf(all, c.id)).toBe(3);
    expect(heightOf(all, a.id)).toBe(3);
    expect(folderPaths(all).get(c.id)).toBe('Clientes / Acme / Contratos');
  });
});
