import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TranslateSidecar } from '../../src/main/translate/sidecar';

const FAKE = resolve(__dirname, '../fixtures/fake-rice-translate.mjs');
const make = (env: Record<string, string> = {}, idleMs = 60_000) => {
  Object.assign(process.env, { FAKE_TRANSLATE_DELAY_MS: '', FAKE_TRANSLATE_CRASH_AFTER: '', ...env });
  return new TranslateSidecar({ binary: process.execPath, args: [FAKE], idleMs });
};
let current: TranslateSidecar | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
  delete process.env.FAKE_TRANSLATE_DELAY_MS;
  delete process.env.FAKE_TRANSLATE_CRASH_AFTER;
});

describe('TranslateSidecar', () => {
  it('não sobe o processo até o primeiro pedido (RAM zero)', async () => {
    current = make();
    expect(current.running).toBe(false);
    expect(await current.translate('/m/opus-mt-x', 'olá', '>>por<<')).toBe('>>por<<opus-mt-x(olá)');
    expect(current.running).toBe(true);
  });

  it('casa as respostas pelo id quando há vários pedidos juntos', async () => {
    current = make({ FAKE_TRANSLATE_DELAY_MS: '15' });
    const all = await Promise.all(['a', 'b', 'c'].map((t) => current!.translate('/m/x', t)));
    expect(all).toEqual(['x(a)', 'x(b)', 'x(c)']);
  });

  it('erro do processo vira rejeição só daquele pedido', async () => {
    current = make();
    await expect(current.translate('/m/broken', 'oi')).rejects.toThrow('incomplete model folder');
    expect(await current.translate('/m/ok', 'oi')).toBe('ok(oi)');
  });

  it('AbortSignal rejeita com AbortError e o processo segue útil', async () => {
    current = make({ FAKE_TRANSLATE_DELAY_MS: '40' });
    const controller = new AbortController();
    const p = current.translate('/m/x', 'lento', '', controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await expect(current.translate('/m/x', 'depois', '', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(await current.translate('/m/x', 'ok')).toBe('x(ok)');
  });

  it('processo que cai derruba os pedidos pendentes e o próximo pedido sobe outro', async () => {
    current = make({ FAKE_TRANSLATE_CRASH_AFTER: '1' });
    expect(await current.translate('/m/x', 'um')).toBe('x(um)'); // responde e cai logo depois
    await new Promise((r) => setTimeout(r, 150));
    expect(current.running).toBe(false);
    expect(await current.translate('/m/x', 'dois')).toBe('x(dois)');
  });

  it('sai sozinho depois do tempo ocioso (RAM volta a zero)', async () => {
    current = make({}, 80);
    await current.translate('/m/x', 'oi');
    expect(current.running).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(current.running).toBe(false);
  });

  it('binário que não existe falha com mensagem, sem travar', async () => {
    const s = new TranslateSidecar({ binary: '/nao/existe/rice-translate', startTimeoutMs: 2000 });
    await expect(s.translate('/m/x', 'oi')).rejects.toThrow();
    expect(s.running).toBe(false);
  });
});
