import { describe, expect, it } from 'vitest';
import { applyMic, cleanInputs, isMicSwitch, normalizeMic, shortMicName } from '../src/main/audio/mic-info';
import { asrChoiceOf, lightFactor, machineProfile } from '../src/main/platform/profile';

const GB = 1024 ** 3;

describe('microfone em uso', () => {
  it('normaliza o evento: nome limpo e curto, id opcional, sem nome = nada para mostrar', () => {
    expect(normalizeMic({ id: '{0.0.1}.abc', name: '  FIFINE K669\u0000  Microphone ', isDefault: true })).toEqual({ id: '{0.0.1}.abc', name: 'FIFINE K669 Microphone', isDefault: true, chosen: false });
    expect(normalizeMic({ name: 'MacBook Pro Microphone', chosen: true })).toEqual({ name: 'MacBook Pro Microphone', isDefault: false, chosen: true });
    expect(normalizeMic({ name: '   ' })).toBeNull();
    expect(normalizeMic(null)).toBeNull();
    expect(normalizeMic({ name: 'x'.repeat(500) })!.name).toHaveLength(120);
  });

  it('nome curto: tira o invólucro "Microphone (…)" do Windows e corta com reticências', () => {
    expect(shortMicName('Microphone (FIFINE K669 Microphone)')).toBe('FIFINE K669 Microphone');
    expect(shortMicName('Microfone (Realtek(R) Audio)')).toBe('Realtek(R) Audio');
    expect(shortMicName('MacBook Pro Microphone')).toBe('MacBook Pro Microphone');
    expect(shortMicName('Microfone do fone de ouvido Bluetooth do José da Silva', 20)).toBe('Microfone do fone d…');
  });

  it('grava na meta o último nome e só as trocas; repetir o mesmo nome não polui', () => {
    const at = (h: number) => `2026-10-14T${h}:00:00-03:00`;
    let meta: { micName?: string; micChanges?: Array<{ at: string; name: string }> } = {};
    meta = applyMic(meta, { name: 'A', isDefault: true, chosen: false }, at(10));
    meta = applyMic(meta, { name: 'A', isDefault: true, chosen: false }, at(11));
    meta = applyMic(meta, { name: 'B', isDefault: false, chosen: true }, at(12));
    expect(meta).toEqual({ micName: 'B', micChanges: [{ at: at(10), name: 'A' }, { at: at(12), name: 'B' }] });
    let many: typeof meta = {};
    for (let i = 0; i < 50; i++) many = applyMic(many, { name: `M${i}`, isDefault: false, chosen: false }, at(10));
    expect(many.micChanges).toHaveLength(30);
    expect(many.micName).toBe('M49');
  });

  it('o aviso "Microfone trocado" só aparece quando já havia um e o nome mudou', () => {
    expect(isMicSwitch(undefined, 'A')).toBe(false);
    expect(isMicSwitch('A', 'A')).toBe(false);
    expect(isMicSwitch('A', 'B')).toBe(true);
  });
});

describe('entradas para o seletor', () => {
  it('limpa os nomes, tira repetidos e itens sem id ou nome (a lista em si vem de platform/mic-input)', () => {
    expect(cleanInputs([{ id: 'a', name: 'FIFINE K669', isDefault: true }, { id: 'b', name: 'Webcam  C920\u0007', isDefault: false }, { id: 'a', name: 'repetido', isDefault: false }, { id: '', name: 'sem id', isDefault: false }, { id: 'c', name: '  ', isDefault: false }])).toEqual([{ id: 'a', name: 'FIFINE K669', isDefault: true }, { id: 'b', name: 'Webcam C920', isDefault: false }]);
  });
});

describe('perfil da máquina (usa o planTranscriber, um só caminho)', () => {
  const hw = (gb: number, cores: number) => ({ totalMemBytes: gb * GB, logicalCores: cores });

  it('Windows: ≤ 8 GiB ou < 6 núcleos → small; ≤ 4 GiB ou < 4 núcleos → base; com folga → o grande', () => {
    expect(machineProfile({ platform: 'win32', ...hw(8, 8) })).toMatchObject({ model: 'light', tier: 'small', modelName: 'ggml-small-q5_1.bin', reason: 'low-ram', light: true, threads: 6 });
    expect(machineProfile({ platform: 'win32', ...hw(16, 4) })).toMatchObject({ tier: 'small', reason: 'low-ram', threads: 2 }); // poucos núcleos
    expect(machineProfile({ platform: 'win32', ...hw(4, 8) })).toMatchObject({ tier: 'base', modelName: 'ggml-base-q5_1.bin', light: true });
    expect(machineProfile({ platform: 'win32', ...hw(16, 3) }).tier).toBe('base');
    expect(machineProfile({ platform: 'win32', ...hw(16, 12) })).toMatchObject({ model: 'full', tier: 'large', reason: 'enough-ram', light: false, ramGb: 16, cores: 12, threads: 6 });
  });

  it('o Mac ignora o modo (sempre o grande) e o usuário pode forçar Leve ou Completo no Windows', () => {
    expect(machineProfile({ platform: 'darwin', ...hw(8, 8) })).toMatchObject({ model: 'full', reason: 'mac', light: false });
    expect(machineProfile({ platform: 'darwin', ...hw(32, 12), choice: 'light' })).toMatchObject({ model: 'full', reason: 'mac' });
    expect(machineProfile({ platform: 'win32', ...hw(8, 8), choice: 'full' })).toMatchObject({ model: 'full', reason: 'forced-full', light: false });
    expect(machineProfile({ platform: 'win32', ...hw(32, 12), choice: 'light' })).toMatchObject({ model: 'light', reason: 'forced-light', light: true });
    expect(machineProfile({ platform: 'win32', ...hw(8, 8), choice: 'large' }).reason).toBe('forced-full'); // nome antigo do modo
    expect(machineProfile({ platform: 'win32', ...hw(8, 8), variantOverride: 'f16' }).reason).toBe('override');
    expect(asrChoiceOf('qualquer coisa')).toBe('auto');
  });

  it('modo leve dobra os intervalos da IA ao vivo', () => {
    expect(lightFactor({ light: true })).toBe(2);
    expect(lightFactor({ light: false })).toBe(1);
  });
});
