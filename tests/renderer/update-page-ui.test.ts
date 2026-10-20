// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const NOW = new Date(2026, 9, 15, 16, 0);
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
// a tela escreve "hoje"/"ontem" pelo relógio de verdade: o Date fica parado em NOW (só o Date; os timers seguem reais para o waitFor)
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
afterEach(() => vi.useRealTimers());
const NEW = { enabled: true, available: true, from: 'a1b2c3d', to: 'e4f5a6b', fromClone: true, dismissed: false };
const NONE = { enabled: true, available: false, fromClone: true };
const ABOUT = { version: '0.5.1', commit: 'abc1234', commitFull: 'abc1234def5678abc1234def5678abc1234def5', appPath: '/Applications/Rice.app' };
const WIN = (patch: Record<string, unknown> = {}) => ({ supported: true, phase: 'idle', ...patch });

function boot(over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}, lang = 'pt-BR') {
  return bootRenderer({
    uiLanguage: lang,
    platform: 'darwin',
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, checkUpdates: true, ...settings }),
    updateStatus: vi.fn(async () => NONE),
    updateAbout: async () => ABOUT,
    updateLastCheck: async () => at(15, 9, 41),
    updateRun: vi.fn(async () => ({ ok: true })),
    updateCheckNow: vi.fn(async () => ({ phase: 'latest', lastCheckAt: at(15, 16, 0) })),
    setCheckUpdates: vi.fn(async (on: boolean) => ({ ...NONE, enabled: on })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...over,
  }, []);
}
const openUpdates = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Atualizações|Updates/.test(b.textContent)).click();
  await vi.waitFor(() => expect(g.document.querySelector('.upd-card')).not.toBeNull());
};
const $ = (sel: string) => g.document.querySelector(sel) as any;
const btn = () => $('.upd-act button');
const badge = () => $('.upd-badge').textContent;

it('cartão: "Rice 0.5.1", commit curto, selo "Atualizado", ação secundária e a última verificação', async () => {
  boot();
  await openUpdates();
  await vi.waitFor(() => expect($('.upd-title-text').textContent).toBe('Rice 0.5.1'));
  expect($('.upd-sub').textContent).toBe('commit abc1234');
  expect(badge()).toBe('Atualizado');
  expect(btn().textContent).toBe('Buscar atualização');
  expect(btn().className).toContain('ghost'); // o mesmo estilo dos outros secundários (com contorno)
  expect($('.upd-last').textContent).toBe('Última verificação: hoje às 09:41');
  expect($('#set-updates').textContent).not.toContain('Próxima'); // o app consulta a cada 6 h, no máx. 1x/dia: nada de "próxima"
});

it('versão nova (Mac): selo, "Atualizar agora" primário e a frase sem jargão; o Terminal fica nos detalhes', async () => {
  const t = boot({ updateStatus: async () => NEW });
  await openUpdates();
  await vi.waitFor(() => expect(badge()).toBe('Nova versão disponível'));
  expect(btn().textContent).toBe('Atualizar agora');
  expect(btn().className).toContain('primary');
  expect($('.upd-sub').textContent).toBe('commit a1b2c3d → e4f5a6b');
  expect($('.upd-help').textContent).toBe('O Rice fecha, atualiza e abre de novo em alguns minutos. Não funciona durante uma gravação.');
  expect($('.upd-card').textContent).not.toContain('update.sh');
  expect($('.upd-fold').textContent).toContain('./update.sh');
  btn().click();
  expect(t.rice.updateRun).toHaveBeenCalledTimes(1);
  expect(g.document.getElementById('settings-link').classList.contains('has-update')).toBe(true); // o pontinho continua
});

it('cópia que não veio de clone: "Baixar no GitHub"', async () => {
  boot({ updateStatus: async () => ({ ...NEW, fromClone: false }) });
  await openUpdates();
  await vi.waitFor(() => expect(btn().textContent).toBe('Baixar no GitHub'));
  expect($('.upd-card').textContent).not.toContain('update.sh');
});

it('busca manual: "Verificando…" no selo e no botão, depois "Atualizado"; cliques repetidos ignorados; esfria 10 s', async () => {
  let done!: (v: unknown) => void;
  const t = boot({ updateCheckNow: vi.fn(() => new Promise((r) => (done = r))) });
  await openUpdates();
  await vi.waitFor(() => expect($('.upd-last').textContent).toContain('09:41'));
  btn().click();
  expect(btn().disabled).toBe(true);
  expect(btn().textContent).toBe('Procurando…');
  expect(badge()).toBe('Verificando…');
  btn().click();
  expect(t.rice.updateCheckNow).toHaveBeenCalledTimes(1);
  done({ phase: 'latest', lastCheckAt: at(15, 16, 0) });
  await vi.waitFor(() => expect(badge()).toBe('Atualizado'));
  expect($('.upd-last').textContent).toBe('Última verificação: hoje às 16:00');
  expect(btn().disabled).toBe(true);
});

it('busca manual com novidade: o selo muda e a ação vira "Atualizar agora"', async () => {
  boot({ updateCheckNow: vi.fn(async () => ({ phase: 'available', newVersion: 'e4f5a6b', status: NEW, lastCheckAt: at(15, 16, 0) })) });
  await openUpdates();
  btn().click();
  await vi.waitFor(() => expect(badge()).toBe('Nova versão disponível'));
  expect(btn().textContent).toBe('Atualizar agora');
});

it('erro de rede: selo "Sem conexão" e a mensagem clara; o botão volta depois dos 10 s', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    boot({ updateCheckNow: vi.fn(async () => ({ phase: 'error', error: 'network' })) });
    await openUpdates();
    btn().click();
    await vi.waitFor(() => expect(badge()).toBe('Sem conexão'));
    expect($('.upd-help').textContent).toBe('Sem conexão com o GitHub, tente de novo');
    vi.advanceTimersByTime(10_000);
    expect(btn().disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('Modo 100% local: selo "Modo 100% local", botão desabilitado com o motivo, sem chamar o main', async () => {
  const t = boot({}, { fullyLocal: true });
  await openUpdates();
  expect(badge()).toBe('Modo 100% local');
  expect(btn().disabled).toBe(true);
  expect(btn().title).toBe('Modo 100% local: a verificação de atualizações está desligada.');
  btn().click();
  expect(t.rice.updateCheckNow).not.toHaveBeenCalled();
});

it('linha da opção no padrão das outras telas (.set-row com interruptor) e a descrição pedida; automático desligado: o botão funciona', async () => {
  const t = boot({}, { checkUpdates: false });
  await openUpdates();
  const row = $('#set-updates .set-row');
  expect(row.querySelector('.set-label').textContent).toBe('Procurar atualizações automaticamente');
  expect(row.querySelector('.set-help').textContent).toBe('Consulta o GitHub no máximo uma vez por dia. Nada sobre você ou suas reuniões é enviado.');
  const sw = row.querySelector('input.switch');
  expect(sw.checked).toBe(false);
  expect(btn().disabled).toBe(false);
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change'));
  await vi.waitFor(() => expect(t.rice.setCheckUpdates).toHaveBeenCalledWith(true));
});

it('detalhes técnicos fechados por padrão: caminho em uma linha com tooltip e commit completo', async () => {
  boot({ updateAbout: async () => ({ ...ABOUT, appPath: '/Users/ana/projects/rice/node_modules/electron/dist/Electron.app' }) });
  await openUpdates();
  const fold = $('.upd-fold');
  expect(fold.open).toBe(false);
  await vi.waitFor(() => expect($('.upd-path').title).toContain('Electron.app'));
  expect($('.upd-path').textContent).toContain('…');
  expect($('.upd-path').textContent.length).toBeLessThanOrEqual(52);
  expect($('.upd-mono').textContent).toBe(ABOUT.commitFull);
  expect(fold.querySelector('summary').textContent).toBe('Detalhes técnicos');
});

it('em inglês: textos traduzidos', async () => {
  boot({ updateStatus: async () => NEW }, {}, 'en');
  await openUpdates();
  await vi.waitFor(() => expect(badge()).toBe('New version available'));
  expect(btn().textContent).toBe('Update now');
  expect($('.upd-last').textContent).toBe('Last check: today at 09:41 AM');
  expect($('.upd-fold summary').textContent).toBe('Technical details');
  expect($('#set-updates h2').textContent).toBe('Updates');
});

it('texto vindo do main nunca vira HTML', async () => {
  boot({ updateStatus: async () => ({ ...NEW, from: '<img src=x>' }), updateAbout: async () => ({ ...ABOUT, version: '<b>1</b>', appPath: '<img src=x>' }) });
  await openUpdates();
  await vi.waitFor(() => expect($('.upd-path').textContent).toBe('<img src=x>'));
  expect($('#set-updates img')).toBeNull();
  expect(badge()).toBe('Atualizado'); // sha malformado: sem aviso
});

it('Windows: a mesma estrutura com "Baixar e instalar" › progresso › "Reiniciar e instalar"', async () => {
  const calls = { download: vi.fn(async () => WIN({ phase: 'downloaded', version: '0.5.2' })), install: vi.fn(async () => ({ ok: true })) };
  const t = boot({ platform: 'win32', winUpdateStatus: async () => WIN({ phase: 'available', version: '0.5.2' }), winUpdateDownload: calls.download, winUpdateInstall: calls.install });
  await openUpdates();
  await vi.waitFor(() => expect(badge()).toBe('Nova versão disponível'));
  expect($('.upd-sub').textContent).toBe('Nova versão 0.5.2 disponível');
  expect(btn().textContent).toBe('Baixar e instalar');
  btn().click();
  expect(calls.download).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(btn().textContent).toBe('Reiniciar e instalar'));
  expect(badge()).toBe('Pronta para instalar');
  t.handlers['winupdate:changed']!(WIN({ phase: 'downloading', version: '0.5.2', percent: 42 }));
  await vi.waitFor(() => expect(badge()).toBe('Baixando 42%'));
  expect($('.upd-bar').value).toBe(42);
  expect(btn()).toBeNull();
  t.handlers['winupdate:changed']!(WIN({ phase: 'downloaded', version: '0.5.2', waitingForRecording: true }));
  await vi.waitFor(() => expect($('.upd-help').textContent).toContain('assim que ela acabar'));
  btn().click();
  expect(calls.install).toHaveBeenCalledTimes(1);
  expect($('.upd-fold').textContent).toContain('Releases do GitHub'); // o "como funciona" do Windows
});

it('Windows: ponto em Configurações com versão pronta e sem suporte o cartão cai no estado do commit', async () => {
  const t = boot({ platform: 'win32', winUpdateStatus: async () => WIN({ phase: 'downloaded', version: '0.5.2' }) });
  const link = g.document.getElementById('settings-link');
  await vi.waitFor(() => expect(link.classList.contains('has-update')).toBe(true));
  t.handlers['winupdate:changed']!(WIN());
  expect(link.classList.contains('has-update')).toBe(false);
});

it('pura: o selo e a ação de cada estado', () => {
  boot();
  const view = g.window.RiceUpdatePage.view;
  expect(view({ status: NONE, lastCheckAt: 'x' })).toMatchObject({ kind: 'latest', action: { id: 'check' } });
  expect(view({ status: NONE })).toMatchObject({ kind: 'unknown' });
  expect(view({ status: NONE, busy: true })).toMatchObject({ kind: 'checking' });
  expect(view({ status: NONE, local: true })).toMatchObject({ kind: 'local', action: { disabled: true } });
  expect(view({ status: NEW })).toMatchObject({ kind: 'available', action: { id: 'run', primary: true } });
  expect(view({ status: NONE, result: { phase: 'error', error: 'other', message: 'x' }, lastCheckAt: 'x' })).toMatchObject({ kind: 'failed' });
});

it('versão nova mostra "Última verificação: …"; sem a hora, a linha some (nunca "Ainda não verificou")', async () => {
  boot({ updateStatus: async () => NEW });
  await openUpdates();
  await vi.waitFor(() => expect(badge()).toBe('Nova versão disponível'));
  await vi.waitFor(() => expect($('.upd-last').textContent).toBe('Última verificação: hoje às 09:41'));
  boot({ updateStatus: async () => NEW, updateLastCheck: async () => null });
  await openUpdates();
  await vi.waitFor(() => expect(badge()).toBe('Nova versão disponível'));
  expect($('.upd-last').hidden).toBe(true);
  expect($('.upd-card').textContent).not.toContain('Ainda não verificou');
  // sem versão nova e sem nenhuma consulta: aí sim
  boot({ updateLastCheck: async () => null });
  await openUpdates();
  await vi.waitFor(() => expect($('.upd-last').textContent).toBe('Ainda não verificou'));
});
