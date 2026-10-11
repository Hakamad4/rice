import { expect, test, vi } from 'vitest';
import { AlertCenter } from '../../src/main/session/alerts';

test('set/clear emitem a lista; o mesmo aviso repetido não gera evento; clearPrefix limpa um grupo', () => {
  const alerts = new AlertCenter();
  const seen = vi.fn();
  alerts.on('change', seen);
  alerts.set({ id: 'storage', level: 'error', message: 'disco cheio' });
  alerts.set({ id: 'storage', level: 'error', message: 'disco cheio' });
  expect(seen).toHaveBeenCalledTimes(1);
  alerts.set({ id: 'storage', level: 'error', message: 'pasta sumiu' }); // troca o texto do mesmo id
  alerts.set({ id: 'source:sys', level: 'warn', message: 'sem áudio do sistema' });
  alerts.set({ id: 'source:mic', level: 'warn', message: 'sem microfone' });
  expect(alerts.list().map((a) => a.message)).toEqual(['pasta sumiu', 'sem áudio do sistema', 'sem microfone']);
  alerts.clearPrefix('source:');
  expect(alerts.list().map((a) => a.id)).toEqual(['storage']);
  alerts.clear('storage');
  alerts.clear('storage');
  expect(alerts.list()).toEqual([]);
  expect(seen).toHaveBeenLastCalledWith([]);
});
