// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const NEW = { enabled: true, available: true, from: 'a1b2c3d', to: 'e4f5a6b', fromClone: true };

function boot(status: Record<string, unknown>, extra: Record<string, unknown> = {}, lang: 'pt-BR' | 'en' = 'pt-BR') {
  const out = bootRenderer({
    uiLanguage: lang,
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, checkUpdates: true }),
    updateStatus: vi.fn(async () => status),
    updateRun: vi.fn(async () => ({ ok: true, mode: 'terminal' })),
    setCheckUpdates: vi.fn(async (on: boolean) => ({ ...status, enabled: on, available: on && status.available })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  }, []);
  return out;
}
const openUpdates = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Atualizações|Updates/.test(b.textContent)).click();
};
const notice = () => g.document.querySelector('.update-notice') as any;

it('versão nova: ponto discreto em Configurações e o aviso com "Atualizar" em Configurações › Atualizações', async () => {
  const { rice } = boot(NEW);
  const link = g.document.getElementById('settings-link');
  await vi.waitFor(() => expect(link.classList.contains('has-update')).toBe(true));
  expect(link.title).toBe('Nova versão disponível');
  await openUpdates();
  await vi.waitFor(() => expect(notice().hidden).toBe(false));
  expect(notice().querySelector('.update-text').textContent).toBe('Nova versão disponível (a1b2c3d → e4f5a6b)');
  const btn = notice().querySelector('button');
  expect(btn.textContent).toBe('Atualizar');
  expect(notice().textContent).toContain('./update.sh');
  btn.click();
  expect(rice.updateRun).toHaveBeenCalledTimes(1);
  // a opção, ligada por padrão, com a explicação pedida
  const sw = g.document.getElementById('check-updates');
  expect(sw.checked).toBe(true);
  expect(g.document.querySelector('#set-updates').textContent).toContain('Uma vez por dia o Rice consulta o GitHub para ver se há versão nova. Nada sobre você ou suas reuniões é enviado.');
});

it('em inglês: textos traduzidos', async () => {
  boot(NEW, {}, 'en');
  await openUpdates();
  await vi.waitFor(() => expect(notice().hidden).toBe(false));
  expect(notice().querySelector('.update-text').textContent).toBe('New version available (a1b2c3d → e4f5a6b)');
  expect(notice().querySelector('button').textContent).toBe('Update');
  expect(g.document.querySelector('#set-updates h2').textContent).toBe('Updates');
  expect(g.document.querySelector('#set-updates').textContent).toContain('Once a day Rice asks GitHub whether there is a new version. Nothing about you or your meetings is sent.');
});

it('app que não veio de um clone: "Baixar no GitHub" em vez de "Atualizar"', async () => {
  boot({ ...NEW, fromClone: false });
  await openUpdates();
  await vi.waitFor(() => expect(notice().hidden).toBe(false));
  expect(notice().querySelector('button').textContent).toBe('Baixar no GitHub');
  expect(notice().textContent).not.toContain('./update.sh');
});

it('sem versão nova: nenhum ponto nem aviso; desligar a opção chama o main e some com o aviso', async () => {
  const none = boot({ enabled: true, available: false, fromClone: true });
  await vi.waitFor(() => expect(none.rice.updateStatus).toHaveBeenCalled());
  expect(g.document.getElementById('settings-link').classList.contains('has-update')).toBe(false);
  await openUpdates();
  expect(notice().hidden).toBe(true);

  const t = boot(NEW);
  await openUpdates();
  await vi.waitFor(() => expect(notice().hidden).toBe(false));
  const sw = g.document.getElementById('check-updates');
  sw.checked = false;
  sw.dispatchEvent(new g.window.Event('change'));
  await vi.waitFor(() => expect(t.rice.setCheckUpdates).toHaveBeenCalledWith(false));
  await vi.waitFor(() => expect(notice().hidden).toBe(true));
  await vi.waitFor(() => expect(g.document.getElementById('settings-link').classList.contains('has-update')).toBe(false));
});

it('o aviso chega ao vivo pelo evento do main', async () => {
  const t = boot({ enabled: true, available: false, fromClone: true });
  await vi.waitFor(() => expect(t.rice.updateStatus).toHaveBeenCalled());
  t.handlers['update:changed']!(NEW);
  expect(g.document.getElementById('settings-link').classList.contains('has-update')).toBe(true);
});

it('sha malformado vindo do main não vira texto no aviso', async () => {
  boot({ ...NEW, from: '<img src=x>', to: 'e4f5a6b' });
  await openUpdates();
  await vi.waitFor(() => expect(g.document.querySelector('.setting-section')).not.toBeNull());
  expect(notice().hidden).toBe(true);
  expect(g.document.querySelector('#set-updates img')).toBeNull();
});

it('Configurações › Atualizações mostra qual cópia está aberta: versão, commit e caminho do app (pt e en, com e sem commit)', async () => {
  boot({ enabled: true, available: false, fromClone: true }, { updateAbout: vi.fn(async () => ({ version: '0.4.0', commit: 'abc1234', appPath: '/Applications/Rice.app' })) });
  await openUpdates();
  await vi.waitFor(() => expect(g.document.querySelector('.update-about').textContent).toBe('Versão 0.4.0 · commit abc1234 · /Applications/Rice.app'));
  boot({ enabled: true, available: false, fromClone: true }, { updateAbout: async () => ({ version: '0.4.0', commit: null, appPath: '/Users/x/Downloads/Rice.app' }) }, 'en');
  await openUpdates();
  await vi.waitFor(() => expect(g.document.querySelector('.update-about').textContent).toBe('Version 0.4.0 · /Users/x/Downloads/Rice.app'));
});

it('o texto da cópia aberta nunca vira HTML', async () => {
  boot({ enabled: true, available: false, fromClone: true }, { updateAbout: async () => ({ version: '<b>1</b>', commit: 'abc1234', appPath: '<img src=x>' }) });
  await openUpdates();
  await vi.waitFor(() => expect(g.document.querySelector('.update-about').textContent).toContain('<img src=x>'));
  expect(g.document.querySelector('.update-about img')).toBeNull();
});
