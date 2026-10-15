// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi, describe } from 'vitest';

const g = globalThis as any;
/** A transcrição vive na sua própria aba da reunião. */
const openTranscriptTab = async () => {
  await vi.waitFor(() => expect([...g.document.querySelectorAll('.mt-tab')].some((b: any) => b.textContent === 'Transcrição' || b.textContent === 'Transcript')).toBe(true));
  ([...g.document.querySelectorAll('.mt-tab')].find((b: any) => b.textContent === 'Transcrição' || b.textContent === 'Transcript') as any).click();
};

/** ⋯ da reunião aberta → item "Apagar reunião" (o menu fica aberto até alguém escolher ou fechar). */
const deleteItem = () => {
  g.document.querySelector('.more-btn').click();
  return [...g.document.querySelectorAll('.action-item')].find((i: any) => i.classList.contains('danger')) as any;
};
const openDelete = () => deleteItem().click();
const iso = (d: Date) => d.toISOString();

it('renderer: lista agrupada por dia, abre reunião e renomeia pelo título', async () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  let title = 'Daily';
  const rice = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [
      { dir: '/R/a', title, startedAt: iso(now), state: 'done' },
      { dir: '/R/b', title: 'Ontem sync', startedAt: iso(yesterday), state: 'done' },
    ],
    readMeeting: async () => ({
      meta: { title, startedAt: iso(now), endedAt: iso(new Date(now.getTime() + 30 * 60000)), state: 'done', notesStatus: 'done' },
      transcript: '', annotations: '', notes: '# Resumo\n\ntexto', chat: [],
    }),
    renameMeeting: vi.fn(async (_d: string, t: string) => ((title = t), { ok: true, title: t })),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: () => {},
  };
  g.window.rice = rice;
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();

  await vi.waitFor(() => expect(g.document.querySelectorAll('.group-label').length).toBe(2));
  expect([...g.document.querySelectorAll('.group-label')].map((n: any) => n.textContent)).toEqual(['Hoje', 'Ontem']);

  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  expect(g.document.querySelector('.page-meta').textContent).toContain('30 min');
  // sidebar enxuta: sem campo de título; hora à direita do título
  expect(g.document.getElementById('title')).toBeNull();
  expect(g.document.querySelector('.meeting .m-title').textContent).toBe('Daily');
  expect(g.document.querySelector('.meeting small').textContent).toMatch(/^\d{2}:\d{2}$/);

  g.document.getElementById('page-title').click();
  const input = g.document.querySelector('input.title-edit');
  input.value = 'Planejamento';
  input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await vi.waitFor(() => expect(rice.renameMeeting).toHaveBeenCalledWith('/R/a', 'Planejamento'));
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Planejamento'));
});

it('renderer: painel "Pergunte ao Rice" recolhido sem reunião, lembra a escolha em localStorage', async () => {
  const now = new Date();
  g.localStorage.clear();
  g.window.rice = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [{ dir: '/R/a', title: 'Daily', startedAt: now.toISOString(), state: 'done' }],
    readMeeting: async () => ({
      meta: { title: 'Daily', startedAt: now.toISOString(), state: 'done', notesStatus: 'done' },
      transcript: '', annotations: '', notes: '', chat: [],
    }),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: () => {},
  };
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  const body = g.document.body;
  const toggle = g.document.getElementById('chat-toggle');

  // sem reunião aberta: recolhido (o botão abre o chat de todas as reuniões)
  expect(body.classList.contains('chat-open')).toBe(false);
  expect(toggle.disabled).toBe(false);

  // com reunião aberta e sem preferência salva: abre
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(body.classList.contains('chat-open')).toBe(true));
  expect(toggle.disabled).toBe(false);

  // recolher grava a preferência; reabrir também
  toggle.click();
  expect(body.classList.contains('chat-open')).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(g.localStorage.getItem('rice.chatOpen')).toBe('0');
  toggle.click();
  expect(body.classList.contains('chat-open')).toBe(true);
  expect(g.localStorage.getItem('rice.chatOpen')).toBe('1');
});

it('renderer: sem localStorage o painel ainda funciona', async () => {
  const spy = vi.spyOn(g.Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(g.Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  try {
    const now = new Date();
    g.window.rice = {
      getSettings: async () => ({ root: '/R', onboardingDone: true }),
      listMeetings: async () => [{ dir: '/R/a', title: 'Daily', startedAt: now.toISOString(), state: 'done' }],
      readMeeting: async () => ({
        meta: { title: 'Daily', startedAt: now.toISOString(), state: 'done', notesStatus: 'done' },
        transcript: '', annotations: '', notes: '', chat: [],
      }),
      sessionState: async () => ({ state: 'idle', dir: null }),
      recoveredCount: async () => 0,
      onDelta: () => {},
      on: () => {},
    };
    g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
      .replace(/<script[^>]*><\/script>/g, '')
      .replace(/^[\s\S]*?<html[^>]*>/, '');
    for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
    await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.body.classList.contains('chat-open')).toBe(true));
    g.document.getElementById('chat-toggle').click();
    expect(g.document.body.classList.contains('chat-open')).toBe(false);
  } finally {
    spy.mockRestore();
    set.mockRestore();
  }
});

function bootDraft(state: string, startRecording: (input: unknown) => Promise<unknown>) {
  const now = new Date();
  g.localStorage.clear();
  g.window.rice = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [{ dir: '/R/a', title: 'Gi e Eu', startedAt: now.toISOString(), state }],
    readMeeting: async () => ({
      meta: { title: 'Gi e Eu', startedAt: now.toISOString(), state, notesStatus: 'pending' },
      transcript: '', annotations: '', notes: '', chat: [],
    }),
    startRecording,
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: () => {},
  };
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
}

it('renderer: Gravar numa reunião draft aberta passa o dir dela (sem criar outra)', async () => {
  const start = vi.fn(async () => ({ ok: true, dir: '/R/a' }));
  bootDraft('draft', start);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  expect(g.document.querySelector('.meeting').textContent).not.toContain('interrompida');
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Gi e Eu'));
  g.document.getElementById('rec').click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledWith({ title: 'Reunião', dir: '/R/a' }));
});

it('renderer: numa reunião já gravada o botão vira "Continuar gravação" e grava nela', async () => {
  const start = vi.fn(async () => ({ ok: true, dir: '/R/a' }));
  bootDraft('done', start);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  expect(g.document.getElementById('rec-label').textContent).toBe('Gravar'); // nada aberto
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Gi e Eu'));
  expect(g.document.getElementById('rec-label').textContent).toBe('Continuar gravação');
  g.document.getElementById('rec').click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledWith({ title: 'Reunião', dir: '/R/a' }));
});

it('renderer: sem reunião aberta, Gravar não passa dir; reunião interrompida mostra ponto cinza em vez do texto', async () => {
  const start = vi.fn(async () => ({ ok: true, dir: '/R/new' }));
  bootDraft('interrupted', start);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  expect(g.document.querySelector('.meeting').textContent).not.toContain('interrompida');
  expect(g.document.querySelector('.meeting .m-dot').title).toBe('Gravação interrompida');
  g.document.getElementById('rec').click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledWith({ title: 'Reunião' }));
});

async function boot(extra: Record<string, unknown> = {}, meetings = [{ dir: '/R/a', title: 'Daily' }, { dir: '/R/b', title: 'Outra' }]) {
  const now = new Date();
  const titles = new Map(meetings.map((m) => [m.dir, m.title]));
  const handlers = new Map<string, (p: any) => any>();
  const rice: any = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => meetings.map((m) => ({ ...m, title: titles.get(m.dir), startedAt: now.toISOString(), state: 'done' })),
    readMeeting: async (dir: string) => ({
      meta: { title: titles.get(dir), startedAt: now.toISOString(), state: 'done', notesStatus: 'done' },
      transcript: '', annotations: '', notes: '', chat: [],
    }),
    renameMeeting: vi.fn(async (d: string, t: string) => (titles.set(d, t), { ok: true, title: t })),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: (ch: string, fn: (p: any) => any) => handlers.set(ch, fn),
    ...extra,
  };
  g.window.rice = rice;
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting').length).toBe(meetings.length));
  return { rice, handlers };
}
const key = (input: any, k: string) => input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: k }));

it('renomear: Enter + blur salva uma vez só', async () => {
  const { rice } = await boot();
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  g.document.getElementById('page-title').click();
  const input = g.document.querySelector('input.title-edit');
  input.value = 'Novo';
  key(input, 'Enter');
  input.dispatchEvent(new g.window.Event('blur'));
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Novo'));
  expect(rice.renameMeeting).toHaveBeenCalledTimes(1);
});

it('renomear: Esc cancela e o blur seguinte não salva', async () => {
  const { rice } = await boot();
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  g.document.getElementById('page-title').click();
  const input = g.document.querySelector('input.title-edit');
  input.value = 'Descartado';
  key(input, 'Escape');
  input.dispatchEvent(new g.window.Event('blur'));
  await new Promise((r) => setTimeout(r, 20));
  expect(rice.renameMeeting).not.toHaveBeenCalled();
  expect(g.document.getElementById('page-title').textContent).toBe('Daily');
});

it('renomear: duplo clique na lista não perde o input quando a lista é redesenhada', async () => {
  const { rice } = await boot();
  const item = g.document.querySelectorAll('.meeting')[1];
  item.click();
  item.dispatchEvent(new g.window.MouseEvent('dblclick', { bubbles: true }));
  const input = g.document.querySelector('.meeting input.title-edit');
  expect(input).not.toBeNull();
  // o clique anterior termina de abrir a reunião e redesenha a lista
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Outra'));
  await new Promise((r) => setTimeout(r, 20));
  const still = g.document.querySelector('.meeting input.title-edit');
  expect(still).toBe(input);
  input.value = 'Renomeada';
  key(input, 'Enter');
  await vi.waitFor(() => expect(rice.renameMeeting).toHaveBeenCalledWith('/R/b', 'Renomeada'));
});

it('renomear durante a gravação: segundo rename parte do título atual, não do antigo', async () => {
  const { rice, handlers } = await boot({ sessionState: async () => ({ state: 'recording', dir: '/R/a' }) });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  await handlers.get('session:state')!('recording');
  g.document.getElementById('page-title').click();
  let input = g.document.querySelector('input.title-edit');
  input.value = 'Primeiro';
  key(input, 'Enter');
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Primeiro'));
  g.document.getElementById('page-title').click();
  input = g.document.querySelector('input.title-edit');
  expect(input.value).toBe('Primeiro');
  input.value = 'Daily'; // igual ao título ANTIGO: precisa salvar, pois o atual é "Primeiro"
  key(input, 'Enter');
  await vi.waitFor(() => expect(rice.renameMeeting).toHaveBeenLastCalledWith('/R/a', 'Daily'));
});

it('apagar: diálogo próprio em dois passos; botão final só habilita ao digitar "apagar"', async () => {
  const deleteMeeting = vi.fn(async () => ({ ok: true }));
  const { handlers } = await boot({ deleteMeeting });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  expect(g.document.getElementById('delete-meeting')).toBeNull(); // sem link solto: vive no menu ⋯
  const trigger = deleteItem();
  expect(trigger.textContent).toContain('Apagar reunião');
  trigger.click();
  const dialog = g.document.querySelector('[role=dialog]');
  expect(dialog.textContent).toContain('Apagar “Daily”?');
  expect(dialog.textContent).toContain('movidos para a Lixeira do macOS');
  const cancel = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Cancelar');
  expect(g.document.activeElement).toBe(cancel);
  expect(dialog.querySelector('input')).toBeNull();

  [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Apagar').click();
  const input = dialog.querySelector('input');
  const final = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Mover para a Lixeira');
  expect(final.disabled).toBe(true);
  input.value = 'apag';
  input.dispatchEvent(new g.window.Event('input'));
  expect(final.disabled).toBe(true);
  final.click();
  expect(deleteMeeting).not.toHaveBeenCalled();
  input.value = 'apagar';
  input.dispatchEvent(new g.window.Event('input'));
  expect(final.disabled).toBe(false);
  final.click();
  await vi.waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith('/R/a'));
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]')).toBeNull());
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).toBeNull()); // volta ao início
  expect(g.document.querySelector('h1').textContent).toBe('Agenda');
  void handlers;
});

it('apagar: Cancelar e Esc fecham sem apagar', async () => {
  const deleteMeeting = vi.fn(async () => ({ ok: true }));
  await boot({ deleteMeeting });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  openDelete();
  [...g.document.querySelectorAll('[role=dialog] button')].find((b: any) => b.textContent === 'Cancelar').click();
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  openDelete();
  g.document.querySelector('[role=dialog]').dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  expect(deleteMeeting).not.toHaveBeenCalled();
});

it('apagar: erro do main aparece e o diálogo fecha sem sair da reunião', async () => {
  const deleteMeeting = vi.fn(async () => ({ ok: false, message: 'pare a gravação antes de apagar' }));
  await boot({ deleteMeeting });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  openDelete();
  [...g.document.querySelectorAll('[role=dialog] button')].find((b: any) => b.textContent === 'Apagar').click();
  const input = g.document.querySelector('[role=dialog] input');
  input.value = 'apagar';
  input.dispatchEvent(new g.window.Event('input'));
  [...g.document.querySelectorAll('[role=dialog] button')].find((b: any) => b.textContent === 'Mover para a Lixeira').click();
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]')).toBeNull());
  expect(g.document.body.textContent).toContain('pare a gravação antes de apagar');
  expect(g.document.getElementById('page-title').textContent).toBe('Daily');
});

it('início: mostra próximas reuniões; "Gravar agora" grava na nota do evento (com calendarEventId) e abre', async () => {
  const start = new Date(Date.now() + 5 * 60_000); // começa em 5 min: "Entrar" aparece
  const events = [{ id: 'ev1', title: 'Planejamento', start: start.toISOString(), end: new Date(start.getTime() + 1800_000).toISOString(), calendar: 'Trabalho', attendees: 3, source: 'google', joinUrl: 'https://meet.google.com/x' }];
  const createMeeting = vi.fn(async () => '/R/a');
  const startRecording = vi.fn(async () => ({ ok: true, dir: '/R/a' }));
  const openLink = vi.fn();
  await boot({ calendarEvents: async () => events, googleStatus: async () => ({ connected: true }), createMeeting, startRecording, openLink });
  await vi.waitFor(() => expect(g.document.querySelector('.event')).not.toBeNull());
  const [join, record] = [...g.document.querySelectorAll('.event button')] as any[];
  join.click();
  expect(openLink).toHaveBeenCalledWith('https://meet.google.com/x');
  expect(record.textContent).toBe('Gravar agora');
  record.click();
  await vi.waitFor(() => expect(createMeeting).toHaveBeenCalledWith('Planejamento', 'ev1'));
  await vi.waitFor(() => expect(startRecording).toHaveBeenCalledWith({ title: 'Planejamento', dir: '/R/a' }));
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
});

it('renderer: seletor de template na reunião; trocar numa reunião resumida oferece regerar', async () => {
  const now = new Date();
  const geral = { id: 'geral', title: 'Reunião geral', icon: 'file-text', builtin: true, description: '', sections: [] };
  const retro = { id: 'retro', title: 'Retro', icon: 'file-text', builtin: false, description: '', sections: [] };
  const rice: any = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [{ dir: '/R/a', title: 'Daily', startedAt: now.toISOString(), state: 'done' }],
    readMeeting: async () => ({
      meta: { title: 'Daily', startedAt: now.toISOString(), state: 'done', notesStatus: 'done' },
      transcript: '', annotations: '', notes: '## Resumo\n\ntexto', chat: [],
    }),
    listTemplates: async () => ({ templates: [geral, retro], defaultId: 'geral', warnings: [] }),
    setMeetingTemplate: vi.fn(async () => ({ ok: true })),
    regenerateNotes: vi.fn(async () => ({ ok: true })),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: () => {},
  };
  g.window.rice = rice;
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'template-preview', 'template-picker', 'templates', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-picker .tpl-chip')).not.toBeNull());
  const chip = g.document.querySelector('.tpl-chip');
  expect(chip.textContent).toBe('Reunião geral'); // sem templateId no meta: o padrão

  chip.click();
  expect([...g.document.querySelectorAll('[role=option]')].map((o: any) => o.querySelector('.tpl-opt-title').textContent)).toEqual(['Reunião geral', 'Retro']);
  g.document.querySelectorAll('[role=option]')[1].click();
  await vi.waitFor(() => expect(rice.setMeetingTemplate).toHaveBeenCalledWith('/R/a', 'retro'));
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-banner')).not.toBeNull());
  expect(g.document.querySelector('.dialog')).toBeNull();
  expect(rice.regenerateNotes).not.toHaveBeenCalled(); // só depois de confirmar
  [...g.document.querySelectorAll('.tpl-banner button')].find((b: any) => b.textContent === 'Regerar').click();
  await vi.waitFor(() => expect(rice.regenerateNotes).toHaveBeenCalledWith('/R/a', 'retro'));
});

it('renderer: tela Templates abre pela barra lateral', async () => {
  const rice: any = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [],
    listTemplates: async () => ({ templates: [{ id: 'geral', title: 'Reunião geral', icon: 'file-text', builtin: true, description: 'x', sections: [] }], defaultId: 'geral', warnings: [] }),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: () => {},
  };
  g.window.rice = rice;
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'template-preview', 'template-picker', 'templates', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  g.document.getElementById('templates-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-block')).not.toBeNull());
  expect(g.document.querySelector('h1').textContent).toBe('Templates');
  expect(g.document.getElementById('templates-link').classList.contains('active')).toBe(true);
});

async function bootMeeting(notes: string, extra: Record<string, any> = {}) {
  const now = new Date();
  const geral = { id: 'geral', title: 'Reunião geral', icon: 'file-text', builtin: true, description: 'Geral', sections: [{ heading: 'Resumo', description: 'Pontos principais' }, { heading: 'Decisões', description: 'O que foi decidido' }] };
  const retro = { id: 'retro', title: 'Retro', icon: 'file-text', builtin: false, description: 'Retrospectiva', sections: [{ heading: 'Bom', description: 'O que foi bem' }] };
  const rice: any = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [{ dir: '/R/a', title: 'Daily', startedAt: now.toISOString(), state: 'done' }],
    readMeeting: async () => ({
      meta: { title: 'Daily', startedAt: now.toISOString(), state: 'done', notesStatus: notes ? 'done' : 'pending' },
      transcript: '', annotations: '', notes, chat: [],
    }),
    listTemplates: async () => ({ templates: [geral, retro], defaultId: 'geral', warnings: [] }),
    setMeetingTemplate: vi.fn(async () => ({ ok: true })),
    regenerateNotes: vi.fn(async () => ({ ok: true })),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: () => {},
    ...extra,
  };
  g.window.rice = rice;
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'template-preview', 'template-picker', 'templates', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
  return rice;
}

it('renderer: sem notas, estado vazio compacto: uma linha, seções em chips pequenos e "Ver detalhes" recolhido; sem rótulo "Notas" repetido nem cartão grande', async () => {
  await bootMeeting('');
  expect(g.document.querySelector('.tpl-preview')).toBeNull(); // o cartão grande saiu
  expect(g.document.querySelector('.tpl-empty-line').textContent).toBe('O Rice vai preencher estas seções quando a gravação terminar:');
  expect([...g.document.querySelectorAll('.tpl-sec-chip')].map((c: any) => c.textContent)).toEqual(['Resumo', 'Decisões']);
  expect(g.document.querySelector('.tpl-sec-details')).toBeNull(); // recolhido por padrão
  const more = [...g.document.querySelectorAll('.tpl-empty .link-button')].find((b: any) => b.textContent === 'Ver detalhes') as any;
  more.click();
  expect([...g.document.querySelectorAll('.tpl-sec-details dt')].map((d: any) => d.textContent)).toEqual(['Resumo', 'Decisões']);
  expect(g.document.querySelectorAll('.tpl-sec-details dd').length).toBe(2);
  expect(g.document.body.textContent).not.toContain('(ainda sem notas)');
  // o rótulo "Notas" só existe na aba (nenhum <h2> "Notas" dentro do conteúdo); "Anotações" fica logo abaixo
  expect([...g.document.querySelectorAll('.mt-body .anot-head h2')].map((h: any) => h.textContent)).toEqual(['Suas anotações']);
  // template à esquerda, numa linha de 32px
  expect(g.document.querySelector('.mt-body').firstElementChild.className).toBe('mem-card'); // "O que lembrar": escondido sem fatos
  expect(g.document.querySelector('.mem-card').hidden).toBe(true);
  expect(g.document.querySelector('.mt-body').children[1].className).toBe('tpl-picker');
  expect(g.document.querySelector('.tpl-picker').firstElementChild.className).toBe('tpl-picker-root');
});

it('renderer: com notas, mostra as notas e o link "Ver seções do template" expande a prévia', async () => {
  await bootMeeting('## Resumo\n\ntexto');
  expect(g.document.querySelector('.tpl-preview')).toBeNull();
  const link = [...g.document.querySelectorAll('button')].find((b: any) => b.textContent === 'Ver seções do template') as any;
  expect(link).toBeDefined();
  link.click();
  expect(g.document.querySelectorAll('.tpl-preview h3')).toHaveLength(2);
  link.click();
  expect(g.document.querySelector('.tpl-preview')).toBeNull();
});

it('renderer: "Agora não" dispensa o banner sem regerar; trocar atualiza a prévia', async () => {
  const rice = await bootMeeting('## Resumo\n\ntexto');
  g.document.querySelector('.tpl-chip').click();
  g.document.querySelectorAll('[role=option]')[1].click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-banner')).not.toBeNull());
  [...g.document.querySelectorAll('.tpl-banner button')].find((b: any) => b.textContent === 'Agora não').click();
  expect(g.document.querySelector('.tpl-banner')).toBeNull();
  expect(rice.regenerateNotes).not.toHaveBeenCalled();
  (([...g.document.querySelectorAll('button')].find((b: any) => b.textContent === 'Ver seções do template')) as any).click();
  expect([...g.document.querySelectorAll('.tpl-preview h3')].map((h: any) => h.textContent)).toEqual(['Bom']);
});

it('renderer: sem notas, trocar o template atualiza os chips e não oferece regerar', async () => {
  await bootMeeting('');
  g.document.querySelector('.tpl-chip').click();
  g.document.querySelectorAll('[role=option]')[1].click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-chip').textContent).toContain('Retro'));
  expect([...g.document.querySelectorAll('.tpl-sec-chip')].map((c: any) => c.textContent)).not.toEqual(['Resumo', 'Decisões']); // seções do template novo
  expect(g.document.querySelector('.tpl-banner')).toBeNull();
});

it('renderer: após gravar a partir de um draft, o rótulo fica "Continuar gravação"', async () => {
  const now = new Date();
  let state = 'draft';
  const handlers: Record<string, (p: any) => any> = {};
  g.localStorage.clear();
  g.window.rice = {
    getSettings: async () => ({ root: '/R', onboardingDone: true }),
    listMeetings: async () => [{ dir: '/R/a', title: 'Gi e Eu', startedAt: now.toISOString(), state }],
    readMeeting: async () => ({ meta: { title: 'Gi e Eu', startedAt: now.toISOString(), state, notesStatus: 'pending' }, transcript: '', annotations: '', notes: '', chat: [] }),
    startRecording: vi.fn(async () => {
      state = 'recording';
      return { ok: true, dir: '/R/a' };
    }),
    sessionState: vi.fn(async () => ({ state: 'idle', dir: null })),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: (c: string, fn: any) => (handlers[c] = fn),
  };
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'menu-select', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
  g.document.getElementById('rec').click();
  await vi.waitFor(() => expect(g.window.rice.startRecording).toHaveBeenCalled());
  await handlers['session:state']!('recording');
  g.window.rice.sessionState = async () => ({ state: 'recording', dir: '/R/a' });
  state = 'done';
  // o evento de "idle" chega antes de o openMeeting reler o meta: o rótulo já não pode voltar a "Gravar"
  await handlers['session:state']!('idle');
  expect(g.document.getElementById('rec-label').textContent).toBe('Continuar gravação');
});

it('renderer: pergunta feita pelo nub aparece no painel de conversa da reunião aberta', async () => {
  const handlers: Record<string, (p: any) => any> = {};
  await bootMeeting('', { on: (c: string, fn: any) => (handlers[c] = fn) });
  handlers['chat:external']!({ dir: '/R/outra', question: 'não', answer: 'não' });
  expect(g.document.getElementById('messages').textContent).not.toContain('não');
  handlers['chat:external']!({ dir: '/R/a', question: 'e as decisões?', answer: 'Decidimos X.' });
  expect(g.document.getElementById('messages').textContent).toContain('e as decisões?');
  expect(g.document.getElementById('messages').textContent).toContain('Decidimos X.');
});

it('renderer: botões da faixa de título existem e recolher a barra lateral alterna a classe e lembra', async () => {
  g.localStorage.clear();
  await bootMeeting('');
  const toggle = g.document.getElementById('sidebar-toggle');
  expect(toggle).not.toBeNull();
  expect(g.document.getElementById('search-toggle')).toBeNull(); // a lupa saiu da faixa: a busca virou um campo na sidebar
  expect(g.document.getElementById('win-tools').querySelectorAll('button')).toHaveLength(1);
  expect(g.document.getElementById('search-box').closest('aside')).not.toBeNull();
  expect(g.document.body.classList.contains('side-collapsed')).toBe(false);
  toggle.click();
  expect(g.document.body.classList.contains('side-collapsed')).toBe(true);
  expect(g.localStorage.getItem('rice.sidebarCollapsed')).toBe('1');
  toggle.click();
  expect(g.document.body.classList.contains('side-collapsed')).toBe(false);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
});

it('busca da sidebar: campo de verdade com ícone, filtra em tempo real, × e Esc limpam, dica ⌘K some com texto', async () => {
  await bootMeeting('');
  const box = g.document.getElementById('search-box');
  const input = g.document.getElementById('search');
  expect(box.querySelector('svg.icon-search')).not.toBeNull();
  expect(input.placeholder).toBe('Buscar reuniões');
  expect(input.hidden).toBe(false); // sempre visível
  expect(g.document.getElementById('search-hint').hidden).toBe(false); // ⌘K enquanto vazio
  expect(g.document.getElementById('search-clear').hidden).toBe(true);
  expect(g.document.querySelectorAll('.meeting')).toHaveLength(1);
  input.value = 'zzz';
  input.dispatchEvent(new g.window.Event('input'));
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting')).toHaveLength(0));
  expect(g.document.getElementById('list').textContent).toContain('Nenhuma reunião encontrada');
  expect(g.document.getElementById('search-hint').hidden).toBe(true);
  expect(g.document.getElementById('search-clear').hidden).toBe(false);
  input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting')).toHaveLength(1));
  expect(input.value).toBe('');
  expect(g.document.getElementById('search-hint').hidden).toBe(false);
  input.value = 'dai'; // filtra por título, sem diferenciar caixa
  input.dispatchEvent(new g.window.Event('input'));
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting')).toHaveLength(1));
  g.document.getElementById('search-clear').click(); // × limpa e devolve o foco ao campo
  expect(input.value).toBe('');
  expect(g.document.activeElement).toBe(input);
});

it('⌘K foca a busca (e reabre a sidebar recolhida)', async () => {
  await bootMeeting('');
  const press = () => g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
  press();
  expect(g.document.activeElement).toBe(g.document.getElementById('search'));
  g.document.getElementById('sidebar-toggle').click();
  g.document.getElementById('search').blur();
  expect(g.document.body.classList.contains('side-collapsed')).toBe(true);
  press();
  expect(g.document.body.classList.contains('side-collapsed')).toBe(false);
  expect(g.document.activeElement).toBe(g.document.getElementById('search'));
});

it('faixa de título: botão de recolher no-drag, 28×28, centrado com os semáforos (faixa de 48px) e sem lupa', () => {
  const html = readFileSync('src/renderer/index.html', 'utf8');
  expect(html).toContain('--titlebar:48px'); // centro 24px = semáforos em y:18 + 6
  expect(html).toMatch(/\.win-tools \{[^}]*align-items:center/);
  expect(html).toMatch(/\.win-tools \{[^}]*height:var\(--titlebar\)/);
  expect(html).toMatch(/\.icon-btn \{[^}]*width:28px; height:28px/);
  expect(html).toMatch(/\.win-tools button[^{]*\{ -webkit-app-region:no-drag; \}/);
  expect(html).not.toContain('id="search-toggle"');
  expect(readFileSync('src/main/app/main.ts', 'utf8')).toContain('trafficLightPosition: { x: 16, y: 18 }');
  const search = html.split('.search-box {')[1]?.split('}')[0] ?? '';
  for (const p of ['height:30px', 'border-radius:8px', 'background:var(--field-bg)']) expect(search).toContain(p);
});

it('apagar: Enter só confirma com a palavra certa, Esc cancela, "apagar" em destaque', async () => {
  const deleteMeeting = vi.fn(async () => ({ ok: true }));
  await boot({ deleteMeeting });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  openDelete();
  [...g.document.querySelectorAll('[role=dialog] button')].find((b: any) => b.textContent === 'Apagar').click();
  const dialog = g.document.querySelector('[role=dialog]');
  expect(dialog.querySelector('code').textContent).toBe('apagar');
  const input = dialog.querySelector('input');
  const enter = () => input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  input.value = 'apag';
  input.dispatchEvent(new g.window.Event('input'));
  enter();
  expect(deleteMeeting).not.toHaveBeenCalled();
  input.value = 'apagar';
  input.dispatchEvent(new g.window.Event('input'));
  enter();
  await vi.waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith('/R/a'));
  await vi.waitFor(() => expect(g.document.querySelector('[role=dialog]')).toBeNull());
});

it('renderer: título tem lápis "Renomear reunião" que entra em edição; Esc volta sem pular', async () => {
  await bootMeeting('');
  const pencil = g.document.querySelector('.title-row .pencil');
  expect(pencil.getAttribute('aria-label')).toBe('Renomear reunião');
  expect(pencil.title).toBe('Renomear reunião');
  expect(pencil.querySelector('svg')).not.toBeNull();
  pencil.click();
  const input = g.document.querySelector('.title-row input.title-edit');
  expect(input.value).toBe('Daily');
  expect(g.document.getElementById('page-title')).toBeNull();
  input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape' }));
  await vi.waitFor(() => expect(g.document.getElementById('page-title')?.textContent).toBe('Daily'));
  expect(g.document.querySelector('.title-row .pencil')).not.toBeNull();
  g.document.getElementById('page-title').click(); // clicar no título também edita
  expect(g.document.querySelector('.title-row input.title-edit')).not.toBeNull();
});

/** Sobe o renderer com um idioma de app inicial e devolve os handlers dos eventos `window.rice.on`. */
async function bootLang(uiLanguage: string, extra: Record<string, any> = {}, meta: Record<string, any> = {}) {
  const now = new Date();
  const handlers: Record<string, (p: any) => any> = {};
  const rice: any = {
    uiLanguage,
    getSettings: async () => ({ root: '/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage, keepAudio: true, rootDisplay: '~/Rice' }),
    listMeetings: async () => [{ dir: '/R/a', title: 'Daily', startedAt: now.toISOString(), state: 'done' }],
    readMeeting: async () => ({ meta: { title: 'Daily', startedAt: now.toISOString(), state: 'done', notesStatus: 'done', ...meta }, transcript: '', annotations: '', notes: '', chat: [] }),
    listTemplates: vi.fn(async () => ({ templates: [], defaultId: null, warnings: [] })),
    setMeetingLanguage: vi.fn(async () => ({ ok: true })),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    onDelta: () => {},
    on: (c: string, fn: any) => (handlers[c] = fn),
    ...extra,
  };
  g.window.rice = rice;
  g.localStorage.clear();
  g.document.documentElement.innerHTML = readFileSync('src/renderer/index.html', 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'markdown', 'annotations', 'grouping', 'search', 'global-chat', 'toast-stack', 'share', 'onboarding', 'home', 'ai-providers', 'chat-tools', 'calendar-connect', 'menu-select', 'template-preview', 'template-picker', 'templates', 'language-menu', 'action-menu', 'ai-chip', 'web-search', 'update-notice', 'retention-dialog', 'consent-toast', 'receipt-card', 'shortcut-field', 'prompts-menu', 'privacy', 'speaker-popover', 'settings', 'language-settings', 'chips', 'dialog', 'live-scroll', 'attachments', 'screenshots', 'memory', 'memory-page', 'followups', 'warroom', 'resize', 'mic-chip', 'audio-settings', 'renderer']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  return { rice, handlers };
}

it('i18n: o app abre no idioma vindo do main e o HTML estático acompanha', async () => {
  await bootLang('en');
  expect(g.document.getElementById('new').textContent).toBe('New meeting');
  expect(g.document.getElementById('guide-link').textContent).toBe('How to use Rice');
  expect(g.document.getElementById('search').placeholder).toBe('Search meetings');
  expect(g.document.getElementById('rec-label').textContent).toBe('Record');
  expect(g.document.documentElement.lang).toBe('en');
  await vi.waitFor(() => expect(g.document.querySelector('h1').textContent).toBe('Calendar'));
  expect(g.document.querySelector('.group-label').textContent).toBe('Today');
});

it('i18n: trocar o idioma re-renderiza a lista, o início e a reunião aberta na hora', async () => {
  const { handlers } = await bootLang('pt-BR');
  await vi.waitFor(() => expect(g.document.querySelector('h1').textContent).toBe('Agenda'));
  expect(g.document.querySelector('.group-label').textContent).toBe('Hoje');
  await handlers['ui:language']!('en');
  expect(g.document.getElementById('new').textContent).toBe('New meeting');
  await vi.waitFor(() => expect(g.document.querySelector('h1').textContent).toBe('Calendar'));
  await vi.waitFor(() => expect(g.document.querySelector('.group-label').textContent).toBe('Today'));
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.more-btn')).not.toBeNull());
  expect(deleteItem().textContent).toContain('Delete meeting');
  expect(g.document.querySelector('.more-btn').getAttribute('aria-label')).toBe('More actions');
  await handlers['ui:language']!('pt-BR'); // o menu aberto não fica órfão
  expect(g.document.querySelector('.action-menu')).toBeNull();
  await vi.waitFor(() => expect(deleteItem().textContent).toContain('Apagar reunião'));
  g.window.RiceActionMenu.close();
  expect(g.document.getElementById('rec-label').textContent).toBe('Continuar gravação');
});

it('i18n: o diálogo de apagar pede a palavra do idioma (delete em inglês)', async () => {
  const deleteMeeting = vi.fn(async () => ({ ok: true }));
  await bootLang('en', { deleteMeeting });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.more-btn')).not.toBeNull());
  openDelete();
  [...g.document.querySelectorAll('[role=dialog] button')].find((b: any) => b.textContent === 'Delete').click();
  const dialog = g.document.querySelector('[role=dialog]');
  expect(dialog.querySelector('code').textContent).toBe('delete');
  const final = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Move to Trash') as any;
  const input = dialog.querySelector('input');
  input.value = 'apagar';
  input.dispatchEvent(new g.window.Event('input'));
  expect(final.disabled).toBe(true);
  input.value = 'delete';
  input.dispatchEvent(new g.window.Event('input'));
  expect(final.disabled).toBe(false);
});


/** Abre o menu do chip de idioma e (opcional) o submenu pelo nome; devolve os itens do último painel aberto. */
async function langMenu(submenu?: string) {
  g.document.querySelector('.lang-chip').click();
  await vi.waitFor(() => expect(g.document.querySelector('.action-menu .action-item')).not.toBeNull());
  if (!submenu) return [...g.document.querySelectorAll('.action-menu:not(.submenu) .action-item')] as any[];
  [...g.document.querySelectorAll('.action-menu .action-item')].find((i: any) => i.textContent.trim() === submenu).click();
  return [...g.document.querySelectorAll('.action-menu.submenu .action-item')] as any[];
}

it('idioma por reunião: o chip único abre "Idioma das reuniões ▸" com "Esta reunião" (✓ no padrão), salva em meta.language e trava durante a gravação', async () => {
  const sessionState = vi.fn(async () => ({ state: 'idle', dir: null as string | null }));
  const { rice, handlers } = await bootLang('pt-BR', { sessionState });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
  const chip = () => g.document.querySelector('.lang-chip') as any;
  expect(chip().textContent).toBe('PT'); // idioma da interface
  expect(chip().querySelector('svg.icon-globe')).not.toBeNull();
  expect(chip().querySelector('svg.caret')).not.toBeNull();
  expect(g.document.querySelectorAll('.lang-chip')).toHaveLength(1);
  const top = await langMenu();
  expect(top.map((i) => i.textContent.trim())).toEqual(['Idioma do app', 'Idioma das reuniões', 'Mais opções em Configurações']);
  const items = await langMenu('Idioma das reuniões').catch(() => []);
  void items;
  g.window.RiceActionMenu.close();
  const sub = await langMenu('Idioma das reuniões');
  expect(sub.map((i) => i.textContent.trim())).toEqual(['Português', 'English', 'Automático', 'Português', 'English', 'Automático']);
  expect(g.document.querySelectorAll('.action-menu.submenu .menu-heading')).toHaveLength(2);
  expect([...g.document.querySelectorAll('.action-menu.submenu .menu-heading')].map((h: any) => h.textContent)).toEqual(['Esta reunião', 'Padrão']);
  expect(sub.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', null, null, 'true', null, null]); // ✓ no padrão (pt) nas duas seções
  sub[1].click(); // Esta reunião → English
  await vi.waitFor(() => expect(rice.setMeetingLanguage).toHaveBeenCalledWith('/R/a', 'en'));
  await vi.waitFor(() => expect(g.document.activeElement).toBe(chip())); // o foco volta ao chip
  // gravando esta reunião: os itens de "Esta reunião" ficam desabilitados, com a dica; o padrão continua livre
  sessionState.mockImplementation(async () => ({ state: 'recording', dir: '/R/a' }));
  await handlers['session:state']!('recording');
  await vi.waitFor(() => expect(g.document.getElementById('rec-label').textContent).toBe('Parar'));
  expect(chip().disabled).toBe(false); // o idioma do app continua trocável
  const locked = await langMenu('Idioma das reuniões');
  expect(locked.map((i) => i.classList.contains('disabled'))).toEqual([true, true, true, false, false, false]);
  expect(locked[0].title).toContain('durante a gravação');
  g.window.RiceActionMenu.close();
  sessionState.mockImplementation(async () => ({ state: 'idle', dir: null }));
  await handlers['session:state']!('idle');
  await vi.waitFor(() => expect(g.document.getElementById('rec-label').textContent).not.toBe('Parar'));
});

it('idioma: o chip está em TODAS as telas, no mesmo lugar; fora de uma reunião o submenu muda o PADRÃO das próximas', async () => {
  const { rice } = await bootLang('en', { setTranscriptionLanguage: vi.fn(async () => ({ ok: true })), aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }), asrStatus: async () => ({ state: 'ready' }), permissionStatus: async () => ({ microphone: 'granted' }) }, { language: 'auto' });
  const where = () => g.document.querySelector('#rec-bar #lang-slot .lang-chip');
  expect(where()).not.toBeNull(); // Início
  expect(where().textContent).toBe('EN');
  expect(where().title).toBe('Language');
  const sub = await langMenu('Meetings language');
  expect(sub.map((i) => i.textContent.trim())).toEqual(['Portuguese', 'English', 'Automatic']); // sem seção "Esta reunião" fora de uma reunião
  expect(g.document.querySelector('.action-menu.submenu .menu-heading')).toBeNull();
  sub[1].click();
  await vi.waitFor(() => expect(rice.setTranscriptionLanguage).toHaveBeenCalledWith('en'));
  expect(rice.setMeetingLanguage).not.toHaveBeenCalled();
  g.window.RiceActionMenu.close();
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
  expect(where()).not.toBeNull();
  const inMeeting = await langMenu('Meetings language');
  expect(inMeeting.map((i) => i.getAttribute('aria-checked'))).toEqual([null, null, 'true', 'true', null, null]); // meta.language (auto) manda em "This meeting"; o padrão é pt
  g.window.RiceActionMenu.close();
  for (const id of ['settings-link', 'templates-link', 'guide-link', 'home-link']) {
    g.document.getElementById(id).click();
    await vi.waitFor(() => expect(g.document.getElementById(id).classList.contains('active')).toBe(true));
    expect(where(), id).not.toBeNull();
    expect(g.document.querySelectorAll('.lang-chip'), id).toHaveLength(1);
  }
});

it('idioma do app pelo menu: chama setUiLanguage e "Mais opções" abre Configurações', async () => {
  const { rice } = await bootLang('pt-BR', { setUiLanguage: vi.fn(async () => ({ ok: true })) });
  const sub = await langMenu('Idioma do app');
  expect(sub.map((i) => `${i.textContent.trim()}:${i.getAttribute('aria-checked')}`)).toEqual(['Português:true', 'English:null']);
  sub[1].click();
  await vi.waitFor(() => expect(rice.setUiLanguage).toHaveBeenCalledWith('en'));
  sub[0].click(); // o idioma atual não faz nada
  expect(rice.setUiLanguage).toHaveBeenCalledTimes(1);
  g.window.RiceActionMenu.close();
  const top = await langMenu();
  top[2].click();
  await vi.waitFor(() => expect(g.document.querySelector('h1').textContent).toBe('Configurações'));
});

it('Configurações: seções de idioma, pasta, IA e áudio; trocar idioma e manter áudio chamam o IPC', async () => {
  const rice = {
    setUiLanguage: vi.fn(async () => ({ ok: true })),
    setTranscriptionLanguage: vi.fn(async () => ({ ok: true })),
    setKeepAudio: vi.fn(async () => ({ ok: true })),
    revealRoot: vi.fn(async () => ({ ok: true })),
    chooseRoot: vi.fn(async () => ({})),
    aiStatus: async () => ({ active: 'chatgpt-sub', models: {}, providers: {} }),
  };
  await bootLang('pt-BR', rice);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.setting-section')).not.toBeNull());
  expect(g.document.getElementById('settings-link').classList.contains('active')).toBe(true);
  const text = g.document.getElementById('detail').textContent;
  for (const part of ['Configurações', 'Idioma do app', 'Idioma das reuniões', 'Uma língua fixa dá a melhor qualidade', '~/Rice', 'ChatGPT', 'Manter o áudio das reuniões']) expect(text).toContain(part);
  expect(g.document.querySelectorAll('select')).toHaveLength(0);
  const groups = [...g.document.querySelectorAll('[role=radiogroup]')] as any[];
  expect(groups).toHaveLength(2);
  expect([...groups[0].querySelectorAll('[role=radio]')].map((b: any) => b.textContent)).toEqual(['Português', 'English']);
  expect([...groups[1].querySelectorAll('[role=radio]')].map((b: any) => b.textContent)).toEqual(['Português', 'English', 'Automático']);
  groups[1].querySelectorAll('[role=radio]')[2].click();
  await vi.waitFor(() => expect(rice.setTranscriptionLanguage).toHaveBeenCalledWith('auto'));
  const appGroup = () => g.document.querySelector('[role=radiogroup]') as any;
  appGroup().querySelectorAll('[role=radio]')[1].click();
  await vi.waitFor(() => expect(rice.setUiLanguage).toHaveBeenCalledWith('en'));
  const keep = g.document.getElementById('keep-audio');
  keep.checked = false;
  keep.onchange();
  expect(rice.setKeepAudio).toHaveBeenCalledWith(false);
});

it('Configurações: seção Vocabulário salva os termos e a opção dos participantes da agenda', async () => {
  const rice = {
    setVocabulary: vi.fn(async () => ({ ok: true })),
    aiStatus: async () => ({ active: 'chatgpt-sub', models: {}, providers: {} }),
  };
  await bootLang('pt-BR', rice);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.setting-section')).not.toBeNull());
  const text = g.document.getElementById('detail').textContent;
  expect(text).toContain('Vocabulário');
  expect(text).not.toContain('Uirapuru');
  const input = g.document.getElementById('vocab-input');
  expect(input.placeholder).toBe('Adicionar termo e Enter');
  expect(g.document.querySelector('#set-vocabulary textarea')).toBeNull(); // sem textarea: é um campo de chips (o texto do aviso de consentimento mora em Privacidade)
  for (const term of ['Uirapuru Tecnologia', 'OKR']) {
    input.value = term;
    input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  const attendees = g.document.getElementById('vocab-attendees');
  expect(attendees.checked).toBe(true);
  attendees.checked = false;
  attendees.onchange();
  await vi.waitFor(() => expect(rice.setVocabulary).toHaveBeenLastCalledWith('Uirapuru Tecnologia\nOKR', false));
  expect(rice.setVocabulary).toHaveBeenCalledTimes(1); // salvamento com debounce
});

it('Configurações: abre pelo menu do app (app:open-settings) e o atalho de IA abre o passo de provedores', async () => {
  const { handlers } = await bootLang('en', { aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }) });
  await handlers['app:open-settings']!(null);
  await vi.waitFor(() => expect(g.document.querySelector('h1').textContent).toBe('Settings'));
  expect(g.document.getElementById('detail').textContent).toContain('Meetings language');
  expect(g.document.getElementById('detail').textContent).toContain('Choose the language spoken in your meetings.');
});

/** Regiões `-webkit-app-region` declaradas no <style> do index.html, em ordem (a última regra que casa vence). */
function appRegionRules(): Array<{ selector: string; value: string }> {
  const html = readFileSync('src/renderer/index.html', 'utf8');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Array<{ selector: string; value: string }> = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const value = /-webkit-app-region\s*:\s*(drag|no-drag)/.exec(m[2]!)?.[1];
    if (!value) continue;
    for (const selector of m[1]!.split(',')) rules.push({ selector: selector.trim(), value });
  }
  return rules;
}

/** Região efetiva (no macOS ela vale para o elemento e seus filhos): a do ancestral mais próximo que declara uma. */
function effectiveRegion(el: any, rules: Array<{ selector: string; value: string }>): 'drag' | 'no-drag' | 'none' {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    let found: string | null = null;
    for (const r of rules) {
      try {
        if (node.matches(r.selector)) found = r.value;
      } catch {
        // seletor que o happy-dom não entende: ignora
      }
    }
    if (found) return found as 'drag' | 'no-drag';
  }
  return 'none';
}

it('regressão: nada clicável nem popover aberto fica sob região de arrasto (drag) da janela', async () => {
  const now = new Date();
  const geral = { id: 'geral', title: 'Reunião geral', icon: 'file-text', builtin: true, description: 'Geral', sections: [{ heading: 'Resumo', description: 'x' }] };
  const retro = { id: 'retro', title: 'Retro', icon: 'file-text', builtin: false, description: 'Retro', sections: [{ heading: 'Bom', description: 'b' }] };
  await bootLang('pt-BR', { listTemplates: async () => ({ templates: [geral, retro], defaultId: 'geral', warnings: [] }) }, { notesStatus: 'done' });
  const rules = appRegionRules();
  expect(rules.length).toBeGreaterThan(3);
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.lang-chip')).not.toBeNull());
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-chip')).not.toBeNull());
  g.document.querySelector('.lang-chip').click(); // menu de idioma aberto
  await vi.waitFor(() => expect(g.document.querySelector('.action-menu')).not.toBeNull());
  g.document.querySelector('.tpl-chip').click(); // popover de template aberto
  expect(g.document.querySelector('.action-menu')).not.toBeNull();
  expect(g.document.querySelector('.tpl-popover')).not.toBeNull();

  const interactive = 'button, a, input, select, textarea, [tabindex], .menu-item, .tpl-opt, [role=option]';
  const offenders: string[] = [];
  const check = (node: any, why: string) => {
    if (effectiveRegion(node, rules) === 'drag') offenders.push(`${why}: <${node.tagName.toLowerCase()} class="${node.className}">`);
  };
  for (const node of g.document.querySelectorAll(interactive)) check(node, 'interativo');
  for (const pop of g.document.querySelectorAll('[class*="popover"], [role=menu], [role=listbox]')) {
    check(pop, 'popover');
    for (const child of pop.querySelectorAll('*')) check(child, 'dentro de popover');
  }
  expect(offenders).toEqual([]);

  // tela de Configurações: o <select> de idioma do app não está sob drag
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('[role=radiogroup]')).not.toBeNull());
  expect(g.document.querySelectorAll('select')).toHaveLength(0);
  for (const radio of g.document.querySelectorAll('[role=radio]')) expect(effectiveRegion(radio, rules)).not.toBe('drag');
});

it('regressão (sanidade): a checagem pega um popover sem no-drag dentro da faixa de título', () => {
  const rules = appRegionRules();
  const bar = g.document.createElement('div');
  bar.id = 'rec-bar';
  const pop = g.document.createElement('div');
  pop.className = 'meu-menu'; // sem regra no-drag
  const opt = g.document.createElement('div');
  pop.append(opt);
  bar.append(pop);
  g.document.body.append(bar);
  expect(effectiveRegion(opt, rules)).toBe('drag');
  pop.className = 'meu-popover'; // regra genérica [class*="popover"]
  expect(effectiveRegion(opt, rules)).toBe('no-drag');
  bar.remove();
});


function describe_lang_regressions() {
  it('troca de idioma: diálogo aberto é fechado (não fica misturado em dois idiomas)', async () => {
    const { handlers } = await bootLang('pt-BR');
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.querySelector('.more-btn')).not.toBeNull());
    openDelete();
    expect(g.document.querySelector('.overlay')).not.toBeNull();
    await handlers['ui:language']!('en');
    expect(g.document.querySelector('.overlay')).toBeNull();
    expect(deleteItem().textContent).toContain('Delete meeting');
    g.window.RiceActionMenu.close();
  });

  it('troca de idioma: popovers abertos somem (sem órfão) e o foco volta ao mesmo campo', async () => {
    const rice = { aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }), setUiLanguage: vi.fn(async () => ({ ok: true })) };
    const { handlers } = await bootLang('pt-BR', rice);
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.querySelector('.lang-chip')).not.toBeNull());
    await langMenu('Idioma do app'); // menu e submenu abertos
    expect(g.document.querySelectorAll('.action-menu').length).toBe(2);
    await handlers['ui:language']!('en');
    expect(g.document.querySelectorAll('.action-menu')).toHaveLength(0);
    expect(g.document.querySelector('.lang-chip').textContent).toBe('EN'); // o chip acompanha o idioma novo
    expect(g.document.querySelectorAll('.lang-chip')).toHaveLength(1);
    // Configurações: o select do idioma do app mantém o foco depois de re-renderizar
    g.document.getElementById('settings-link').click();
    await vi.waitFor(() => expect(g.document.querySelector('button[name=ui-language][aria-checked=true]')).not.toBeNull());
    g.document.querySelector('button[name=ui-language][aria-checked=true]').focus();
    await handlers['ui:language']!('pt-BR');
    expect(g.document.activeElement?.getAttribute('name')).toBe('ui-language');
    expect(g.document.activeElement?.getAttribute('aria-checked')).toBe('true');
    expect(g.document.querySelector('h1').textContent).toBe('Configurações');
  });

  it('idioma da reunião: escolher uma opção devolve o foco ao chip', async () => {
    await bootLang('pt-BR');
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.getElementById('page-title')).not.toBeNull());
    const sub = await langMenu('Idioma das reuniões');
    sub[1].click();
    await vi.waitFor(() => expect(g.document.querySelector('.lang-chip')).toBe(g.document.activeElement));
  });

  it('troca de idioma: textos de status (download do modelo) são refeitos no idioma novo', async () => {
    const { handlers } = await bootLang('pt-BR');
    handlers['asr:status']!({ state: 'loading' });
    handlers['asr:download-progress']!({ receivedBytes: 50, totalBytes: 100 });
    expect(g.document.getElementById('status').textContent).toContain('Baixando modelo de transcrição: 50%');
    await handlers['ui:language']!('en');
    expect(g.document.getElementById('status').textContent).toContain('Downloading transcription model: 50%');
    expect(g.document.getElementById('status').textContent).not.toContain('Baixando');
  });

  it('troca de idioma durante a gravação: transcrição e botão Parar preservados, seletor continua desabilitado', async () => {
    const sessionState = vi.fn(async () => ({ state: 'recording', dir: '/R/a' }));
    const readMeeting = vi.fn(async () => ({
      meta: { title: 'Daily', startedAt: new Date().toISOString(), state: 'recording', notesStatus: 'pending' },
      transcript: '**[09:00:01] Eu:** bom dia\n\n', annotations: '', notes: '', chat: [],
    }));
    const { handlers } = await bootLang('pt-BR', { sessionState, readMeeting });
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.querySelector('.lang-chip')).not.toBeNull());
    await handlers['session:state']!('recording');
    await vi.waitFor(() => expect(g.document.getElementById('rec-label').textContent).toBe('Parar'));
    await handlers['ui:language']!('en');
    expect(g.document.getElementById('rec-label').textContent).toBe('Stop');
    const locked = await langMenu('Meetings language');
    expect(locked.slice(0, 3).every((i) => i.classList.contains('disabled'))).toBe(true); // continua travado
    g.window.RiceActionMenu.close();
    expect(g.document.querySelector('.transcript').textContent).toContain('bom dia');
  });
}

describe_lang_regressions();

it('lista lateral: o ⋯ abre o menu sem abrir a reunião; Apagar usa o dir certo e fecha para o Início', async () => {
  const deleteMeeting = vi.fn(async () => ({ ok: true }));
  const reveal = vi.fn();
  await bootLang('pt-BR', { deleteMeeting, reveal });
  // abre outra tela para provar que o ⋯ NÃO abre a reunião
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('h1').textContent).toBe('Configurações'));
  const more = g.document.querySelector('.meeting .m-more') as any;
  expect(more.getAttribute('aria-label')).toBe('Mais ações');
  more.click();
  expect(g.document.querySelector('h1').textContent).toBe('Configurações'); // continua em Configurações
  expect(g.document.getElementById('page-title')).toBeNull();
  const items = [...g.document.querySelectorAll('.action-menu .action-item')] as any[];
  expect(items.map((i) => i.textContent.trim())).toEqual(['Renomear', 'Abrir pasta no Finder', 'Mover para pasta', 'Compartilhar', 'O que saiu deste computador', 'Apagar reunião']);
  expect(items[5].classList.contains('danger')).toBe(true);
  items[1].click();
  expect(reveal).toHaveBeenCalledWith('/R/a');
  g.document.querySelector('.meeting .m-more').click();
  [...g.document.querySelectorAll('.action-menu .action-item')][5].click();
  const dialog = g.document.querySelector('[role=dialog]');
  expect(dialog.textContent).toContain('Apagar “Daily”?');
  [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Apagar').click();
  const input = dialog.querySelector('input');
  input.value = 'apagar';
  input.dispatchEvent(new g.window.Event('input'));
  [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Mover para a Lixeira').click();
  await vi.waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith('/R/a'));
});

it('lista lateral: clique direito abre o mesmo menu; Renomear edita na lista; Esc fecha', async () => {
  await bootLang('pt-BR');
  const item = g.document.querySelector('.meeting') as any;
  item.dispatchEvent(new g.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 90 }));
  expect(g.document.querySelectorAll('.action-menu')).toHaveLength(1);
  g.document.querySelector('.action-menu').dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(g.document.querySelector('.action-menu')).toBeNull();
  item.dispatchEvent(new g.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 90 }));
  [...g.document.querySelectorAll('.action-menu .action-item')][0].click(); // Renomear
  expect(g.document.querySelector('.meeting input.title-edit')).not.toBeNull();
});

it('menu ⋯ da reunião: Renomear entra na edição do título; Apagar fica desabilitado, com tooltip, durante a gravação da reunião', async () => {
  const sessionState = vi.fn(async () => ({ state: 'idle', dir: null as string | null }));
  const { handlers } = await bootLang('pt-BR', { sessionState });
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.more-btn')).not.toBeNull());
  expect(g.document.getElementById('delete-meeting')).toBeNull();
  expect([...g.document.querySelectorAll('.page-actions button')].map((b: any) => b.textContent)).not.toContain('Abrir pasta no Finder');
  g.document.querySelector('.more-btn').click();
  [...g.document.querySelectorAll('.action-item')][0].click(); // Renomear
  expect(g.document.querySelector('.title-row input.title-edit')).not.toBeNull();
  g.document.querySelector('.title-row input.title-edit').dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape' }));
  // gravando esta reunião
  sessionState.mockImplementation(async () => ({ state: 'recording', dir: '/R/a' }));
  await handlers['session:state']!('recording');
  await vi.waitFor(() => expect(g.document.getElementById('rec-label').textContent).toBe('Parar'));
  const del = deleteItem();
  expect(del.classList.contains('disabled')).toBe(true);
  expect(del.getAttribute('aria-disabled')).toBe('true');
  expect(del.title).toBe('Pare a gravação antes de apagar.');
  del.click();
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  // a lista também desabilita
  g.window.RiceActionMenu.close();
  g.document.querySelector('.meeting .m-more').click();
  expect([...g.document.querySelectorAll('.action-menu .action-item')].find((i: any) => i.classList.contains('danger')).classList.contains('disabled')).toBe(true);
  g.window.RiceActionMenu.close();
});

it('⌘⌫ com a reunião aberta abre o diálogo de apagar (não em campos de texto)', async () => {
  await bootLang('pt-BR');
  const press = (target: any) => target.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true, cancelable: true }));
  press(g.document.body); // sem reunião aberta: nada
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.more-btn')).not.toBeNull());
  const area = g.document.querySelector('textarea');
  press(area); // digitando: apagar texto, não a reunião
  expect(g.document.querySelector('[role=dialog]')).toBeNull();
  press(g.document.body);
  expect(g.document.querySelector('[role=dialog]')?.textContent).toContain('Apagar “Daily”?');
});

it('regressão de arrasto: ⋯ e o menu de ações não ficam sob região drag', async () => {
  await bootLang('pt-BR');
  const rules = appRegionRules();
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.more-btn')).not.toBeNull());
  g.document.querySelector('.more-btn').click();
  for (const node of g.document.querySelectorAll('.more-btn, .action-menu, .action-menu *')) expect(effectiveRegion(node, rules), node.className).not.toBe('drag');
  g.window.RiceActionMenu.close();
});

it('regressão de arrasto (ordem do DOM): .win-tools vem depois de toda região drag e nenhuma região drag cobre os botões da faixa', async () => {
  await bootLang('pt-BR');
  const rules = appRegionRules();
  const follows = (a: any, b: any) => Boolean(a.compareDocumentPosition(b) & 4); // 4 = DOCUMENT_POSITION_FOLLOWING (b vem depois de a)
  const tools = g.document.getElementById('win-tools');
  // elementos com região drag declarada no CSS (por seletor), qualquer que seja
  const dragSelectors = rules.filter((r) => r.value === 'drag').map((r) => r.selector);
  const dragEls: any[] = [];
  for (const sel of dragSelectors) for (const el of g.document.querySelectorAll(sel)) dragEls.push(el);
  expect(dragEls.length).toBeGreaterThanOrEqual(3); // .side-drag-left, .side-drag-right, #rec-bar
  for (const d of dragEls) {
    if (d.contains(tools)) continue;
    expect(follows(d, tools), `.win-tools deve vir depois de ${d.className || d.id} no DOM`).toBe(true);
  }
  // nenhum elemento drag POSTERIOR aos botões da faixa (que não seja ancestral deles) pode existir
  for (const button of tools.querySelectorAll('button')) {
    for (const d of dragEls) expect(!d.contains(button) && follows(button, d), `${d.className || d.id} vem depois de #${button.id}`).toBe(false);
    expect(effectiveRegion(button, rules)).toBe('no-drag');
  }
  // a faixa da sidebar é recortada: o trecho direito começa depois dos semáforos + botões
  const html = readFileSync('src/renderer/index.html', 'utf8');
  expect(html).toMatch(/\.side-drag-right \{[^}]*left:calc\(var\(--tools-left\) \+ var\(--tools-width\)\)/);
  expect(html).toMatch(/\.side-drag-left \{[^}]*width:var\(--tools-left\)/);
  expect(html).not.toMatch(/\.side-drag \{[^}]*(?:left:0;[^}]*right:0)/); // não é mais uma faixa única de ponta a ponta
  const buttons = [...tools.querySelectorAll('button')].length;
  expect(buttons).toBe(1);
  expect(html).toMatch(/--tools-width:4\d?px/); // 1 botão de 28px + folga
  // a ordem vale também para o body: win-tools é o último elemento antes dos scripts
  const afterTools = [...g.document.body.children].slice([...g.document.body.children].indexOf(tools) + 1);
  expect(afterTools.every((n: any) => n.tagName === 'SCRIPT')).toBe(true);
});

it('templates embutidos aparecem no idioma do APP em todas as telas (não no idioma falado da reunião)', async () => {
  const listTemplates = vi.fn(async () => ({ templates: [{ id: 'geral', title: 'General meeting', icon: 'file-text', builtin: true, description: 'A work meeting', sections: [{ heading: 'Summary', description: 'x' }] }], defaultId: 'geral', warnings: [] }));
  await bootLang('en', { listTemplates }, { language: 'pt' }); // app em inglês, reunião falada em português
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-chip')).not.toBeNull());
  expect(listTemplates).toHaveBeenCalledWith(); // sem forçar o idioma da reunião: o main usa o do app
  expect(g.document.querySelector('.tpl-chip').textContent).toBe('General meeting');
  g.document.getElementById('templates-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.tpl-block')).not.toBeNull());
  expect(g.document.querySelector('.tpl-name').textContent).toBe('General meeting');
  expect(listTemplates).toHaveBeenLastCalledWith();
});

function describe_folders() {
  const meetings = (extra: Record<string, any> = {}) => [
    { dir: '/R/a', title: 'Daily', startedAt: new Date().toISOString(), state: 'done', ...extra },
    { dir: '/R/b', title: 'Weekly', startedAt: new Date().toISOString(), state: 'done' },
  ];
  const folderApi = (folders: any[], over: Record<string, any> = {}) => ({
    listFolders: vi.fn(async () => folders),
    createFolder: vi.fn(async (name: string) => ({ ok: true, value: { id: 'novo', name, createdAt: '', order: 9 } })),
    renameFolder: vi.fn(async () => ({ ok: true, value: {} })),
    deleteFolder: vi.fn(async () => ({ ok: true, value: undefined })),
    reorderFolders: vi.fn(async () => ({ ok: true, value: [] })),
    moveFolder: vi.fn(async () => ({ ok: true, value: {} })),
    setMeetingFolder: vi.fn(async () => ({ ok: true })),
    createMeeting: vi.fn(async () => '/R/nova'),
    ...over,
  });
  const F1 = { id: 'f1', name: 'Clientes', createdAt: '', order: 0 };
  const F2 = { id: 'f2', name: 'Time', createdAt: '', order: 1 };
  const boot2 = async (list: any[], extra: Record<string, any>) => {
    const out = await bootLang('pt-BR', { listMeetings: async () => list, ...extra });
    await vi.waitFor(() => expect(g.document.querySelector('.folder-row')).not.toBeNull());
    return out;
  };

  it('pastas: a reunião com pasta aparece só dentro dela (sem duplicar na lista por data) e a contagem mostra', async () => {
    await boot2(meetings({ folderId: 'f1' }), folderApi([F1, F2]));
    const blocks = [...g.document.querySelectorAll('.folder-block')] as any[];
    expect(blocks.map((b) => b.querySelector('.folder-name').textContent)).toEqual(['Clientes', 'Time']);
    expect(blocks[0].querySelectorAll('.folder-children .meeting')).toHaveLength(1);
    expect(blocks[0].querySelector('.folder-children .m-title').textContent).toBe('Daily');
    expect(blocks[0].querySelector('.folder-count').textContent).toBe('1');
    expect(blocks[1].querySelector('.folder-count').textContent).toBe('0');
    expect([...g.document.querySelectorAll('#list .meeting .m-title')].map((n: any) => n.textContent)).toEqual(['Weekly']); // só as sem pasta
    expect(g.document.querySelector('.folders-title').textContent).toBe('Pastas');
    expect(g.document.querySelector('#folder-new svg.icon-folder-plus')).not.toBeNull();
  });

  it('pastas: recolher persiste no localStorage e some com as reuniões; expandir de novo', async () => {
    await boot2(meetings({ folderId: 'f1' }), folderApi([F1]));
    g.document.querySelector('.folder-toggle').click();
    await vi.waitFor(() => expect(g.document.querySelector('.folder-block.collapsed')).not.toBeNull());
    expect(JSON.parse(g.localStorage.getItem('rice.folderCollapsed'))).toEqual({ f1: true });
    expect(g.document.querySelector('.folder-children')).toBeNull();
    expect(g.document.querySelector('.folder-toggle').getAttribute('aria-expanded')).toBe('false');
    g.document.querySelector('.folder-toggle').click();
    await vi.waitFor(() => expect(g.document.querySelector('.folder-children .meeting')).not.toBeNull());
    expect(JSON.parse(g.localStorage.getItem('rice.folderCollapsed'))).toEqual({});
  });

  it('pastas: o menu "Mover para pasta ▸" lista as pastas (✓ na atual), move, cria e remove da pasta', async () => {
    const api = folderApi([F1, F2]);
    await boot2(meetings({ folderId: 'f1' }), api);
    const more = () => g.document.querySelectorAll('#list .meeting .m-more')[0] as any; // Weekly (sem pasta)
    more().click();
    const move = [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes('Mover para pasta')) as any;
    expect(move.getAttribute('aria-haspopup')).toBe('menu');
    move.click();
    const sub = g.document.querySelector('.action-menu.submenu');
    expect([...sub.querySelectorAll('.action-item')].map((i: any) => i.textContent.trim())).toEqual(['Clientes', 'Time', 'Nova pasta…']);
    expect(sub.querySelector('[aria-checked=true]')).toBeNull(); // Weekly não está em pasta
    [...sub.querySelectorAll('.action-item')][1].click(); // Time
    await vi.waitFor(() => expect(api.setMeetingFolder).toHaveBeenCalledWith('/R/b', 'f2'));
    expect(g.document.querySelector('.action-menu')).toBeNull();
    // Daily está em Clientes: ✓ na atual e "Remover da pasta"
    g.document.querySelector('.folder-children .m-more').click();
    [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes('Mover para pasta')).click();
    const sub2 = g.document.querySelector('.action-menu.submenu');
    expect(sub2.querySelector('[aria-checked=true]').textContent).toContain('Clientes');
    const unfile = [...sub2.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes('Remover da pasta')) as any;
    unfile.click();
    await vi.waitFor(() => expect(api.setMeetingFolder).toHaveBeenCalledWith('/R/a', null));
    // Nova pasta…: pergunta o nome, cria e move
    more().click();
    [...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent.includes('Mover para pasta')).click();
    [...g.document.querySelectorAll('.action-menu.submenu .action-item')].find((i: any) => i.textContent.includes('Nova pasta…')).click();
    const input = g.document.querySelector('[role=dialog] input');
    input.value = 'Estudos';
    input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('Estudos'));
    await vi.waitFor(() => expect(api.setMeetingFolder).toHaveBeenCalledWith('/R/b', 'novo'));
  });

  it('pastas: submenu abre com → e fecha com ←/Esc sem fechar o menu inteiro', async () => {
    await boot2(meetings(), folderApi([F1]));
    g.document.querySelectorAll('#list .meeting .m-more')[0].click();
    const root = g.document.querySelector('.action-menu:not(.submenu)');
    const items = [...root.querySelectorAll('.action-item')] as any[];
    const key = (node: any, k: string) => node.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key(root, 'ArrowDown'); key(root, 'ArrowDown'); // Mover para pasta
    expect(items[2].classList.contains('active')).toBe(true);
    key(root, 'ArrowRight');
    expect(g.document.querySelector('.action-menu.submenu')).not.toBeNull();
    key(g.document.querySelector('.action-menu.submenu'), 'ArrowLeft');
    expect(g.document.querySelector('.action-menu.submenu')).toBeNull();
    expect(g.document.querySelector('.action-menu')).not.toBeNull(); // o principal continua
    key(root, 'Escape');
    expect(g.document.querySelector('.action-menu')).toBeNull();
  });

  it('pastas: soltar a reunião numa pasta chama o IPC só com o dir e o id; soltar fora tira da pasta; soltar pasta reordena', async () => {
    const api = folderApi([F1, F2]);
    await boot2(meetings({ folderId: 'f1' }), api);
    const drop = (target: any, data: Record<string, string>) => {
      const e: any = new g.window.Event('drop', { bubbles: true, cancelable: true });
      e.dataTransfer = { getData: (type: string) => data[type] ?? '', types: Object.keys(data) };
      target.dispatchEvent(e);
    };
    const over = (target: any, types: string[]) => {
      const e: any = new g.window.Event('dragover', { bubbles: true, cancelable: true });
      e.dataTransfer = { types };
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const rows = [...g.document.querySelectorAll('.folder-row')] as any[];
    expect(over(rows[1], ['application/x-rice-meeting'])).toBe(true); // aceita soltar
    expect(rows[1].classList.contains('drop-target')).toBe(true); // pasta destino destacada
    expect(over(rows[1], ['text/plain'])).toBe(false); // outros dados não
    drop(rows[1], { 'application/x-rice-meeting': '/R/b' });
    await vi.waitFor(() => expect(api.setMeetingFolder).toHaveBeenCalledWith('/R/b', 'f2'));
    drop(g.document.getElementById('list'), { 'application/x-rice-meeting': '/R/a' });
    await vi.waitFor(() => expect(api.setMeetingFolder).toHaveBeenCalledWith('/R/a', null));
    drop([...g.document.querySelectorAll('.folder-row')][0], { 'application/x-rice-folder': 'f2' }); // no meio da linha: Time vira subpasta de Clientes
    await vi.waitFor(() => expect(api.moveFolder).toHaveBeenCalledWith('f2', 'f1'));
    const item = g.document.querySelector('#list .meeting') as any;
    expect(item.draggable).toBe(true);
    const start: any = new g.window.Event('dragstart', { bubbles: true });
    const sent: Record<string, string> = {};
    start.dataTransfer = { setData: (t: string, v: string) => (sent[t] = v), effectAllowed: '' };
    item.dispatchEvent(start);
    expect(sent).toEqual({ 'application/x-rice-meeting': '/R/b' }); // só o dir viaja
  });

  it('pastas: "Nova reunião nesta pasta" passa o folderId; Renomear e Apagar pasta (com confirmação simples)', async () => {
    const api = folderApi([F1]);
    await boot2(meetings({ folderId: 'f1' }), api);
    const openMenu = () => g.document.querySelector('.folder-row .f-more').click();
    openMenu();
    expect([...g.document.querySelectorAll('.action-item')].map((i: any) => i.textContent.trim())).toEqual(['Renomear', 'Nova reunião nesta pasta', 'Nova subpasta', 'Mover para', 'Pasta sensível', 'Tempo de guarda…', 'Apagar pasta']);
    [...g.document.querySelectorAll('.action-item')][1].click();
    await vi.waitFor(() => expect(api.createMeeting).toHaveBeenCalledWith('', undefined, 'f1'));
    openMenu();
    [...g.document.querySelectorAll('.action-item')][0].click(); // Renomear inline
    const input = g.document.querySelector('.folder-row input.title-edit');
    input.value = 'Clientes VIP';
    input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('f1', 'Clientes VIP'));
    await vi.waitFor(() => expect(g.document.querySelector('.folder-row .f-more')).not.toBeNull());
    openMenu();
    [...g.document.querySelectorAll('.action-item')][6].click(); // Apagar pasta
    const dialog = g.document.querySelector('[role=dialog]');
    expect(dialog.textContent).toContain('As reuniões dela não são apagadas');
    expect(dialog.querySelector('input')).toBeNull(); // confirmação simples, sem digitar
    [...dialog.querySelectorAll('button')].find((b: any) => b.textContent === 'Apagar pasta').click();
    await vi.waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('f1'));
  });

  it('pastas: criar inline — Enter cria, Esc ou vazio cancela', async () => {
    const api = folderApi([F1]);
    await boot2(meetings(), api);
    g.document.getElementById('folder-new').click();
    let input = g.document.querySelector('.folder-new input');
    expect(g.document.activeElement).toBe(input);
    input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(g.document.querySelector('.folder-new')).toBeNull());
    expect(api.createFolder).not.toHaveBeenCalled();
    g.document.getElementById('folder-new').click();
    input = g.document.querySelector('.folder-new input');
    input.value = '   ';
    input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(g.document.querySelector('.folder-new')).toBeNull());
    expect(api.createFolder).not.toHaveBeenCalled(); // nome vazio cancela
    g.document.getElementById('folder-new').click();
    input = g.document.querySelector('.folder-new input');
    input.value = 'Estudos';
    input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('Estudos'));
  });

  it('pastas: a busca também encontra pelo nome da pasta (e esconde pastas sem resultado)', async () => {
    await boot2(meetings({ folderId: 'f1' }), folderApi([F1, F2]));
    const input = g.document.getElementById('search');
    input.value = 'client'; // nome da pasta Clientes
    input.dispatchEvent(new g.window.Event('input'));
    await vi.waitFor(() => expect(g.document.querySelectorAll('.folder-block')).toHaveLength(1));
    expect(g.document.querySelector('.folder-name').textContent).toBe('Clientes');
    expect(g.document.querySelectorAll('.folder-children .meeting')).toHaveLength(1);
    expect(g.document.querySelectorAll('#list .meeting')).toHaveLength(0);
  });

  it('pastas: tudo em inglês quando o app está em inglês', async () => {
    const out = await bootLang('en', { listMeetings: async () => meetings({ folderId: 'f1' }), ...folderApi([F1]) });
    await vi.waitFor(() => expect(g.document.querySelector('.folder-row')).not.toBeNull());
    expect(g.document.querySelector('.folders-title').textContent).toBe('Folders');
    expect(g.document.getElementById('folder-new').title).toBe('New folder');
    expect(g.document.querySelector('.folder-count').title).toBe('1 meeting');
    g.document.querySelector('.folder-row .f-more').click();
    expect([...g.document.querySelectorAll('.action-item')].map((i: any) => i.textContent.trim())).toEqual(['Rename', 'New meeting in this folder', 'New subfolder', 'Move to', 'Sensitive folder', 'Retention…', 'Delete folder']);
    g.window.RiceActionMenu.close();
    void out;
  });
}
describe_folders();

it('transcrição: rótulos Eu/Outros (e Me/Others) são traduzidos só na exibição; o arquivo não muda', async () => {
  const transcript = '**[09:00:01] Eu:** bom dia\n\n**[09:00:05] Outros:** oi\n\n**[09:00:09] Me:** hi\n\n**[09:00:12] Others:** hey\n\n';
  const now = new Date().toISOString();
  const readMeeting = vi.fn(async () => ({ meta: { title: 'Daily', startedAt: now, state: 'done', notesStatus: 'done' }, transcript, annotations: '', notes: '', chat: [] }));
  const { handlers } = await bootLang('en', { readMeeting });
  g.document.querySelector('.meeting').click();
  const who = () => [...g.document.querySelectorAll('.t-who')].map((n: any) => n.textContent);
  await openTranscriptTab();
  await vi.waitFor(() => expect(who()).toHaveLength(4));
  expect(who()).toEqual(['Me', 'Others', 'Me', 'Others']);
  expect([...g.document.querySelectorAll('.t-row')].map((n: any) => n.classList.contains('me'))).toEqual([true, false, true, false]);
  await handlers['ui:language']!('pt-BR');
  await vi.waitFor(() => expect(who()).toEqual(['Eu', 'Outros', 'Eu', 'Outros']));
  expect(readMeeting.mock.results.length).toBeGreaterThan(0); // só leitura: nada reescreve o arquivo
});

it('progresso de reunião longa: "parte 2 de 6" acima das notas, atualiza ao vivo e some ao terminar', async () => {
  const { handlers } = await bootLang('pt-BR', { notesProgress: async () => ({ dir: '/R/a', phase: 'extract', part: 2, total: 6 }) });
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.notes-progress')).not.toBeNull());
  const line = () => g.document.querySelector('.notes-progress');
  await vi.waitFor(() => expect(line().textContent).toBe('Gerando notas… parte 2 de 6'));
  expect(line().hidden).toBe(false);
  handlers['session:notes-progress']!({ dir: '/R/a', phase: 'extract', part: 3, total: 6 });
  expect(line().textContent).toBe('Gerando notas… parte 3 de 6');
  handlers['session:notes-progress']!({ dir: '/R/a', phase: 'write' });
  expect(line().textContent).toBe('Gerando notas… montando o resumo');
  handlers['session:notes-progress']!({ dir: '/R/a', phase: 'done' });
  expect(line().hidden).toBe(true);
});

describe('quem falou: rótulos Pessoa N e popover de renomear', () => {
  const T = '# T\n\n**[14:00:01] Eu:** oi\n\n**[14:00:05] Pessoa 2:** Obrigado, Ana.\n\n**[14:00:09] Pessoa 2:** segue o prazo\n\n**[14:00:12] Pessoa 1:** fechado\n';
  const open = async (extra: Record<string, any> = {}, meta: Record<string, any> = {}) => {
    const now = new Date();
    const boot = await bootLang('pt-BR', {
      readMeeting: async () => ({ meta: { title: 'Daily', startedAt: now.toISOString(), state: 'done', notesStatus: 'done', ...meta }, transcript: T, annotations: '', notes: '', chat: [] }),
      setSpeakerName: vi.fn(async (_d: string, id: string, name: string) => ({ ok: true, speakers: name ? { [id]: name } : {} })),
      suggestSpeakerNames: vi.fn(async () => ({ ok: true, suggestions: { 2: 'Ana' } })),
      ...extra,
    });
    g.document.querySelector('.meeting').click();
    await openTranscriptTab();
    await vi.waitFor(() => expect(g.document.querySelectorAll('.t-who-btn').length).toBe(3));
    return boot;
  };

  it('mostra "Pessoa 2" como botão; "Eu" e "Outros" continuam texto; nomes salvos aparecem em todas as falas dela', async () => {
    await open({}, { speakers: { 2: 'Ana' } });
    const labels = [...g.document.querySelectorAll('.t-row .t-who')].map((n: any) => [n.tagName, n.textContent]);
    expect(labels).toEqual([['SPAN', 'Eu'], ['BUTTON', 'Ana'], ['BUTTON', 'Ana'], ['BUTTON', 'Pessoa 1']]);
  });

  it('clicar abre o popover, salvar aplica o nome em todas as falas da pessoa e salva na reunião', async () => {
    const { rice } = await open({}, { participants: ['Bruno Lima', 'Carla'] });
    const first: any = g.document.querySelector('.t-who-btn[data-person="2"]');
    first.click();
    const pop = g.document.querySelector('.speaker-pop');
    expect(pop).not.toBeNull();
    expect(pop.textContent).toContain('Da agenda');
    expect([...pop.querySelectorAll('.chip')].map((c: any) => c.textContent)).toEqual(['Bruno Lima', 'Carla']);
    const input = pop.querySelector('input');
    input.value = 'Ana Souza';
    pop.querySelector('.icon-btn').click();
    await vi.waitFor(() => expect(rice.setSpeakerName).toHaveBeenCalledWith('/R/a', '2', 'Ana Souza'));
    await vi.waitFor(() => expect([...g.document.querySelectorAll('.t-who-btn[data-person="2"]')].map((n: any) => n.textContent)).toEqual(['Ana Souza', 'Ana Souza']));
    expect(g.document.querySelector('.t-who-btn[data-person="1"]').textContent).toBe('Pessoa 1');
    expect(g.document.querySelector('.speaker-pop')).toBeNull();
  });

  it('nome da agenda vira chip de um clique; a sugestão da IA só aparece ao pedir e nunca é aplicada sozinha', async () => {
    const { rice } = await open({}, { participants: ['Carla'] });
    g.document.querySelector('.t-who-btn[data-person="2"]').click();
    const pop = g.document.querySelector('.speaker-pop');
    expect(rice.suggestSpeakerNames).not.toHaveBeenCalled();
    pop.querySelector('.speaker-pop-suggest .link-button').click();
    await vi.waitFor(() => expect(pop.textContent).toContain('Sugestão da IA'));
    expect(rice.setSpeakerName).not.toHaveBeenCalled();
    const chip = [...pop.querySelectorAll('.chip')].find((c: any) => c.textContent === 'Ana') as any;
    chip.click();
    await vi.waitFor(() => expect(rice.setSpeakerName).toHaveBeenCalledWith('/R/a', '2', 'Ana'));
  });

  it('Esc fecha sem salvar; "Remover nome" aparece só quando já há nome', async () => {
    const { rice } = await open({}, { speakers: { 2: 'Ana' } });
    g.document.querySelector('.t-who-btn[data-person="2"]').click();
    const clear = [...g.document.querySelectorAll('.speaker-pop .link-button')].find((b: any) => b.textContent === 'Remover nome');
    expect(clear).toBeDefined();
    g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(g.document.querySelector('.speaker-pop')).toBeNull();
    expect(rice.setSpeakerName).not.toHaveBeenCalled();
    g.document.querySelector('.t-who-btn[data-person="1"]').click();
    expect([...g.document.querySelectorAll('.speaker-pop .link-button')].some((b: any) => b.textContent === 'Remover nome')).toBe(false);
  });
});

it('Configurações: "Identificar participantes (beta)" liga e desliga pelo IPC', async () => {
  const rice = { setIdentifySpeakers: vi.fn(async () => ({ ok: true })), aiStatus: async () => ({ active: 'chatgpt-sub', models: {}, providers: {} }) };
  await bootLang('pt-BR', rice);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.getElementById('identify-speakers')).not.toBeNull());
  expect(g.document.getElementById('detail').textContent).toContain('Identificar participantes (beta)');
  const box = g.document.getElementById('identify-speakers');
  expect(box.checked).toBe(false);
  box.checked = true;
  box.onchange();
  expect(rice.setIdentifySpeakers).toHaveBeenCalledWith(true);
});

it('Configurações aparecem na hora, sem esperar o status da IA ("Verificando…" e depois o provedor ativo)', async () => {
  let release: (v: any) => void = () => {};
  const slow = new Promise((r) => (release = r));
  const rice = { aiStatus: vi.fn(() => slow), getSettings: async () => ({ root: '/R', rootDisplay: '~/Rice', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true }) };
  await bootLang('pt-BR', rice);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelectorAll('.settings-page .setting-section').length).toBeGreaterThanOrEqual(5));
  const note = [...g.document.querySelectorAll('.settings-page .set-help')].find((h: any) => h.textContent === 'Verificando…');
  expect(note).toBeDefined(); // a tela já está inteira e o status ainda pendente
  release({ active: 'claude-sub', models: {}, providers: {} });
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page .ai-card')).not.toBeNull());
  expect(g.document.querySelector('.settings-page .ai-card').dataset.vendor).toBe('claude'); // a ativa vem primeiro
  expect(g.document.querySelector('.settings-page .ai-card-state').textContent).toContain('Ativo');
});

describe('avisos persistentes (banner)', () => {
  it('mostra os avisos do main com o botão de ação, atualiza ao vivo e some quando a lista esvazia', async () => {
    const alertAction = vi.fn(async () => {});
    const { handlers } = await bootLang('pt-BR', { alerts: async () => [], alertAction, dismissAlert: vi.fn(async () => {}) });
    const box = () => g.document.getElementById('alerts');
    expect(box().hidden).toBe(true);
    handlers['session:alerts']!([
      { id: 'storage:audio', level: 'error', message: 'Disco cheio: o áudio parou de ser salvo.', action: { kind: 'open-storage', label: 'Abrir armazenamento' } },
      { id: 'storage:spool', level: 'error', message: 'O áudio ficou em /x.', dismissible: true },
    ]);
    expect(box().hidden).toBe(false);
    const rows = [...box().querySelectorAll('.alert')] as any[];
    expect(rows.map((r) => r.className)).toEqual(['alert error', 'alert error']);
    expect(rows[0].textContent).toContain('Disco cheio');
    rows[0].querySelector('button').click();
    expect(alertAction).toHaveBeenCalledWith('storage:audio', 'open-storage');
    expect(rows[1].querySelector('.alert-x')).not.toBeNull();
    expect(rows[0].querySelector('.alert-x')).toBeNull();
    handlers['session:alerts']!([]);
    expect(box().hidden).toBe(true);
  });
});

describe('reunião interrompida: Recuperar reunião', () => {
  it('mostra a nota discreta com o botão, chama o main e recarrega a reunião', async () => {
    const recoverMeeting = vi.fn(async () => ({ ok: true, tailTranscribedMs: 0, audioRecovered: true, notes: true }));
    await bootLang('pt-BR', { recoverMeeting }, { state: 'interrupted' });
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.querySelector('.recover-note')).not.toBeNull());
    const note = g.document.querySelector('.recover-note');
    expect(note.textContent).toContain('interrompida antes do fim');
    note.querySelector('button').click();
    await vi.waitFor(() => expect(recoverMeeting).toHaveBeenCalledWith('/R/a'));
  });

  it('reunião concluída não mostra a nota', async () => {
    await bootLang('pt-BR', { recoverMeeting: vi.fn() }, { state: 'done' });
    g.document.querySelector('.meeting').click();
    await vi.waitFor(() => expect(g.document.querySelector('.page-actions')).not.toBeNull());
    expect(g.document.querySelector('.recover-note')).toBeNull();
  });
});

describe('reunião com meta ilegível (R-52)', () => {
  it('aparece na lista com o selo, e a página oferece Reparar que chama o main e reabre', async () => {
    const repairMeeting = vi.fn(async () => ({ ok: true, meta: {} }));
    await bootLang('pt-BR', {
      listMeetings: async () => [{ dir: '/R/x', title: 'Planejamento', startedAt: new Date().toISOString(), state: 'damaged', notesStatus: 'failed', gaps: [] }],
      repairMeeting,
    });
    const item = g.document.querySelector('.meeting');
    expect(item.querySelector('.m-dot').title).toBe('Precisa de reparo');
    item.click();
    await vi.waitFor(() => expect(g.document.getElementById('detail').textContent).toContain('ilegíveis'));
    [...g.document.querySelectorAll('#detail button')].find((b: any) => b.textContent === 'Reparar reunião')!.click();
    await vi.waitFor(() => expect(repairMeeting).toHaveBeenCalledWith('/R/x'));
  });
});
