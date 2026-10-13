// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const REGISTERED = { accelerator: 'Alt+Command+R', state: 'registered', defaultAccelerator: 'Alt+Command+R' };

function boot(status: Record<string, unknown>, lang: 'pt-BR' | 'en' = 'pt-BR', extra: Record<string, unknown> = {}, platform = 'darwin') {
  const setRecordShortcut = vi.fn(async (choice: string) => ({ ok: true, invalid: false, accelerator: choice === 'none' ? null : choice === 'default' ? REGISTERED.accelerator : choice, state: choice === 'none' ? 'none' : 'registered', defaultAccelerator: REGISTERED.defaultAccelerator }));
  const out = bootRenderer({
    uiLanguage: lang,
    platform,
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true }),
    shortcutStatus: vi.fn(async () => status),
    setRecordShortcut,
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  }, []);
  return { ...out, setRecordShortcut };
}
const openSection = async () => {
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.set-nav-item')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => /Atalhos|Shortcuts/.test(b.textContent)).click();
  await vi.waitFor(() => expect(g.document.querySelector('.shortcut-key')).not.toBeNull());
};
const key = () => g.document.querySelector('.shortcut-key') as any;
const note = () => g.document.querySelector('.shortcut-note') as any;
const press = (init: Record<string, unknown>) => key().dispatchEvent(new g.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

it('mostra ⌥⌘R por padrão, com a explicação; no Windows mostra Ctrl+Alt+R', async () => {
  boot(REGISTERED);
  await openSection();
  expect(key().textContent).toBe('⌥⌘R');
  expect(g.document.querySelector('#set-shortcuts').textContent).toContain('Funciona em qualquer app, com o Rice em segundo plano');
  expect(note().hidden).toBe(true);
  expect(g.window.RiceShortcut.format('Control+Alt+R', true)).toBe('Ctrl+Alt+R');
  expect(g.window.RiceShortcut.format(null, false)).toBe('Nenhum');
});

it('trocar: clicar, pressionar as teclas e o main recebe o atalho canônico', async () => {
  const t = boot(REGISTERED);
  await openSection();
  key().click();
  expect(key().textContent).toBe('Pressione o atalho…');
  press({ code: 'ControlLeft', key: 'Control', ctrlKey: true }); // só um modificador: segue ouvindo
  expect(t.setRecordShortcut).not.toHaveBeenCalled();
  press({ code: 'KeyG', key: 'g', ctrlKey: true, altKey: true });
  await vi.waitFor(() => expect(t.setRecordShortcut).toHaveBeenCalledWith('Control+Alt+G'));
  await vi.waitFor(() => expect(key().textContent).toBe('⌃⌥G'));
});

it('sem modificador forte o atalho é recusado na tela; Esc cancela sem mudar nada', async () => {
  const t = boot(REGISTERED);
  await openSection();
  key().click();
  press({ code: 'KeyR', key: 'r' });
  expect(t.setRecordShortcut).not.toHaveBeenCalled();
  expect(note().textContent).toContain('Esse atalho não vale');
  key().click();
  press({ code: 'Escape', key: 'Escape' });
  expect(key().textContent).toBe('⌥⌘R');
  expect(t.setRecordShortcut).not.toHaveBeenCalled();
});

it('"Nenhum" e "Padrão"', async () => {
  const t = boot(REGISTERED);
  await openSection();
  const buttons = () => [...g.document.querySelectorAll('.shortcut-buttons button')] as any[];
  buttons().find((b) => b.textContent === 'Nenhum').click();
  await vi.waitFor(() => expect(t.setRecordShortcut).toHaveBeenCalledWith('none'));
  await vi.waitFor(() => expect(key().textContent).toBe('Nenhum'));
  expect(note().textContent).toContain('Sem atalho global');
  const reset = buttons().find((b) => b.textContent === 'Padrão');
  expect(reset.hidden).toBe(false);
  reset.click();
  await vi.waitFor(() => expect(t.setRecordShortcut).toHaveBeenCalledWith('default'));
  await vi.waitFor(() => expect(key().textContent).toBe('⌥⌘R'));
});

it('conflito ao abrir: aviso nas Configurações com o atalho; conflito ao trocar mostra o atalho tentado e mantém o anterior', async () => {
  boot({ accelerator: 'Alt+Command+R', state: 'conflict', defaultAccelerator: 'Alt+Command+R' });
  await openSection();
  expect(note().classList.contains('warn')).toBe(true);
  expect(note().textContent).toBe('O atalho ⌥⌘R já está em uso por outro app (ou pelo sistema) e não foi registrado. Escolha outro.');
  const t = boot(REGISTERED, 'en', { setRecordShortcut: vi.fn(async () => ({ ok: false, invalid: false, accelerator: 'Alt+Command+R', state: 'conflict', defaultAccelerator: 'Alt+Command+R' })) });
  await openSection();
  key().click();
  press({ code: 'KeyG', key: 'g', altKey: true, metaKey: true });
  await vi.waitFor(() => expect(note().textContent).toContain('⌥⌘G'));
  expect(note().textContent).toBe('The shortcut ⌥⌘G is already used by another app (or the system) and was not registered. Pick another one.');
  expect(t.rice.setRecordShortcut).toHaveBeenCalledWith('Alt+Command+G');
});

it('em inglês: textos traduzidos', async () => {
  boot(REGISTERED, 'en');
  await openSection();
  expect(g.document.querySelector('#set-shortcuts h2').textContent).toBe('Shortcuts');
  expect(g.document.querySelector('#set-shortcuts .set-label').textContent).toBe('Shortcut to record and stop');
});
