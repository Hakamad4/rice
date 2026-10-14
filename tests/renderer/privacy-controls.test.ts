// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const now = new Date().toISOString();
const FOLDERS = [{ id: 'f1', name: 'Jurídico', createdAt: '', order: 0 }, { id: 'f2', name: 'Contratos', createdAt: '', order: 0, parentId: 'f1', sensitive: true, retention: { audioDays: 30, meetingMonths: 12 } }];
const MEETINGS = [{ dir: '/R/1', title: 'Kickoff', startedAt: now, state: 'done', notesStatus: 'done', folderId: 'f2' }];

function boot(lang: 'pt-BR' | 'en' = 'pt-BR', extra: Record<string, unknown> = {}) {
  const api = {
    uiLanguage: lang,
    listFolders: vi.fn(async () => FOLDERS),
    setFolderPrivacy: vi.fn(async () => ({ ok: true, value: {} })),
    setPrivacy: vi.fn(async () => ({ ok: true })),
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, redactPii: false, retentionDefault: {} }),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  };
  bootRenderer(api, MEETINGS);
  return api;
}
const rowOf = (name: string) => [...g.document.querySelectorAll('.folder-row')].find((r: any) => r.querySelector('.folder-name')?.textContent === name) as any;
const ready = () => vi.waitFor(() => expect(rowOf('Jurídico')).toBeDefined());
const menuItem = (label: string) => [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.trim() === label) as any;

it('⋯ da pasta: "Pasta sensível" (marcada quando a pasta é) liga e desliga; manda só o que mudou', async () => {
  const api = boot();
  await ready();
  rowOf('Jurídico').querySelector('.f-more').click();
  expect(menuItem('Pasta sensível').querySelector('.check svg')).toBeNull(); // desmarcada
  expect(menuItem('Pasta sensível').title).toContain('Oculta dados pessoais');
  menuItem('Pasta sensível').click();
  await vi.waitFor(() => expect(api.setFolderPrivacy).toHaveBeenCalledWith('f1', { sensitive: true }));
  await vi.waitFor(() => expect(rowOf('Contratos')).toBeDefined());
  rowOf('Contratos').querySelector('.f-more').click();
  expect(menuItem('Pasta sensível').querySelector('.check svg')).not.toBeNull(); // marcada
  menuItem('Pasta sensível').click();
  await vi.waitFor(() => expect(api.setFolderPrivacy).toHaveBeenLastCalledWith('f2', { sensitive: false }));
});

const dialog = () => g.document.querySelector('[role=dialog]') as any;
const pick = (index: number, label: string) => {
  [...dialog().querySelectorAll('.menu-select-btn')][index].click();
  [...g.document.querySelectorAll('[role=option]')].find((o: any) => o.textContent.trim() === label).click();
};

it('"Tempo de guarda…": áudio (7, 30, 90 dias) e reunião inteira (6 meses, 1 ano), cada um herdando, "manter sempre" ou com prazo', async () => {
  const api = boot();
  await ready();
  rowOf('Jurídico').querySelector('.f-more').click();
  menuItem('Tempo de guarda…').click();
  expect(dialog().querySelector('.dlg-title').textContent).toBe('Tempo de guarda');
  expect(dialog().textContent).toContain('Pasta: Jurídico');
  expect(dialog().textContent).toContain('nunca é apagado em definitivo');
  const buttons = [...dialog().querySelectorAll('.menu-select-btn')] as any[];
  expect(buttons.map((b) => b.textContent.trim())).toEqual(['Herdar da pasta-mãe ou do padrão', 'Herdar da pasta-mãe ou do padrão']);
  buttons[0].click();
  expect([...g.document.querySelectorAll('[role=option]')].map((o: any) => o.textContent.trim())).toEqual(['Herdar da pasta-mãe ou do padrão', 'Manter sempre', 'Apagar depois de 7 dias', 'Apagar depois de 30 dias', 'Apagar depois de 90 dias']);
  g.document.querySelector('[role=option]').click(); // fecha o menu sem trocar
  [...dialog().querySelectorAll('.menu-select-btn')][1].click();
  expect([...g.document.querySelectorAll('[role=option]')].map((o: any) => o.textContent.trim())).toEqual(['Herdar da pasta-mãe ou do padrão', 'Manter sempre', 'Apagar depois de 6 meses', 'Apagar depois de 1 ano']);
  g.document.querySelector('[role=option]').click();
  pick(0, 'Apagar depois de 30 dias');
  pick(1, 'Apagar depois de 6 meses');
  [...dialog().querySelectorAll('button')].find((b: any) => b.textContent === 'Salvar').click();
  await vi.waitFor(() => expect(api.setFolderPrivacy).toHaveBeenCalledWith('f1', { retention: { audioDays: 30, meetingMonths: 6 } }));
  await vi.waitFor(() => expect(dialog()).toBeNull());
});

it('mostra a regra que a pasta já tem; "Manter sempre" é explícito (0) e tudo herdado volta a null', async () => {
  const api = boot();
  await ready();
  await vi.waitFor(() => expect(rowOf('Contratos')).toBeDefined());
  rowOf('Contratos').querySelector('.f-more').click();
  menuItem('Tempo de guarda…').click();
  expect([...dialog().querySelectorAll('.menu-select-btn')].map((b: any) => b.textContent.trim())).toEqual(['Apagar depois de 30 dias', 'Apagar depois de 1 ano']);
  pick(0, 'Manter sempre');
  pick(1, 'Herdar da pasta-mãe ou do padrão');
  [...dialog().querySelectorAll('button')].find((b: any) => b.textContent === 'Salvar').click();
  await vi.waitFor(() => expect(api.setFolderPrivacy).toHaveBeenCalledWith('f2', { retention: { audioDays: 0 } }));
  await vi.waitFor(() => expect(dialog()).toBeNull());
  rowOf('Contratos').querySelector('.f-more').click();
  menuItem('Tempo de guarda…').click();
  pick(0, 'Herdar da pasta-mãe ou do padrão');
  pick(1, 'Herdar da pasta-mãe ou do padrão');
  [...dialog().querySelectorAll('button')].find((b: any) => b.textContent === 'Salvar').click();
  await vi.waitFor(() => expect(api.setFolderPrivacy).toHaveBeenLastCalledWith('f2', { retention: null }));
});

it('em inglês: textos do menu e do diálogo traduzidos', async () => {
  boot('en');
  await ready();
  rowOf('Jurídico').querySelector('.f-more').click();
  expect(menuItem('Sensitive folder')).toBeDefined();
  menuItem('Retention…').click();
  expect(dialog().querySelector('.dlg-title').textContent).toBe('Retention');
  expect(dialog().textContent).toContain('Keep forever'.replace('Keep forever', 'Whole meeting'));
});

async function openPrivacy(settings: Record<string, unknown> = {}) {
  const api = boot('pt-BR', { getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, ...settings }) });
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.set-nav-item')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => b.textContent === 'Privacidade').click();
  return api;
}

it('Configurações › Privacidade: ocultar dados pessoais (desligado por padrão) e a guarda padrão', async () => {
  const api = await openPrivacy();
  const sw = g.document.getElementById('redact-pii');
  expect(sw.checked).toBe(false);
  expect(g.document.querySelector('#set-privacy').textContent).toContain('CPF, CNPJ, cartão, e-mail, telefone, RG e CEP viram marcadores como [CPF 1]');
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change'));
  await vi.waitFor(() => expect(api.setPrivacy).toHaveBeenCalledWith({ redactPii: true }));
  expect(g.document.querySelector('#set-privacy').textContent).toContain('Tempo de guarda padrão');
  const audio = [...g.document.querySelectorAll('#set-privacy .menu-select-btn')].find((b: any) => b.getAttribute('aria-label') === 'Áudio') as any;
  expect(audio.textContent.trim()).toBe('Manter sempre');
  audio.click();
  expect([...g.document.querySelectorAll('[role=option]')].map((o: any) => o.textContent.trim())).toEqual(['Manter sempre', 'Apagar depois de 7 dias', 'Apagar depois de 30 dias', 'Apagar depois de 90 dias']); // o padrão não herda de ninguém
  [...g.document.querySelectorAll('[role=option]')].find((o: any) => o.textContent.trim() === 'Apagar depois de 90 dias').click();
  await vi.waitFor(() => expect(api.setPrivacy).toHaveBeenLastCalledWith({ retentionDefault: { audioDays: 90 } }));
});

it('a Privacidade mostra que a voz nunca é salva e o recibo de cada reunião', async () => {
  await openPrivacy();
  const text = g.document.querySelector('#set-privacy').textContent;
  expect(text).toContain('A voz nunca é salva');
  expect(text).toContain('nenhuma assinatura de voz vai para o disco');
  expect(text).toContain('Recibo de cada reunião');
});
