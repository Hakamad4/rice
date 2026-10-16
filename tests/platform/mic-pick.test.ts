import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alternatives, isVirtual, parseInputs, parseProbes, pickMic, probeable, type MacInput, type MicProbe } from '../../src/main/platform/mic-pick';

const mk = (id: string, over: Partial<MacInput> = {}): MacInput => ({ id, name: id, transport: 'usb', isDefault: false, inUse: false, ...over });
const BUILTIN = mk('builtin', { name: 'Microfone do MacBook Pro', transport: 'builtin', isDefault: true });
const FIFINE = mk('fifine', { name: 'fifine Microphone' });
const AIRPODS = mk('airpods', { name: 'AirPods de Ana', transport: 'bluetooth' });
const TEAMS = mk('teams', { name: 'Microsoft Teams Audio', transport: 'virtual' });
const BLACKHOLE = mk('bh', { name: 'BlackHole 2ch', transport: 'other' });
const voice = (id: string, rmsDb = -30): MicProbe => ({ id, rmsDb, voice: true });
const quiet = (id: string): MicProbe => ({ id, rmsDb: -80, voice: false });

describe('escolha automática do microfone', () => {
  it('uma entrada real em uso por outro processo é a escolhida (in-use); virtuais em uso não contam', async () => {
    const probe = vi.fn(async (_ids: string[]) => [] as MicProbe[]);
    const r = await pickMic({ inputs: [BUILTIN, { ...FIFINE, inUse: true }, { ...TEAMS, inUse: true }], probe });
    expect(r).toMatchObject({ uid: 'fifine', reason: 'in-use', name: 'fifine Microphone', transport: 'usb' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('em uso e já é a padrão: reason in-use sem fixar (continua seguindo o padrão)', async () => {
    const r = await pickMic({ inputs: [{ ...BUILTIN, inUse: true }, FIFINE], probe: async () => [] });
    expect(r).toMatchObject({ uid: undefined, reason: 'in-use' });
  });

  it('ignora BlackHole, Loopback, Zoom, Teams e agregadas pelo nome ou pelo transporte', () => {
    for (const name of ['BlackHole 16ch', 'Loopback Audio', 'ZoomAudioDevice', 'Microsoft Teams Audio', 'Aggregate Device', 'Soundflower (2ch)']) expect(isVirtual(mk('x', { name }))).toBe(true);
    expect(isVirtual(mk('x', { transport: 'aggregate' }))).toBe(true);
    expect(isVirtual(FIFINE)).toBe(false);
    expect(probeable([BUILTIN, TEAMS, BLACKHOLE]).map((i) => i.id)).toEqual(['builtin']);
  });

  it('nenhuma em uso: mede as candidatas e escolhe a com voz (voice)', async () => {
    const probe = vi.fn(async (_ids: string[]) => [quiet('builtin'), voice('fifine')]);
    const r = await pickMic({ inputs: [BUILTIN, FIFINE, TEAMS], probe });
    expect(r).toMatchObject({ uid: 'fifine', reason: 'voice' });
    expect(probe).toHaveBeenCalledWith(['builtin', 'fifine']); // a virtual nunca é medida
  });

  it('várias em uso: mede só as em uso e fica com a de voz mais forte', async () => {
    const probe = vi.fn(async (_ids: string[]) => [voice('builtin', -40), voice('fifine', -22)]);
    const r = await pickMic({ inputs: [{ ...BUILTIN, inUse: true }, { ...FIFINE, inUse: true }, mk('other')], probe });
    expect(probe).toHaveBeenCalledWith(['builtin', 'fifine']);
    expect(r).toMatchObject({ uid: 'fifine', reason: 'voice' });
  });

  it('NUNCA mede Bluetooth que não está em uso (abrir o AirPods derrubaria a call); em uso pode ser medido', async () => {
    const probe = vi.fn(async (_ids: string[]) => [quiet('builtin'), voice('fifine')]);
    await pickMic({ inputs: [BUILTIN, FIFINE, AIRPODS], probe });
    expect(probe.mock.calls[0]![0]).not.toContain('airpods');
    const probe2 = vi.fn(async (_ids: string[]) => [voice('airpods'), quiet('builtin')]);
    const r = await pickMic({ inputs: [BUILTIN, { ...AIRPODS, inUse: true }, { ...FIFINE, inUse: true }], probe: probe2 });
    expect(probe2.mock.calls[0]![0]).toContain('airpods');
    expect(r).toMatchObject({ uid: 'airpods', reason: 'voice' });
  });

  it('inconclusivo (ninguém com voz, sem medidas, uma só candidata) cai no padrão do macOS', async () => {
    expect(await pickMic({ inputs: [BUILTIN, FIFINE], probe: async () => [quiet('builtin'), quiet('fifine')] })).toMatchObject({ uid: undefined, reason: 'default', name: 'Microfone do MacBook Pro' });
    expect(await pickMic({ inputs: [BUILTIN, FIFINE], probe: async () => [] })).toMatchObject({ uid: undefined, reason: 'default' });
    expect(await pickMic({ inputs: [BUILTIN, AIRPODS, TEAMS], probe: vi.fn(async (_ids: string[]) => [voice('builtin')]) })).toMatchObject({ uid: undefined, reason: 'default' });
    expect(await pickMic({ inputs: [], probe: async () => [] })).toMatchObject({ uid: undefined, reason: 'default' });
  });

  it('a medição que trava estoura o orçamento e segue com o padrão (sem atrasar o início)', async () => {
    const t0 = Date.now();
    const r = await pickMic({ inputs: [BUILTIN, FIFINE], probe: () => new Promise<MicProbe[]>(() => {}), budgetMs: 600 });
    expect(r).toMatchObject({ reason: 'default' });
    expect(Date.now() - t0).toBeLessThan(1200);
    const slow = await pickMic({ inputs: [BUILTIN, FIFINE], probe: vi.fn(async (_ids: string[]) => [voice('fifine')]), budgetMs: 300 }); // sobra menos de 400 ms: nem mede
    expect(slow).toMatchObject({ reason: 'default' });
  });

  it('microfone fixo das Configurações vence; automático desligado = padrão', async () => {
    const probe = vi.fn(async (_ids: string[]) => [] as MicProbe[]);
    expect(await pickMic({ inputs: [BUILTIN, FIFINE], fixed: 'fifine', probe })).toMatchObject({ uid: 'fifine', reason: 'fixed' });
    expect(await pickMic({ inputs: [BUILTIN, FIFINE], fixed: 'sumiu', probe: async () => [voice('fifine')] })).toMatchObject({ reason: 'voice' }); // o fixo não está conectado: volta à detecção
    expect(await pickMic({ inputs: [{ ...FIFINE, inUse: true }, BUILTIN], auto: false, probe })).toMatchObject({ uid: undefined, reason: 'default' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('alternativas para o aviso de mudo: reais, medíveis e diferentes da atual', () => {
    expect(alternatives([BUILTIN, FIFINE, AIRPODS, TEAMS], 'builtin').map((i) => i.id)).toEqual(['fifine']);
    expect(alternatives([BUILTIN, { ...AIRPODS, inUse: true }], 'builtin').map((i) => i.id)).toEqual(['airpods']);
  });

  it('lê a resposta do detector e do --probe-inputs, descartando lixo', () => {
    expect(parseInputs({ inputs: [{ id: 'a', name: 'A', transport: 'usb', isDefault: true, inUse: false }, { name: 'sem id' }, 7] })).toEqual([{ id: 'a', name: 'A', transport: 'usb', isDefault: true, inUse: false }]);
    expect(parseInputs(null)).toEqual([]);
    expect(parseProbes('{"levels":[{"id":"a","rmsDb":-30.5,"voice":true},{"id":"b","error":"not-found"},{"x":1}]}\n')).toEqual([{ id: 'a', rmsDb: -30.5, voice: true }, { id: 'b', error: 'not-found' }]);
    expect(parseProbes('lixo')).toEqual([]);
  });
});

describe('limpeza após a escolha', () => {
  it('o relógio do orçamento é cancelado quando a medição responde (nada pendurado)', async () => {
    const before = (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    for (let i = 0; i < 50; i++) await pickMic({ inputs: [BUILTIN, FIFINE], probe: async () => [voice('fifine')] });
    const after = (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    expect(after - before).toBeLessThanOrEqual(0);
  });

  it('--probe-inputs que trava é morto no prazo (sem processo órfão) e devolve vazio', async () => {
    const { probeInputs } = await import('../../src/main/platform/mic-pick');
    const t0 = Date.now();
    expect(await probeInputs(resolve(__dirname, '../fixtures/fake-probe-hang.mjs'), ['a', 'b'], 100)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});
