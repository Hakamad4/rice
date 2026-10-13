import { describe, expect, test, vi } from 'vitest';
import { createShortcutManager, defaultShortcut, parseShortcut, pickRecordableEvent, resolveShortcut, toggleRecording, type ToggleDeps } from '../../src/main/app/record-shortcut';
import type { CalEvent } from '../../src/main/calendar/google-events';

const NOW = new Date('2026-10-13T12:00:00Z');
const ev = (over: Partial<CalEvent> = {}): CalEvent => ({ id: 'e1', title: 'Sync com a Acme', start: '2026-10-13T12:05:00Z', end: '2026-10-13T12:35:00Z', calendar: 'c', attendees: 3, source: 'google', ...over });

describe('atalho: formato e padrão', () => {
  test('⌥⌘R no Mac, Ctrl+Alt+R no resto', () => {
    expect(defaultShortcut('darwin')).toBe('Alt+Command+R');
    expect(defaultShortcut('win32')).toBe('Control+Alt+R');
    expect(resolveShortcut(undefined, 'darwin')).toBe('Alt+Command+R');
  });

  test('canoniza: ordem fixa, Option/Cmd/CommandOrControl, tecla em maiúscula', () => {
    expect(parseShortcut('cmd+option+r', 'darwin')).toBe('Alt+Command+R');
    expect(parseShortcut('CommandOrControl+Shift+F5', 'darwin')).toBe('Shift+Command+F5');
    expect(parseShortcut('CommandOrControl+Shift+F5', 'win32')).toBe('Control+Shift+F5');
    expect(parseShortcut('Control+Alt+9', 'win32')).toBe('Control+Alt+9');
  });

  test('recusa: sem modificador forte, sem tecla, tecla fora de A-Z/0-9/F1-F24, lixo', () => {
    for (const bad of ['R', 'Shift+R', 'Command', 'Command+Enter', 'Command+F25', 'Alt+Command+RR', 'Hyper+R', '', 42, null, 'x'.repeat(100)]) expect(parseShortcut(bad, 'darwin')).toBeNull();
    expect(resolveShortcut('lixo', 'darwin')).toBe('Alt+Command+R'); // ilegível volta ao padrão
    expect(resolveShortcut('none', 'darwin')).toBeNull();
  });
});

describe('registro, troca, "Nenhum" e conflito', () => {
  function manager(taken: string[] = []) {
    const registered = new Set<string>();
    const onTrigger = vi.fn();
    const register = vi.fn((acc: string, _cb: () => void) => (taken.includes(acc) ? false : (registered.add(acc), true)));
    const unregister = vi.fn((acc: string) => void registered.delete(acc));
    return { m: createShortcutManager({ register, unregister, onTrigger, platform: 'darwin' }), registered, register, unregister, onTrigger };
  }

  test('início: registra o padrão e o atalho dispara o callback', () => {
    const { m, registered, register, onTrigger } = manager();
    expect(m.init(undefined)).toEqual({ accelerator: 'Alt+Command+R', state: 'registered', defaultAccelerator: 'Alt+Command+R' });
    expect([...registered]).toEqual(['Alt+Command+R']);
    register.mock.calls[0]![1]();
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('troca: tira o antigo, registra o novo e devolve o que guardar', () => {
    const { m, registered } = manager();
    m.init(undefined);
    const r = m.change('Control+Alt+G');
    expect(r).toMatchObject({ ok: true, saved: 'Control+Alt+G', status: { accelerator: 'Control+Alt+G', state: 'registered' } });
    expect([...registered]).toEqual(['Control+Alt+G']);
    expect(m.change('default')).toMatchObject({ ok: true, saved: 'Alt+Command+R' });
    expect([...registered]).toEqual(['Alt+Command+R']);
  });

  test('"Nenhum": desregistra e nada dispara; valor guardado "none" liga o app sem atalho', () => {
    const { m, registered, register } = manager();
    m.init(undefined);
    expect(m.change('none')).toMatchObject({ ok: true, saved: 'none', status: { accelerator: null, state: 'none' } });
    expect(registered.size).toBe(0);
    const again = manager();
    expect(again.m.init('none')).toMatchObject({ accelerator: null, state: 'none' });
    expect(again.register).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
  });

  test('conflito no início: não lança, fica sem atalho e o estado diz "conflict" com o atalho pedido', () => {
    const { m, registered } = manager(['Alt+Command+R']);
    expect(m.init(undefined)).toMatchObject({ accelerator: 'Alt+Command+R', state: 'conflict' });
    expect(registered.size).toBe(0);
  });

  test('conflito na troca: o atalho anterior volta a valer e nada é guardado como novo', () => {
    const { m, registered } = manager(['Control+Alt+G']);
    m.init(undefined);
    const r = m.change('Control+Alt+G');
    expect(r.ok).toBe(false);
    expect(r.status).toMatchObject({ accelerator: 'Alt+Command+R', state: 'conflict' });
    expect([...registered]).toEqual(['Alt+Command+R']);
  });

  test('atalho inválido é recusado sem mexer no que está registrado; register que lança vira conflito', () => {
    const { m, registered } = manager();
    m.init(undefined);
    expect(m.change('Shift+R')).toMatchObject({ ok: false, invalid: true });
    expect([...registered]).toEqual(['Alt+Command+R']);
    const throwing = createShortcutManager({ register: () => { throw new Error('recusado'); }, unregister: () => {}, onTrigger: () => {}, platform: 'darwin' });
    expect(throwing.init(undefined).state).toBe('conflict');
  });

  test('dispose desregistra', () => {
    const { m, registered } = manager();
    m.init(undefined);
    m.dispose();
    expect(registered.size).toBe(0);
  });
});

describe('qual reunião da agenda', () => {
  test('acontecendo agora ou começando em até 10 min; fora disso, nenhuma', () => {
    expect(pickRecordableEvent([ev()], NOW)?.id).toBe('e1'); // em 5 min
    expect(pickRecordableEvent([ev({ start: '2026-10-13T11:30:00Z', end: '2026-10-13T12:30:00Z' })], NOW)?.id).toBe('e1'); // acontecendo
    expect(pickRecordableEvent([ev({ start: '2026-10-13T12:11:00Z' })], NOW)).toBeNull(); // daqui a 11 min
    expect(pickRecordableEvent([ev({ start: '2026-10-13T10:00:00Z', end: '2026-10-13T11:00:00Z' })], NOW)).toBeNull(); // já acabou
  });

  test('só reuniões (link ou participantes), nunca dia inteiro; prefere a que começou por último', () => {
    expect(pickRecordableEvent([ev({ attendees: 0 })], NOW)).toBeNull();
    expect(pickRecordableEvent([ev({ attendees: 0, joinUrl: 'https://meet.google.com/x' })], NOW)?.id).toBe('e1');
    expect(pickRecordableEvent([ev({ allDay: true })], NOW)).toBeNull();
    const a = ev({ id: 'a', start: '2026-10-13T11:00:00Z', end: '2026-10-13T13:00:00Z' });
    const b = ev({ id: 'b', start: '2026-10-13T11:50:00Z', end: '2026-10-13T12:30:00Z' });
    const soon = ev({ id: 'c', start: '2026-10-13T12:02:00Z' });
    expect(pickRecordableEvent([a, b, soon], NOW)?.id).toBe('b');
    expect(pickRecordableEvent([soon, ev({ id: 'd', start: '2026-10-13T12:08:00Z' })], NOW)?.id).toBe('c');
  });
});

describe('o atalho: gravar e parar', () => {
  function toggle(state: 'idle' | 'recording' | 'finishing', events: CalEvent[] = []) {
    const calls: string[] = [];
    const deps: ToggleDeps = {
      state: () => state,
      events: () => events,
      now: () => NOW,
      draftFor: vi.fn(async (e: CalEvent) => `/R/draft-${e.id}`),
      defaultTitle: () => 'Reunião',
      start: vi.fn(async () => void calls.push('start')),
      stop: vi.fn(async () => void calls.push('stop')),
      notify: vi.fn((kind: string) => void calls.push(`notify:${kind}`)),
    };
    return { deps, calls };
  }

  test('parado, sem reunião na agenda: começa uma reunião nova e avisa "Gravando"', async () => {
    const { deps, calls } = toggle('idle');
    expect(await toggleRecording(deps)).toBe('started');
    expect(deps.start).toHaveBeenCalledWith({ title: 'Reunião' });
    expect(deps.draftFor).not.toHaveBeenCalled();
    expect(calls).toEqual(['start', 'notify:recording']);
  });

  test('parado, com reunião acontecendo ou em até 10 min: grava na nota do evento', async () => {
    const { deps } = toggle('idle', [ev()]);
    expect(await toggleRecording(deps)).toBe('started');
    expect(deps.draftFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
    expect(deps.start).toHaveBeenCalledWith({ title: 'Sync com a Acme', dir: '/R/draft-e1' });
  });

  test('gravando: para e avisa "Gravação parada"', async () => {
    const { deps, calls } = toggle('recording', [ev()]);
    expect(await toggleRecording(deps)).toBe('stopped');
    expect(calls).toEqual(['stop', 'notify:stopped']);
    expect(deps.start).not.toHaveBeenCalled();
  });

  test('fechando as notas: ignora o atalho (nada começa nem para)', async () => {
    const { deps, calls } = toggle('finishing');
    expect(await toggleRecording(deps)).toBe('ignored');
    expect(calls).toEqual([]);
  });

  test('erro ao começar (ex.: sem permissão do microfone): aviso de erro e nada quebra', async () => {
    const { deps } = toggle('idle');
    (deps.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('sem microfone'));
    expect(await toggleRecording(deps)).toBe('error');
    expect(deps.notify).toHaveBeenCalledWith('error', 'sem microfone');
  });
});
