// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const AVAILABLE = { enabled: true, available: true, from: 'a1b2c3d', to: 'e4f5a6b', fromClone: true, dismissed: false };
const banner = () => g.document.getElementById('update-banner') as any;

function boot(over: Record<string, unknown> = {}, lang = 'pt-BR') {
  return bootRenderer({
    uiLanguage: lang,
    platform: 'darwin',
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, checkUpdates: true }),
    updateStatus: async () => AVAILABLE,
    updateRun: vi.fn(async () => ({ ok: true })),
    updateDismiss: vi.fn(async () => ({ ...AVAILABLE, dismissed: true })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...over,
  }, []);
}

it('faixa com o texto, "Atualizar agora" (update:run) e "Depois" (esconde)', async () => {
  const t = boot();
  await vi.waitFor(() => expect(banner().hidden).toBe(false));
  expect(banner().querySelector('.update-banner-text').textContent).toBe('Nova versão disponível (a1b2c3d → e4f5a6b)');
  const [now, later] = banner().querySelectorAll('button');
  expect(now.textContent).toBe('Atualizar agora');
  expect(later.textContent).toBe('Depois');
  now.click();
  expect(t.rice.updateRun).toHaveBeenCalledTimes(1);
  later.click();
  expect(t.rice.updateDismiss).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(banner().hidden).toBe(true));
});

it('em inglês', async () => {
  boot({}, 'en');
  await vi.waitFor(() => expect(banner().hidden).toBe(false));
  expect([...banner().querySelectorAll('button')].map((b: any) => b.textContent)).toEqual(['Update now', 'Later']);
});

it('escondida enquanto grava e de volta ao parar', async () => {
  const t = boot();
  await vi.waitFor(() => expect(banner().hidden).toBe(false));
  await t.handlers['session:state']!('recording');
  expect(banner().hidden).toBe(true);
  await t.handlers['session:state']!('idle');
  expect(banner().hidden).toBe(false);
});

it('nada aparece sem versão nova, com "Depois" valendo, e no Windows', async () => {
  boot({ updateStatus: async () => ({ ...AVAILABLE, available: false }) });
  await new Promise((r) => setTimeout(r, 50));
  expect(banner().hidden).toBe(true);
  boot({ updateStatus: async () => ({ ...AVAILABLE, dismissed: true }) });
  await new Promise((r) => setTimeout(r, 50));
  expect(banner().hidden).toBe(true);
  boot({ platform: 'win32', winUpdateStatus: async () => ({ supported: false, phase: 'idle' }) });
  await new Promise((r) => setTimeout(r, 50));
  expect(banner().hidden).toBe(true);
});

it('um status novo do main (update:changed) mostra a faixa', async () => {
  const t = boot({ updateStatus: async () => ({ ...AVAILABLE, available: false }) });
  await new Promise((r) => setTimeout(r, 30));
  expect(banner().hidden).toBe(true);
  t.handlers['update:changed']!(AVAILABLE);
  await vi.waitFor(() => expect(banner().hidden).toBe(false));
});
