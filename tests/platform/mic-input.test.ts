import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { applyMicDevice, parseMicDeviceEvent, parseMicInputs } from '../../src/main/platform/mic-input';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/protocol/mic-device.json'), 'utf8')) as { events: Array<Record<string, unknown>>; inputs: unknown[] };

describe('microfone no Windows', () => {
  test('--list-inputs: a fixture do helper vira a lista do app (padrão marcado)', () => {
    const list = parseMicInputs(JSON.stringify({ inputs: fixture.inputs }));
    expect(parseMicInputs(JSON.stringify(fixture.inputs))).toEqual(list); // a lista pura também
    expect(list).toEqual([
      { id: '{0.0.1.00000000}.{aaa}', name: 'Microfone (Realtek)', isDefault: true, state: 'active' },
      { id: '{0.0.1.00000000}.{bbb}', name: 'Microfone (FIFINE K669)', isDefault: false, state: 'active' },
    ]);
  });
  test('lixo, vazio e itens sem id não quebram', () => {
    expect(parseMicInputs('')).toEqual([]);
    expect(parseMicInputs('não é json')).toEqual([]);
    expect(parseMicInputs('{"a":1}')).toEqual([]);
    expect(parseMicInputs('[{"name":"sem id"},7,null,{"id":"x"}]')).toEqual([{ id: 'x', name: 'x', isDefault: false, state: 'active' }]);
  });
  test('o evento mic-device da fixture é lido; outros eventos e o helper sem ele (Mac) são ignorados', () => {
    expect(fixture.events.map((e) => parseMicDeviceEvent(e)?.reason)).toEqual(['open', 'preferred-missing', 'preferred-returned']);
    expect(parseMicDeviceEvent({ event: 'started', mic: true })).toBeNull();
    expect(parseMicDeviceEvent({ event: 'mic-device', id: 5 })).toBeNull();
  });
  test('a escolha vai ao helper por RICE_MIC_DEVICE e some quando volta ao padrão', () => {
    const env: NodeJS.ProcessEnv = {};
    applyMicDevice(env, '{0.0.1.00000000}.{bbb}');
    expect(env.RICE_MIC_DEVICE).toBe('{0.0.1.00000000}.{bbb}');
    applyMicDevice(env, undefined);
    expect('RICE_MIC_DEVICE' in env).toBe(false);
  });
});
