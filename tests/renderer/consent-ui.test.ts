// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }];
const toast = () => g.document.querySelector('.consent-toast') as any;

function boot(offer: unknown, extra: Record<string, unknown> = {}) {
  let live = false; // o app abre parado; o main passa a "recording" quando a gravação começa
  const t = bootRenderer({
    consentNotice: vi.fn(async () => offer),
    consentMarkCopied: vi.fn(async () => ({ ok: true })),
    copyText: vi.fn(async () => true),
    sessionState: async () => ({ state: live ? 'recording' : 'idle', dir: live ? '/R/a' : null, paused: false }),
    ...extra,
  }, MEETINGS);
  (t as unknown as { go: () => void }).go = () => (live = true);
  return t;
}
const start = async (t: ReturnType<typeof boot>) => {
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  (t as unknown as { go: () => void }).go();
  await t.handlers['session:state']!('recording'); // o evento de estado que já existe
};

it('ao começar a gravar aparece um toast discreto com "Copiar aviso"; não bloqueia (sem overlay nem diálogo)', async () => {
  const t = boot({ show: true, text: 'Aviso: gravando.' });
  await start(t);
  await vi.waitFor(() => expect(toast()).not.toBeNull());
  expect(t.rice.consentNotice).toHaveBeenCalledWith('/R/a');
  expect(toast().textContent).toContain('Avise os participantes que a reunião está sendo transcrita');
  expect(toast().querySelector('.consent-copy').textContent).toBe('Copiar aviso');
  expect(g.document.querySelector('.overlay')).toBeNull();
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  expect(g.document.getElementById('rec').disabled).toBe(false); // a gravação segue livre
});

it('Copiar aviso copia o texto pronto e registra a hora na reunião; o botão confirma', async () => {
  const t = boot({ show: true, text: 'Aviso: estou usando o Rice para transcrever esta reunião localmente.' });
  await start(t);
  await vi.waitFor(() => expect(toast()).not.toBeNull());
  toast().querySelector('.consent-copy').click();
  await vi.waitFor(() => expect(t.rice.copyText).toHaveBeenCalledWith('Aviso: estou usando o Rice para transcrever esta reunião localmente.'));
  await vi.waitFor(() => expect(t.rice.consentMarkCopied).toHaveBeenCalledWith('/R/a'));
  await vi.waitFor(() => expect(toast().querySelector('.consent-copy').textContent).toBe('Copiado'));
});

it('opção desligada ou aviso já copiado (o main diz show:false): nenhum toast; dispensar fecha', async () => {
  const off = boot({ show: false });
  await start(off);
  await new Promise((r) => setTimeout(r, 30));
  expect(toast()).toBeNull();
  const on = boot({ show: true, text: 'x' });
  await start(on);
  await vi.waitFor(() => expect(toast()).not.toBeNull());
  toast().querySelector('.consent-close').click();
  expect(toast()).toBeNull();
});

it('só no começo da gravação (idle → recording): pausar/continuar não repete; ao parar o toast some', async () => {
  const t = boot({ show: true, text: 'x' });
  await start(t);
  await vi.waitFor(() => expect(toast()).not.toBeNull());
  await t.handlers['session:state']!('recording');
  expect(t.rice.consentNotice).toHaveBeenCalledTimes(1);
  await t.handlers['session:state']!('idle');
  expect(toast()).toBeNull();
});

it('Configurações › Privacidade: lembrar (ligado por padrão) e o texto do aviso, com o padrão como exemplo; salva no main', async () => {
  const t = boot({ show: false }, {
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, consentRemind: true, consentText: '' }),
    setConsent: vi.fn(async () => ({ ok: true })),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
  });
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.set-nav-item')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => b.textContent === 'Privacidade').click();
  const sw = g.document.getElementById('consent-remind');
  expect(sw.checked).toBe(true);
  expect(g.document.querySelector('#set-privacy').textContent).toContain('Lembrar de avisar os participantes');
  const text = g.document.getElementById('consent-text');
  expect(text.placeholder).toMatch(/^Aviso: estou usando o Rice/);
  sw.checked = false;
  sw.dispatchEvent(new g.window.Event('change'));
  await vi.waitFor(() => expect(t.rice.setConsent).toHaveBeenCalledWith(false, ''));
  text.value = 'Gravando para a ata.';
  text.dispatchEvent(new g.window.Event('input'));
  await vi.waitFor(() => expect(t.rice.setConsent).toHaveBeenLastCalledWith(false, 'Gravando para a ata.'));
});
