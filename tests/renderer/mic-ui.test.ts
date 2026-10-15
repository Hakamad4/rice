// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const MIC = { dir: '/R/a', name: 'Microphone (FIFINE K669 Microphone)', short: 'FIFINE K669 Microphone', isDefault: true, chosen: false, switched: false };

function boot(extra: Record<string, unknown> = {}, platform = 'win32', lang: 'pt-BR' | 'en' = 'pt-BR') {
  return bootRenderer({
    platform,
    uiLanguage: lang,
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, micDevice: null, asrModel: 'auto' }),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  }, [{ dir: '/R/a', title: 'Reunião', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }]);
}
const chip = () => g.document.getElementById('mic-chip') as any;
const openAudio = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .setting-section')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /^(Áudio|Audio)$/.test(b.textContent.trim())).click();
};

it('chip do microfone: aparece com o nome curto e o title com o nome completo e "padrão do Windows"; sem informação, não aparece', async () => {
  const t = boot();
  expect(chip().hidden).toBe(true); // nada antes de a gravação informar
  t.handlers['session:mic']!(MIC);
  expect(chip().hidden).toBe(false);
  expect(chip().textContent).toBe('FIFINE K669 Microphone');
  expect(chip().title).toBe('Microphone (FIFINE K669 Microphone) · padrão do Windows');
  expect(chip().querySelector('.icon, svg')).not.toBeNull();
  t.handlers['session:mic']!(null);
  expect(chip().hidden).toBe(true);
  t.handlers['session:mic']!({ name: '' });
  expect(chip().hidden).toBe(true);
});

it('chip no Mac: "padrão do sistema"; escolhido: "escolhido"; em inglês', async () => {
  const mac = boot({}, 'darwin');
  mac.handlers['session:mic']!({ ...MIC, name: 'MacBook Pro Microphone', short: 'MacBook Pro Microphone' });
  expect(chip().title).toBe('MacBook Pro Microphone · padrão do sistema');
  mac.handlers['session:mic']!({ ...MIC, chosen: true, isDefault: false });
  expect(chip().title).toContain('escolhido');
  const en = boot({}, 'win32', 'en');
  en.handlers['session:mic']!(MIC);
  expect(chip().title).toBe('Microphone (FIFINE K669 Microphone) · Windows default');
});

it('trocar o microfone no meio avisa "Microfone trocado para X"; repetir o mesmo não avisa', async () => {
  const t = boot();
  t.handlers['session:mic']!(MIC);
  expect(g.document.querySelectorAll('#toast-stack .toast').length).toBe(0);
  t.handlers['session:mic']!({ ...MIC, name: 'Realtek Audio', short: 'Realtek Audio', switched: true });
  const toast = g.document.querySelector('#toast-stack .toast');
  expect(toast.textContent).toBe('Microfone trocado para Realtek Audio');
  expect(chip().textContent).toBe('Realtek Audio');
});

it('ao recarregar a tela com a gravação em andamento, o chip volta (micCurrent); quando a gravação acaba, some', async () => {
  const t = boot({ micCurrent: vi.fn(async () => MIC), sessionState: async () => ({ state: 'recording', dir: '/R/a', paused: false }) });
  await vi.waitFor(() => expect(chip().hidden).toBe(false));
  t.handlers['session:state']!('idle');
  expect(chip().hidden).toBe(true);
});

it('Configurações › Áudio (Windows): seletor "Padrão do Windows (recomendado)" + as entradas; escolher grava; explicação do Teams/Zoom', async () => {
  const setMic = vi.fn(async () => ({ ok: true, micDevice: 'b' }));
  boot({ listMicInputs: async () => ({ supported: true, inputs: [{ id: 'a', name: 'FIFINE K669', isDefault: true }, { id: 'b', name: 'Webcam C920', isDefault: false }] }), setMic });
  await openAudio();
  const section = () => g.document.querySelector('[data-section=audio]') as any;
  await vi.waitFor(() => expect(section().textContent).toContain('Use o mesmo microfone que você escolheu no Teams ou no Zoom'));
  expect(section().querySelector('select')).toBeNull(); // nada de <select> nativo
  const btn = [...section().querySelectorAll('.menu-select-btn')].find((b: any) => b.getAttribute('aria-label') === 'Microfone');
  expect(btn.textContent).toContain('Padrão do Windows (recomendado)');
  btn.click();
  const items = [...g.document.querySelectorAll('.menu-popover [role=option], .menu-popover .menu-item, .menu-popover button')].map((i: any) => i.textContent.trim());
  expect(items.join('|')).toContain('FIFINE K669 (padrão)');
  expect(items.join('|')).toContain('Webcam C920');
  [...g.document.querySelectorAll('.menu-popover [role=option], .menu-popover .menu-item, .menu-popover button')].find((i: any) => i.textContent.includes('Webcam C920')).click();
  await vi.waitFor(() => expect(setMic).toHaveBeenCalledWith('b'));
  await vi.waitFor(() => expect(section().textContent).toContain('Vale na próxima vez que o Rice abrir o microfone'.replace('Vale', 'Vale')));
});

it('helper sem a opção de listar: só o padrão, com a explicação; microfone salvo que sumiu aparece como "(não está conectado)"', async () => {
  boot({ getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, micDevice: 'sumiu', asrModel: 'auto' }), listMicInputs: async () => ({ supported: false, inputs: [] }), setMic: async () => ({ ok: true }) });
  await openAudio();
  const section = g.document.querySelector('[data-section=audio]') as any;
  await vi.waitFor(() => expect(section.textContent).toContain('ainda não consegue listar os microfones'));
  const btn = [...section.querySelectorAll('.menu-select-btn')].find((b: any) => b.getAttribute('aria-label') === 'Microfone');
  expect(btn.textContent).toContain('Microfone escolhido (não está conectado)');
});

it('Mac: sem seletor, com a explicação da entrada padrão do macOS', async () => {
  boot({}, 'darwin');
  await openAudio();
  const section = g.document.querySelector('[data-section=audio]') as any;
  expect(section.textContent).toContain('Ajustes do Sistema › Som › Entrada');
  expect([...section.querySelectorAll('.menu-select-btn')].some((b: any) => b.getAttribute('aria-label') === 'Microfone')).toBe(false);
});

it('modelo de transcrição: mostra o em uso e o motivo (leve por pouca memória), a nota do modo leve e deixa forçar', async () => {
  const setAsrModel = vi.fn(async (choice: string) => ({ choice, model: 'full', tier: 'large', ramGb: 8, cores: 4, threads: 2, reason: 'forced-full', light: false }));
  boot({ audioProfile: async () => ({ choice: 'auto', model: 'light', tier: 'small', ramGb: 8, cores: 4, threads: 2, reason: 'low-ram', light: true }), setAsrModel });
  await openAudio();
  const section = g.document.querySelector('[data-section=audio]') as any;
  await vi.waitFor(() => expect(section.textContent).toContain('Em uso: modelo leve (small; 8 GB de RAM, 4 núcleos)'));
  expect(section.querySelector('.ai-note-line:not([hidden])').textContent).toContain('Modo leve');
  const btn = [...section.querySelectorAll('.menu-select-btn')].find((b: any) => b.getAttribute('aria-label') === 'Modelo de transcrição');
  btn.click();
  [...g.document.querySelectorAll('.menu-popover button, .menu-popover [role=option], .menu-popover .menu-item')].find((i: any) => i.textContent.trim() === 'Completo').click();
  await vi.waitFor(() => expect(setAsrModel).toHaveBeenCalledWith('full'));
  await vi.waitFor(() => expect(section.textContent).toContain('Em uso: modelo completo (escolhido por você)'));
});

it('detalhe da reunião mostra o microfone capturado', async () => {
  const t = boot({ readMeeting: async () => ({ meta: { dir: '/R/a', title: 'Reunião', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), state: 'done', notesStatus: 'done', gaps: [], micName: 'FIFINE K669' }, transcript: '', annotations: '', notes: '', chat: [] }) });
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.page-meta')?.textContent).toContain('Microfone: FIFINE K669'));
  void t;
});

it('Mac: o modelo aparece só como "Em uso" (sem seletor) porque o Mac ignora o modo', async () => {
  boot({ audioProfile: async () => ({ choice: 'auto', model: 'full', tier: 'large', ramGb: 16, cores: 10, threads: 6, reason: 'mac', light: false }) }, 'darwin');
  await openAudio();
  const section = g.document.querySelector('[data-section=audio]') as any;
  await vi.waitFor(() => expect(section.textContent).toContain('no Mac o Rice usa sempre o modelo grande'));
  expect([...section.querySelectorAll('.menu-select-btn')].some((b: any) => b.getAttribute('aria-label') === 'Modelo de transcrição')).toBe(false);
});
