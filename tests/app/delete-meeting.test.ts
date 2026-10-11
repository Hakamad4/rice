import { expect, test, vi } from 'vitest';
import { canDeleteMeeting, deleteMeetingDir } from '../../src/main/app/delete-meeting';

const root = '/Users/x/Rice';
const dir = `${root}/2026-10-09 0921 - Daily`;

test('move a pasta para a Lixeira (trashItem), nunca apaga direto', async () => {
  const trash = vi.fn(async () => {});
  await deleteMeetingDir({ dir, root, sessionState: 'idle', currentDir: null, trash });
  expect(trash).toHaveBeenCalledWith(dir);
});

test('recusa a reunião que está gravando agora', async () => {
  const trash = vi.fn(async () => {});
  await expect(deleteMeetingDir({ dir, root, sessionState: 'recording', currentDir: dir, trash })).rejects.toThrow('pare a gravação antes de apagar');
  expect(trash).not.toHaveBeenCalled();
});

test('outra reunião pode ser apagada durante uma gravação', async () => {
  const trash = vi.fn(async () => {});
  await deleteMeetingDir({ dir, root, sessionState: 'recording', currentDir: `${root}/outra`, trash });
  expect(trash).toHaveBeenCalledOnce();
});

test.each([['/etc'], [`${root}/../x`], ['/Users/x/Rice2/a'], [root], [''], [`${root}/`]])('recusa fora da raiz ou a própria raiz: %j', async (bad) => {
  const trash = vi.fn(async () => {});
  await expect(deleteMeetingDir({ dir: bad, root, sessionState: 'idle', currentDir: null, trash })).rejects.toThrow();
  expect(trash).not.toHaveBeenCalled();
});

test('canDeleteMeeting: idle libera; ativa recusa a própria e tudo se a pasta ainda é nula', () => {
  expect(canDeleteMeeting({ sessionState: 'idle', currentDir: null, dir })).toBe(true);
  expect(canDeleteMeeting({ sessionState: 'recording', currentDir: null, dir })).toBe(false); // início da gravação
  expect(canDeleteMeeting({ sessionState: 'finishing', currentDir: null, dir })).toBe(false);
  expect(canDeleteMeeting({ sessionState: 'recording', currentDir: dir, dir })).toBe(false);
  expect(canDeleteMeeting({ sessionState: 'finishing', currentDir: `${dir}/`, dir })).toBe(false);
  expect(canDeleteMeeting({ sessionState: 'recording', currentDir: `${root}/outra`, dir })).toBe(true);
});

test('deleteMeetingDir recusa no início da gravação (currentDir nulo)', async () => {
  const trash = vi.fn(async () => {});
  await expect(deleteMeetingDir({ dir, root, sessionState: 'recording', currentDir: null, trash })).rejects.toThrow('pare a gravação antes de apagar');
  expect(trash).not.toHaveBeenCalled();
});
