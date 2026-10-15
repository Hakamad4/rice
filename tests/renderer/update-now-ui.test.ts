// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const NOW = new Date(2026, 9, 15, 16, 0); // 15/10/2026 16:00 (hora local)
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();

function boot(over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}, lang = 'pt-BR') {
  const out = bootRenderer({
    uiLanguage: lang,
    platform: 'darwin',
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, checkUpdates: true, ...settings }),
    updateStatus: async () => ({ enabled: true, available: false, fromClone: true }),
    updateAbout: async () => ({ version: '0.5.0', commit: 'a1b2c3d', appPath: '/Applications/Rice.app' }),
    updateLastCheck: async () => at(15, 14, 32),
    updateCheckNow: vi.fn(async () => ({ phase: 'latest', lastCheckAt: at(15, 16, 0) })),
    setCheckUpdates: vi.fn(async () => ({ enabled: true, available: false, fromClone: true })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...over,
  }, []);
  return out;
}
const openUpdates = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Atualizações|Updates/.test(b.textContent)).click();
  await vi.waitFor(() => expect(g.document.querySelector('.update-now')).not.toBeNull());
};
const btn = () => g.document.querySelector('.update-now button') as any;
const status = () => g.document.querySelector('.update-now-status').textContent;
const line = () => g.document.querySelector('.update-now-line').textContent;

it('textos das datas: hoje, ontem, amanhã e dd de mês, em pt e en', () => {
  boot();
  const U = g.window.RiceUpdateNow;
  const I = g.window.RiceI18n;
  I.setLanguage('pt-BR');
  expect(U.lineText(at(15, 14, 32), true, NOW)).toBe('Última verificação: hoje às 14:32 · Próxima: amanhã (automático, 1x por dia)');
  expect(U.lineText(at(14, 9, 5), true, NOW)).toBe('Última verificação: ontem às 09:05 · Próxima: hoje (automático, 1x por dia)');
  expect(U.lineText(at(10, 18, 0), true, NOW)).toBe('Última verificação: 10 de outubro às 18:00 · Próxima: hoje (automático, 1x por dia)');
  expect(U.lineText(at(15, 14, 32), false, NOW)).toBe('Última verificação: hoje às 14:32 · Verificação automática desligada');
  expect(U.lineText(undefined, true, NOW)).toBe('Ainda não verificou · Próxima: hoje (automático, 1x por dia)');
  I.setLanguage('en');
  expect(U.lineText(at(15, 14, 32), true, NOW)).toBe('Last check: today at 02:32 PM · Next: tomorrow (automatic, once a day)');
  expect(U.lineText(at(10, 18, 0), false, NOW)).toContain('October 10 at');
  expect(U.lineText(at(10, 18, 0), false, NOW)).toContain('Automatic check is off');
  I.setLanguage('pt-BR');
});

it('busca manual sem novidade: "Procurando…" no botão e depois a versão mais recente; datas na linha', async () => {
  let done!: (v: unknown) => void;
  const t = boot({ updateCheckNow: vi.fn(() => new Promise((r) => (done = r))) });
  await openUpdates();
  expect(btn().textContent).toBe('Buscar atualização agora');
  expect(line()).toContain('Última verificação: hoje às 14:32');
  expect(line()).toContain('Próxima: amanhã (automático, 1x por dia)');
  btn().click();
  expect(btn().disabled).toBe(true);
  expect(btn().textContent).toBe('Procurando…');
  expect(status()).toBe('Procurando…');
  btn().click(); // clique repetido enquanto busca: ignorado
  expect(t.rice.updateCheckNow).toHaveBeenCalledTimes(1);
  done({ phase: 'latest', lastCheckAt: at(15, 16, 0) });
  await vi.waitFor(() => expect(status()).toBe('Você está na versão mais recente (0.5.0)'));
  expect(line()).toContain('Última verificação: hoje às 16:00');
  expect(btn().disabled).toBe(true); // esfriando: mínimo 10 s entre buscas
});

it('com versão nova: avisa no próprio bloco', async () => {
  boot({ updateCheckNow: vi.fn(async () => ({ phase: 'available', newVersion: 'e4f5a6b', lastCheckAt: at(15, 16, 0) })) });
  await openUpdates();
  btn().click();
  await vi.waitFor(() => expect(status()).toBe('Há uma versão nova: veja o aviso acima.'));
});

it('erro de rede: mensagem clara e o botão volta depois dos 10 s', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    boot({ updateCheckNow: vi.fn(async () => ({ phase: 'error', error: 'network' })) });
    await openUpdates();
    btn().click();
    await vi.waitFor(() => expect(status()).toBe('Sem conexão com o GitHub, tente de novo'));
    expect(btn().disabled).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(btn().disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('com a verificação automática desligada o botão funciona e a linha avisa; ligar/desligar atualiza a linha', async () => {
  boot({}, { checkUpdates: false });
  await openUpdates();
  expect(btn().disabled).toBe(false);
  expect(line()).toContain('Verificação automática desligada');
  const toggle = g.document.querySelector('#check-updates') as any;
  toggle.checked = true;
  toggle.onchange();
  await vi.waitFor(() => expect(line()).toContain('Próxima: amanhã (automático, 1x por dia)'));
});

it('Modo 100% local: botão desabilitado com o motivo, sem chamar o main', async () => {
  const t = boot({}, { fullyLocal: true });
  await openUpdates();
  expect(btn().disabled).toBe(true);
  expect(btn().title).toBe('Modo 100% local: a verificação de atualizações está desligada.');
  expect(status()).toBe('Modo 100% local: a verificação de atualizações está desligada.');
  expect(line()).toContain('Verificação automática desligada');
  btn().click();
  expect(t.rice.updateCheckNow).not.toHaveBeenCalled();
});

it('Windows: o mesmo bloco aparece e em inglês', async () => {
  boot({ platform: 'win32', winUpdateStatus: async () => ({ supported: true, phase: 'idle' }), winUpdateDownload: vi.fn(), winUpdateInstall: vi.fn() }, {}, 'en');
  await openUpdates();
  expect(btn().textContent).toBe('Check for updates now');
  expect(g.document.querySelector('.win-update').hidden).toBe(true); // ocioso: só o bloco novo
});
