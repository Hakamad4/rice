// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
function boot(platform: string, launchAtLogin = false, lang: 'pt-BR' | 'en' = 'pt-BR') {
  return bootRenderer({
    platform,
    uiLanguage: lang,
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, launchAtLogin }),
    setLaunchAtLogin: vi.fn(async (on: boolean) => ({ ok: true, launchAtLogin: on })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
  }, []);
}
const openSettings = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
};
const navNames = () => [...g.document.querySelectorAll('.set-nav-item')].map((b: any) => b.textContent.trim());

it('Windows: seção "Inicialização" com "Iniciar com o Windows", desligada por padrão; ligar chama o main', async () => {
  const t = boot('win32');
  await openSettings();
  expect(navNames()).toContain('Inicialização');
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => b.textContent.trim() === 'Inicialização').click();
  const sw = g.document.getElementById('launch-login');
  expect(sw.checked).toBe(false);
  expect(g.document.querySelector('[data-section=startup]').textContent).toContain('Iniciar com o Windows');
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change'));
  expect(t.rice.setLaunchAtLogin).toHaveBeenCalledWith(true);
});

it('Windows: reflete a opção já ligada; em inglês', async () => {
  boot('win32', true, 'en');
  await openSettings();
  expect(navNames()).toContain('Startup');
  expect(g.document.getElementById('launch-login').checked).toBe(true);
  expect(g.document.querySelector('[data-section=startup]').textContent).toContain('Start with Windows');
});

it('Mac: a seção nem existe', async () => {
  boot('darwin');
  await openSettings();
  expect(navNames()).not.toContain('Inicialização');
  expect(g.document.getElementById('launch-login')).toBeNull();
});
