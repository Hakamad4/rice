// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const slow = <T>(value: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const title = () => (g.document.querySelector('#detail h1, #detail .page-title') as any)?.textContent?.trim() ?? '';
const note = { id: 'general', title: 'Reunião geral', description: 'd', icon: 'file-text', sections: [{ heading: 'Resumo', description: '' }], builtin: true };

function boot() {
  bootRenderer({
    // tudo que a tela espera é LENTO: o título tem de estar no DOM antes de qualquer um destes chegar
    getSettings: () => slow({ root: '/R', rootDisplay: '~/R', onboardingDone: true, uiLanguage: 'pt-BR', transcriptionLanguage: 'pt', keepAudio: true }),
    aiStatus: () => slow({ active: 'claude-sub', models: {}, providers: {} }),
    asrStatus: () => slow({ state: 'ready' }),
    permissionStatus: () => slow({ microphone: 'granted' }),
    googleStatus: () => slow({ connected: false }),
    eventKitStatus: () => slow({ access: 'denied' }),
    calendarEvents: () => slow([]),
    listTemplates: () => slow({ templates: [note], warnings: [], defaultId: 'general' }),
    listIdeaTemplates: () => slow({ templates: [], warnings: [], lastId: 'general' }),
  }, []);
}

it('cada tela tem o título no DOM logo após o clique, SEM await (nada de tela em branco enquanto os dados chegam)', async () => {
  boot();
  await vi.waitFor(() => expect(title()).toBe('Agenda'), { timeout: 3000 });
  for (const [id, expected] of [['settings-link', 'Configurações'], ['templates-link', 'Templates'], ['guide-link', 'Como usar o Rice'], ['home-link', 'Agenda']] as const) {
    g.document.getElementById(id).click();
    expect(title(), id).toBe(expected); // síncrono
    expect(g.document.getElementById('detail').children.length, id).toBeGreaterThan(0);
    await vi.waitFor(() => expect(g.document.getElementById('detail').textContent.length).toBeGreaterThan(expected.length + 5), { timeout: 3000 }); // os dados chegam depois, no lugar
    expect(title(), id).toBe(expected);
  }
});

it('Início: o campo de pergunta já está na tela no esqueleto, sem o cartão "Conecte sua agenda" nem "Nada na agenda" piscando', async () => {
  boot();
  g.document.getElementById('settings-link').click();
  g.document.getElementById('home-link').click();
  expect(title()).toBe('Agenda');
  expect(g.document.getElementById('home-ask-input')).not.toBeNull();
  expect(g.document.querySelector('.connect-card')).toBeNull();
  expect(g.document.querySelector('#detail .empty')).toBeNull();
  await vi.waitFor(() => expect(g.document.querySelector('.connect-card')).not.toBeNull(), { timeout: 3000 }); // sem fonte de agenda: o cartão chega com os dados
});

it('Templates (aba Ideias): o título e as abas já estão na tela antes da lista', async () => {
  boot();
  g.document.getElementById('templates-link').click();
  await vi.waitFor(() => expect(g.document.querySelectorAll('.tpl-block').length).toBeGreaterThan(0), { timeout: 3000 });
  (g.document.querySelectorAll('.tpl-tabs .mt-tab')[1] as any).click();
  expect(title()).toBe('Templates'); // síncrono, com as duas abas
  expect(g.document.querySelectorAll('.tpl-tabs .mt-tab')).toHaveLength(2);
});
