// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const URL_SECRET = 'https://calendar.example.com/ical/SECRET-TOKEN/basic.ics';

function boot(ics: Record<string, unknown>, extra: Record<string, unknown> = {}, access = 'unsupported') {
  return bootRenderer({
    platform: access === 'unsupported' ? 'win32' : 'darwin',
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true }),
    eventKitStatus: async () => ({ access }),
    googleStatus: async () => ({ connected: false, hasClient: false }),
    icsStatus: vi.fn(async () => ics),
    icsSave: vi.fn(async () => ({ ok: true, count: 3 })),
    icsRemove: vi.fn(async () => ({ ok: true })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  }, []);
}
const openAgenda = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Agenda|Calendar/.test(b.textContent)).click();
  await vi.waitFor(() => expect(g.document.querySelector('.ai-card[data-option=ics]')).not.toBeNull());
};
const card = () => g.document.querySelector('.ai-card[data-option=ics]') as any;
const click = (el: any) => el.dispatchEvent(new g.window.MouseEvent('click', { bubbles: true }));

it('Windows (sem Calendário do sistema): "Assinar por link (ICS)" vem aberto, com os passos do Outlook e do Google', async () => {
  boot({ configured: false, count: 0 });
  await openAgenda();
  expect(card().classList.contains('open')).toBe(true);
  expect(card().querySelector('strong').textContent).toBe('Assinar por link (ICS)');
  expect(card().textContent).toContain('Publicar um calendário');
  expect(card().textContent).toContain('Endereço secreto no formato iCal');
  expect(g.document.querySelector('.ai-card[data-option=macos]')).toBeNull();
  const field = card().querySelector('#ics-url');
  expect(field.type).toBe('password'); // o link é segredo: não fica à mostra
});

it('assinar: envia o link ao main, limpa o campo e atualiza o status com o domínio (nunca o link)', async () => {
  const icsSave = vi.fn(async () => ({ ok: true, count: 3 }));
  const t = boot({ configured: false, count: 0 }, { icsSave });
  await openAgenda();
  const field = card().querySelector('#ics-url');
  field.value = URL_SECRET;
  t.rice.icsStatus = vi.fn(async () => ({ configured: true, host: 'calendar.example.com', count: 3 }));
  click([...card().querySelectorAll('button')].find((b: any) => b.textContent === 'Assinar'));
  await vi.waitFor(() => expect(icsSave).toHaveBeenCalledWith(URL_SECRET));
  await vi.waitFor(() => expect(card().textContent).toContain('Assinado: calendar.example.com — 3 eventos'));
  expect(g.document.body.innerHTML).not.toContain('SECRET-TOKEN');
});

it('link inválido: mostra a mensagem do main, mantém o botão ativo e não deixa o link no campo', async () => {
  const icsSave = vi.fn(async () => ({ ok: false, message: 'Use um link https://' }));
  boot({ configured: false, count: 0 }, { icsSave });
  await openAgenda();
  card().querySelector('#ics-url').value = 'http://x.example.com/a.ics';
  const btn = [...card().querySelectorAll('button')].find((b: any) => b.textContent === 'Assinar');
  click(btn);
  await vi.waitFor(() => expect(card().querySelector('#ics-feedback').textContent).toBe('Use um link https://'));
  expect(card().querySelector('#ics-url').value).toBe('');
  expect(btn.disabled).toBe(false);
});

it('campo vazio não chama o main', async () => {
  const t = boot({ configured: false, count: 0 });
  await openAgenda();
  click([...card().querySelectorAll('button')].find((b: any) => b.textContent === 'Assinar'));
  expect(card().querySelector('#ics-feedback').textContent).toBe('Cole o link do calendário.');
  expect(t.rice.icsSave).not.toHaveBeenCalled();
});

it('assinado: mostra "Remover" e o erro da última leitura; remover chama o main', async () => {
  const t = boot({ configured: true, host: 'outlook.office365.com', count: 0, error: 'O servidor respondeu 404.' });
  await openAgenda();
  expect(card().textContent).toContain('Não foi possível ler outlook.office365.com: O servidor respondeu 404.');
  const remove = [...card().querySelectorAll('button')].find((b: any) => b.textContent === 'Remover');
  expect(remove.hidden).toBe(false);
  click(remove);
  await vi.waitFor(() => expect(t.rice.icsRemove).toHaveBeenCalledTimes(1));
});

it('Modo 100% local: o botão fica desabilitado, com o motivo escrito', async () => {
  boot({ configured: false, count: 0, blocked: 'Modo 100% local: a leitura da agenda por link está desligada.' });
  await openAgenda();
  const btn = [...card().querySelectorAll('button')].find((b: any) => b.textContent === 'Assinar');
  expect(btn.disabled).toBe(true);
  expect(card().textContent).toContain('a leitura da agenda por link está desligada');
});

it('Mac: o link ICS também existe, depois do Calendário do macOS (que continua o recomendado e aberto)', async () => {
  boot({ configured: false, count: 0 }, {}, 'granted');
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Agenda|Calendar/.test(b.textContent)).click();
  await vi.waitFor(() => expect(g.document.querySelector('.ai-card[data-option=macos]')).not.toBeNull());
  expect(g.document.querySelector('.ai-card[data-option=macos]').classList.contains('open')).toBe(true);
  expect([...g.document.querySelectorAll('.cal-box .ai-card')].map((c: any) => c.dataset.option)).toEqual(['macos', 'ics', 'google']);
});

it('em inglês', async () => {
  boot({ configured: true, host: 'calendar.google.com', count: 1 }, { uiLanguage: 'en', getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'en', uiLanguage: 'en', keepAudio: true }) });
  await openAgenda();
  expect(card().querySelector('strong').textContent).toBe('Subscribe by link (ICS)');
  expect(card().textContent).toContain('Subscribed: calendar.google.com — 1 event in the coming days.');
});
