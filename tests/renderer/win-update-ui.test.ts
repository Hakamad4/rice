// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const ST = (patch: Record<string, unknown> = {}) => ({ supported: true, phase: 'idle', ...patch });

function boot(state: Record<string, unknown>, extra: Record<string, unknown> = {}, platform = 'win32') {
  const calls = { check: vi.fn(async () => ST({ phase: 'available', version: '0.5.0' })), download: vi.fn(async () => ST({ phase: 'downloaded', version: '0.5.0' })), install: vi.fn(async () => ({ ok: true })) };
  const out = bootRenderer({
    platform,
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, checkUpdates: true }),
    updateStatus: async () => ({ enabled: true, available: false, fromClone: false }),
    winUpdateStatus: vi.fn(async () => state),
    winUpdateCheck: calls.check,
    winUpdateDownload: calls.download,
    winUpdateInstall: calls.install,
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  }, []);
  return { ...out, calls };
}
const openUpdates = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Atualizações|Updates/.test(b.textContent)).click();
};
const box = () => g.document.querySelector('.win-update') as any;

it('Windows: "Nova versão X disponível" › "Baixar e instalar"; o botão chama o main', async () => {
  const t = boot(ST({ phase: 'available', version: '0.5.0' }));
  await openUpdates();
  await vi.waitFor(() => expect(box().hidden).toBe(false));
  expect(box().querySelector('.update-text').textContent).toBe('Nova versão 0.5.0 disponível');
  expect(g.document.querySelector('.update-notice:not(.win-update)')).toBeNull(); // o aviso do update.sh não aparece no Windows
  const btn = box().querySelector('button');
  expect(btn.textContent).toBe('Baixar e instalar');
  btn.click();
  expect(t.calls.download).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(box().querySelector('button').textContent).toBe('Reiniciar e atualizar'));
});

it('Windows: o download mostra o progresso e depois vem "Reiniciar e atualizar"', async () => {
  const t = boot(ST({ phase: 'downloading', version: '0.5.0', percent: 42 }));
  await openUpdates();
  await vi.waitFor(() => expect(box().querySelector('progress')).not.toBeNull());
  expect(box().querySelector('progress').value).toBe(42);
  expect(box().textContent).toContain('Baixando a versão 0.5.0… 42%');
  expect(box().querySelector('button')).toBeNull();
  t.handlers['winupdate:changed']!(ST({ phase: 'downloaded', version: '0.5.0' }));
  await vi.waitFor(() => expect(box().querySelector('button').textContent).toBe('Reiniciar e atualizar'));
  box().querySelector('button').click();
  expect(t.calls.install).toHaveBeenCalledTimes(1);
});

it('Windows: com gravação em andamento o texto avisa que espera acabar; ponto em Configurações com versão nova', async () => {
  const t = boot(ST({ phase: 'downloaded', version: '0.5.0', waitingForRecording: true }));
  const link = g.document.getElementById('settings-link');
  await vi.waitFor(() => expect(link.classList.contains('has-update')).toBe(true));
  await openUpdates();
  await vi.waitFor(() => expect(box().textContent).toContain('assim que ela acabar'));
  t.handlers['winupdate:changed']!(ST());
  expect(link.classList.contains('has-update')).toBe(false);
});

it('Windows sem suporte (opção desligada, Modo 100% local, app não instalado pelo NSIS): nada aparece', async () => {
  boot({ supported: false, phase: 'idle' });
  await openUpdates();
  await vi.waitFor(() => expect(box()).not.toBeNull());
  expect(box().hidden).toBe(true);
  expect(g.document.getElementById('settings-link').classList.contains('has-update')).toBe(false);
});

it('Mac: nada muda (continua o aviso do update.sh; nenhuma chamada de atualização do Windows)', async () => {
  const t = boot(ST({ phase: 'available', version: '0.5.0' }), {}, 'darwin');
  await openUpdates();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  expect(box()).toBeNull();
  expect(g.document.querySelector('.update-notice')).not.toBeNull();
  expect(t.rice.winUpdateStatus).not.toHaveBeenCalled();
});

it('em inglês e com versão malformada do main: o texto nunca vira HTML', async () => {
  boot(ST({ phase: 'available', version: '<img src=x>' }), { uiLanguage: 'en', getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'en', uiLanguage: 'en', keepAudio: true, checkUpdates: true }) });
  await openUpdates();
  await vi.waitFor(() => expect(box().hidden).toBe(false));
  expect(box().querySelector('img')).toBeNull();
  expect(box().querySelector('.update-text').textContent).toBe('New version  available');
});
