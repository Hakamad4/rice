import { describe, expect, it, vi } from 'vitest';
import { createNubIpc, lastTranscriptLines } from '../../src/main/app/nub-ipc';

function setup(over: { dir?: string | null; fromNub?: boolean; expand?: boolean; ask?: any } = {}) {
  const deps = {
    fromNub: vi.fn(() => over.fromNub ?? true),
    activeDir: vi.fn(() => (over.dir === undefined ? '/R/a' : over.dir)),
    expand: vi.fn(() => over.expand ?? true),
    collapse: vi.fn(),
    context: vi.fn(async () => ({ title: 'Daily', lines: [{ who: 'Eu', text: 'oi' }] })),
    ask: over.ask ?? vi.fn(async (_d: string, _q: string, _s: AbortSignal, onDelta: (t: string) => void) => {
      onDelta('res');
      return { ok: true as const, answer: 'resposta' };
    }),
    sendToNub: vi.fn(),
    notifyMain: vi.fn(),
  };
  return { deps, ipc: createNubIpc<unknown>(deps) };
}

describe('IPC do nub', () => {
  it('recusa tudo quando não há sessão ativa', async () => {
    const { ipc, deps } = setup({ dir: null });
    expect(await ipc.expand({})).toMatchObject({ ok: false, message: expect.stringContaining('Nenhuma gravação') });
    expect(await ipc.ask({}, 'oi?')).toMatchObject({ ok: false });
    expect(deps.expand).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('recusa eventos que não vêm do nub', async () => {
    const { ipc, deps } = setup({ fromNub: false });
    expect(await ipc.expand({})).toEqual({ ok: false, message: 'origem inválida' });
    expect(await ipc.ask({}, 'oi?')).toEqual({ ok: false, message: 'origem inválida' });
    ipc.collapse({});
    ipc.cancel({});
    expect(deps.collapse).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('expand devolve título e linhas; se a pílula não expande, recusa', async () => {
    expect(await setup().ipc.expand({})).toEqual({ ok: true, title: 'Daily', lines: [{ who: 'Eu', text: 'oi' }] });
    expect(await setup({ expand: false }).ipc.expand({})).toMatchObject({ ok: false });
  });

  it('ask usa o dir da sessão (nunca do nub), transmite deltas e avisa o app principal', async () => {
    const { ipc, deps } = setup();
    const result = await ipc.ask({}, '  e as decisões? ');
    expect(result).toEqual({ ok: true, answer: 'resposta' });
    expect(deps.ask).toHaveBeenCalledWith('/R/a', 'e as decisões?', expect.any(AbortSignal), expect.any(Function));
    expect(deps.sendToNub).toHaveBeenCalledWith('nub:delta', 'res');
    expect(deps.notifyMain).toHaveBeenCalledWith({ dir: '/R/a', question: 'e as decisões?', answer: 'resposta' });
  });

  it('pergunta vazia ou não-texto é recusada; falha não avisa o app principal', async () => {
    const { ipc, deps } = setup({ ask: vi.fn(async () => ({ ok: false, message: 'x' })) });
    expect(await ipc.ask({}, '   ')).toMatchObject({ ok: false });
    expect(await ipc.ask({}, { dir: '/etc' })).toMatchObject({ ok: false });
    await ipc.ask({}, 'oi');
    expect(deps.notifyMain).not.toHaveBeenCalled();
  });

  it('cancel aborta a pergunta em andamento; nova pergunta aborta a anterior', async () => {
    const signals: AbortSignal[] = [];
    const ask = vi.fn(async (_d: string, _q: string, signal: AbortSignal) => {
      signals.push(signal);
      await new Promise<void>((r) => signal.addEventListener('abort', () => r())); // só termina ao ser abortada
      return { ok: true as const, answer: 'a' };
    });
    const { ipc } = setup({ ask });
    const first = ipc.ask({}, 'um');
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    ipc.cancel({});
    expect(signals[0]!.aborted).toBe(true);
    await first;
    const second = ipc.ask({}, 'dois');
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    const third = ipc.ask({}, 'tres');
    expect(signals[1]!.aborted).toBe(true);
    await vi.waitFor(() => expect(signals).toHaveLength(3));
    ipc.cancel({});
    await Promise.all([second, third]);
  });
});

it('lastTranscriptLines pega as últimas linhas de fala e ignora marcadores', () => {
  const md = '# T\n\n**[09:00:01] Eu:** um\n\n*[áudio interrompido 09:00–09:01]*\n\n**[09:00:05] Outros:** dois\n\n**[09:00:09] Eu:** três\n';
  expect(lastTranscriptLines(md)).toEqual([{ who: 'Eu', text: 'um' }, { who: 'Outros', text: 'dois' }, { who: 'Eu', text: 'três' }]);
  expect(lastTranscriptLines(md, 2)).toEqual([{ who: 'Outros', text: 'dois' }, { who: 'Eu', text: 'três' }]);
});
