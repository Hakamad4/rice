// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer, press } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Planejamento', startedAt: '2026-01-01T10:00:00-03:00', state: 'done' }];
const tick = () => new Promise((r) => setTimeout(r, 40));
const transcript = '# Planejamento\n\n**[10:00:05] Eu:** abrindo a reunião\n**[10:00:40] Outros:** vejam os números\n**[10:02:00] Eu:** fechamos\n';
const shot = (file: string, at: string, offsetMs: number, caption: string, segment: string | null) => ({ file, at, offsetMs, caption, segment });
const shots = [
  shot('100045.jpg', '2026-01-01T10:00:45-03:00', 45_000, 'Slide de metas do trimestre', '10:00:05'),
  shot('100130.jpg', '2026-01-01T10:01:30-03:00', 90_000, 'Planilha de custos', null),
];

async function setup(over: Record<string, unknown> = {}, notes = '') {
  const screenshotsRemove = vi.fn(async () => ({ ok: true }));
  const { handlers } = bootRenderer({
    readMeeting: async () => ({ meta: { notesStatus: 'done', ...meetings[0] }, transcript, annotations: '', notes, chat: [] }),
    saveAnnotations: async () => ({ ok: true }),
    attachList: async () => ({ items: [], images: { supported: true, provider: 'claude-api' } }),
    screenshotsList: async () => ({ shots, recording: false }),
    screenshotsThumb: async () => 'data:image/jpeg;base64,AAAA',
    screenshotsImage: async () => 'data:image/jpeg;base64,BBBB',
    screenshotsRemove,
    ...over,
  }, meetings);
  await tick();
  g.document.querySelector('.meeting').click();
  await tick();
  await tick();
  return { handlers, screenshotsRemove };
}
const tab = (name: string) => [...g.document.querySelectorAll('.mt-tab')].find((b: any) => b.textContent === name) as any;

it('transcrição: miniatura de 64px no ponto do tempo (depois da fala do segmento, ou pela hora), legenda secundária', async () => {
  await setup();
  tab('Transcrição').click();
  await tick();
  const rows = [...g.document.querySelector('.transcript').children] as any[];
  const kinds = rows.map((r) => (r.classList.contains('t-shot') ? 'shot' : 'fala'));
  expect(kinds).toEqual(['fala', 'fala', 'shot', 'shot', 'fala']); // 10:00:40 + miniatura; 10:01:30 pela hora, antes da fala das 10:02:00
  const first = rows[2];
  expect(first.querySelector('.shot-img').src).toContain('data:image/jpeg');
  expect(first.querySelector('.shot-text').textContent).toBe('Slide de metas do trimestre');
  expect(first.querySelector('.shot-clock').textContent).toBe('10:00:45');
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.shot-img \{[^}]*height:64px[^}]*border-radius:6px/);
  expect(css).toMatch(/\.shot-caption \{[^}]*color:var\(--muted\)/);
});

it('clicar abre a visualização ampliada e Esc fecha', async () => {
  await setup();
  tab('Transcrição').click();
  await tick();
  g.document.querySelector('.t-shot .shot-open').click();
  await tick();
  const viewer = g.document.querySelector('.shot-viewer');
  expect(viewer.querySelector('img').src).toContain('BBBB');
  expect(viewer.textContent).toContain('Slide de metas do trimestre');
  g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(g.document.querySelector('.shot-viewer')).toBeNull();
});

it('⋯ da captura tem "Remover" e chama o main com a pasta e o arquivo', async () => {
  const { screenshotsRemove } = await setup();
  tab('Transcrição').click();
  await tick();
  g.document.querySelector('.t-shot .shot-more').click();
  const item = [...g.document.querySelectorAll('.menu-item')].find((b: any) => b.textContent.includes('Remover')) as any;
  expect(item).toBeTruthy();
  item.click();
  await tick();
  expect(screenshotsRemove).toHaveBeenCalledWith('/R/a', '100045.jpg');
});

it('uma mudança vinda do main (captura nova ou removida) redesenha as miniaturas', async () => {
  let list = [shots[0]];
  const { handlers } = await setup({ screenshotsList: async () => ({ shots: list, recording: false }) });
  tab('Transcrição').click();
  await tick();
  expect(g.document.querySelectorAll('.t-shot')).toHaveLength(1);
  list = shots;
  handlers['screenshots:changed']!({ dir: '/R/a', count: 2 });
  await tick();
  expect(g.document.querySelectorAll('.t-shot')).toHaveLength(2);
  handlers['screenshots:changed']!({ dir: '/outra', count: 9 }); // de outra reunião: ignorada
  await tick();
  expect(g.document.querySelectorAll('.t-shot')).toHaveLength(2);
});

it('notas: a citação vira miniatura só para uma captura desta reunião; id desconhecido e HTML da IA não renderizam nada', async () => {
  const notes = '## Resumo\n- Metas do trimestre\n<!--shot:100045-->\n<!--shot:999999-->\n<img src=x onerror=alert(1)>\n';
  await setup({}, notes);
  const body = g.document.querySelector('.mt-body');
  expect(body.querySelectorAll('.note-shot')).toHaveLength(1);
  expect(body.querySelector('.note-shot img').src).toContain('data:image/jpeg');
  expect(body.querySelector('.note-shot .shot-text').textContent).toBe('Slide de metas do trimestre');
  expect(body.querySelector('.md img[src="x"]')).toBeNull(); // HTML vindo da IA nunca vira elemento
  expect(body.querySelector('.note-shot .shot-more')).toBeNull(); // nas notas não há remoção
});

it('sem o gancho (outras telas), a citação some em vez de aparecer como texto', () => {
  const doc = g.document;
  const div = doc.createElement('div');
  div.append(g.window.RiceMarkdown.renderMarkdown('- a\n<!--shot:100045-->\n- b', doc));
  expect(div.textContent).not.toContain('shot');
});

it('configurações: seção "Capturas de tela" desligada por padrão; ligar mostra o aviso e só "Ativar" liga', async () => {
  const screenshotsSetEnabled = vi.fn(async () => ({ ok: true, enabled: true, provider: 'claude-sub', seesImages: false, permission: 'granted' }));
  bootRenderer({
    screenshotsStatus: async () => ({ enabled: false, provider: 'claude-sub', seesImages: false, permission: 'granted' }),
    screenshotsSetEnabled,
    screenshotsOpenPrivacy: vi.fn(),
  }, meetings);
  await tick();
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('#screenshots')).toBeTruthy());
  const sw = g.document.querySelector('#screenshots') as any;
  expect(sw.checked).toBe(false);
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  const text = g.document.querySelector('.dialog').textContent;
  expect(text).toContain('vou compartilhar a tela'); // o gatilho é a conversa, não um timer
  expect(text).toContain('⌘⇧S');
  expect(text).toContain('pasta da reunião');
  expect(text).toContain('As imagens não são enviadas'); // assinatura via CLI: só o texto vai para a IA, a imagem fica no computador
  expect(text).toContain('só o texto');
  expect(text).toContain('Gravação de Tela');
  expect(screenshotsSetEnabled).not.toHaveBeenCalled();
  const buttons = [...g.document.querySelectorAll('.dialog .dlg-foot button')].map((b: any) => b.textContent);
  expect(buttons).toEqual(['Cancelar', 'Ativar']);
  // Cancelar: continua desligado
  (g.document.querySelector('.dialog .dlg-foot button') as any).click();
  await tick();
  expect(sw.checked).toBe(false);
  expect(screenshotsSetEnabled).not.toHaveBeenCalled();
  // Esc também cancela
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  press(g.document.querySelector('.dialog'), 'Escape');
  await tick();
  expect(sw.checked).toBe(false);
  // Ativar liga
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  ([...g.document.querySelectorAll('.dialog .dlg-foot button')].find((b: any) => b.textContent === 'Ativar') as any).click();
  await tick();
  expect(screenshotsSetEnabled).toHaveBeenCalledWith(true);
  expect(sw.checked).toBe(true);
  expect(g.document.querySelector('#set-screenshots').textContent).toContain('só o texto da conversa vai para a IA'); // assinatura via CLI: funciona, só sem imagem
});

it('com provedor de API o aviso diz que as imagens vão para a IA ativa; em inglês o texto é traduzido', async () => {
  bootRenderer({
    uiLanguage: 'en',
    getSettings: async () => ({ root: '/R', onboardingDone: true, uiLanguage: 'en', transcriptionLanguage: 'pt', keepAudio: true, rootDisplay: '~/Rice' }),
    screenshotsStatus: async () => ({ enabled: false, provider: 'claude-api', seesImages: true, permission: 'granted' }),
    screenshotsSetEnabled: vi.fn(),
  }, meetings);
  await tick();
  g.window.RiceI18n.setLanguage('en');
  const promise = g.window.RiceScreenshots.confirmEnable({ provider: 'claude-api', seesImages: true, permission: 'granted' });
  const dialog = g.document.querySelector('.dialog');
  expect(dialog.textContent).toContain('sent to the AI you configured');
  expect(dialog.textContent).toContain('stays active during the meeting');
  expect(dialog.textContent).toContain('image also goes to it');
  expect([...dialog.querySelectorAll('.dlg-foot button')].map((b: any) => b.textContent)).toEqual(['Cancel', 'Turn on']);
  press(dialog, 'Escape');
  expect(await promise).toBe(false);
});

it('controle na gravação: "3 capturas" perto do status, menu para desligar', async () => {
  const screenshotsSetEnabled = vi.fn(async () => ({ ok: true, enabled: false }));
  const { handlers } = await setup({
    sessionState: async () => ({ state: 'recording', dir: '/R/a' }),
    screenshotsStatus: async () => ({ enabled: true, provider: 'claude-api', seesImages: true, permission: 'granted' }),
    screenshotsList: async () => ({ shots: [...shots, shots[0]], recording: true }),
    screenshotsSetEnabled,
  });
  handlers['session:state']!('recording');
  await tick();
  await tick();
  const chip = g.document.getElementById('shots-chip') as any;
  expect(chip.hidden).toBe(false);
  expect(chip.textContent).toContain('3 capturas');
  handlers['screenshots:changed']!({ dir: '/R/a', count: 4 });
  expect(chip.textContent).toContain('4 capturas');
  chip.click();
  ([...g.document.querySelectorAll('.menu-item')].find((b: any) => b.textContent.includes('Desligar capturas')) as any).click();
  await tick();
  expect(screenshotsSetEnabled).toHaveBeenCalledWith(false);
});

it('desligado, ou sem gravar, o controle não aparece', async () => {
  const { handlers } = await setup({
    sessionState: async () => ({ state: 'recording', dir: '/R/a' }),
    screenshotsStatus: async () => ({ enabled: false, provider: 'claude-api', seesImages: true, permission: 'granted' }),
  });
  handlers['session:state']!('recording');
  await tick();
  expect((g.document.getElementById('shots-chip') as any).hidden).toBe(true);
});

it('a miniatura de uma captura da fala fica logo depois do trecho que a motivou, mesmo com falas depois dela', async () => {
  const triggered = { ...shot('100200.jpg', '2026-01-01T10:02:00-03:00', 120_000, 'Ana mostrou a planilha', '10:00:05'), trigger: { segmentAt: '10:00:05', text: 'abrindo a reunião' } };
  await setup({ screenshotsList: async () => ({ shots: [triggered], recording: false }) });
  tab('Transcrição').click();
  await tick();
  const kinds = [...g.document.querySelector('.transcript').children].map((r: any) => (r.classList.contains('t-shot') ? 'shot' : 'fala'));
  expect(kinds).toEqual(['fala', 'shot', 'fala', 'fala']);
});

it('botão "Capturar tela" e ⌘⇧S só aparecem gravando com a opção ligada; chamam o main', async () => {
  const screenshotsCaptureNow = vi.fn(async () => ({ ok: true }));
  const { handlers } = await setup({
    sessionState: async () => ({ state: 'recording', dir: '/R/a' }),
    screenshotsStatus: async () => ({ enabled: true, provider: 'claude-sub', seesImages: false, permission: 'granted' }),
    screenshotsCaptureNow,
  });
  const btn = g.document.getElementById('shots-capture') as any;
  handlers['session:state']!('recording');
  await tick();
  await tick();
  expect(btn.hidden).toBe(false);
  expect(btn.querySelector('svg.icon-camera')).toBeTruthy();
  expect(btn.getAttribute('aria-label')).toBe('Capturar tela');
  btn.click();
  await tick();
  expect(screenshotsCaptureNow).toHaveBeenCalledTimes(1);
  g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'S', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await tick();
  expect(screenshotsCaptureNow).toHaveBeenCalledTimes(2);
});

it('o atalho não faz nada sem gravar', async () => {
  const screenshotsCaptureNow = vi.fn(async () => ({ ok: true }));
  await setup({ screenshotsCaptureNow });
  g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'S', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await tick();
  expect(screenshotsCaptureNow).not.toHaveBeenCalled();
});
