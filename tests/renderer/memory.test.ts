// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Revisão Acme', startedAt: '2026-10-12T10:00:00-03:00', state: 'done', calendarEventId: 'ev1' }];
const tick = () => new Promise((r) => setTimeout(r, 40));
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const brief = {
  bullets: [
    { factId: '1', text: 'Mandar a proposta <img src=x onerror=alert(1)>', kind: 'commitment', dir: '/R/1', title: 'Kickoff', date: '2026-10-01T10:00:00-03:00', due: iso(-2) },
    { factId: '2', text: 'Ana pediu desconto de 10%.', kind: 'request', dir: '/R/2', title: 'Reunião 2', date: '2026-10-05T10:00:00-03:00' },
    { factId: '3', text: 'Contrato enviado.', kind: 'commitment', dir: '/R/3', title: 'Follow-up', date: '2026-10-06T10:00:00-03:00', done: true },
  ],
  recent: [{ dir: '/R/1', title: 'Kickoff', date: '2026-10-01T10:00:00-03:00' }, { dir: '/R/a', title: 'Revisão Acme', date: '2026-10-12T10:00:00-03:00' }],
  openCount: 2,
};

async function open(over: Record<string, unknown> = {}) {
  const { handlers } = bootRenderer({
    readMeeting: async () => ({ meta: { notesStatus: 'done', ...meetings[0] }, transcript: '', annotations: '', notes: '## Próximas ações\n- [ ] Enviar a proposta\n', chat: [] }),
    saveAnnotations: async () => ({ ok: true }),
    attachList: async () => ({ items: [], images: { supported: true, provider: 'claude-api' } }),
    memoryBriefMeeting: vi.fn(async () => brief),
    ...over,
  }, meetings);
  await tick();
  g.document.querySelector('.meeting').click();
  await tick();
  await tick();
  return { handlers };
}
const card = () => g.document.querySelector('.mem-card') as any;

it('"O que lembrar": cartão discreto no topo da aba Notas, com tipo, prazo, link da origem; vencida em âmbar; texto da IA nunca vira HTML', async () => {
  await open();
  expect(card().hidden).toBe(false);
  expect(g.document.querySelector('.mt-body').firstElementChild).toBe(card());
  expect(card().querySelector('.mem-title').textContent).toBe('O que lembrar');
  const rows = [...card().querySelectorAll('.mem-bullet')] as any[];
  expect(rows).toHaveLength(3);
  expect(rows[0].querySelector('.mem-text').textContent).toBe('Mandar a proposta <img src=x onerror=alert(1)>');
  expect(card().querySelector('img')).toBeNull(); // o texto da IA é só texto
  expect(rows[0].classList.contains('late')).toBe(true);
  expect(rows[0].querySelector('.mem-due.late')).not.toBeNull();
  expect(rows[1].querySelector('.mem-due')).toBeNull();
  expect(rows[2].classList.contains('done')).toBe(true);
  expect(rows[0].querySelector('.mem-kind').textContent).toBe('Promessa');
  expect(card().querySelectorAll('.mem-recent .mem-src')).toHaveLength(1); // a reunião atual não aparece nas recentes
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.mem-due\.late[^}]*color:var\(--warn\)/);
});

it('clicar no link abre a reunião de origem; recolher lembra o estado', async () => {
  const readMeeting = vi.fn(async (dir: string) => ({ meta: { notesStatus: 'done', ...meetings[0], dir }, transcript: '', annotations: '', notes: '', chat: [] }));
  await open({ readMeeting });
  card().querySelector('.mem-bullet .mem-src').click();
  await tick();
  expect(readMeeting).toHaveBeenCalledWith('/R/1');
  const btn = () => card().querySelector('.mem-toggle') as any;
  btn().click();
  expect(card().querySelector('.mem-list')).toBeNull();
  expect(btn().getAttribute('aria-expanded')).toBe('false');
  expect(card().querySelector('.mem-count').textContent).toBe('3');
  expect(g.localStorage.getItem('rice.memory.card.collapsed')).toBe('1');
  btn().click();
  expect(card().querySelector('.mem-list')).not.toBeNull();
});

it('sem fatos: nada aparece, nem cartão vazio; erro da memória não quebra a aba', async () => {
  await open({ memoryBriefMeeting: async () => null });
  expect(card().hidden).toBe(true);
  expect(card().children).toHaveLength(0);
  await open({ memoryBriefMeeting: async () => { throw new Error('x'); } });
  expect(card().hidden).toBe(true);
});

it('em inglês os rótulos vêm de t()', async () => {
  const { handlers } = await open();
  g.window.RiceI18n.setLanguage('en');
  expect(g.window.RiceI18n.t('memory.card.title')).toBe('What to remember');
  expect(g.window.RiceI18n.t('memory.kind.open_question')).toBe('Open question');
  expect(g.window.RiceI18n.t('followups.group.overdue')).toBe('Overdue');
  g.window.RiceI18n.setLanguage('pt-BR');
  void handlers;
});

it('notas: marcar a tarefa chama o main (reflete nas pendências)', async () => {
  const followupsToggleNoteTask = vi.fn(async () => ({ ok: true }));
  await open({ followupsToggleNoteTask });
  const box = g.document.querySelector('.mt-body .md li.task input[type=checkbox]') as any;
  expect(box.disabled).toBe(false);
  box.checked = true;
  box.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  expect(followupsToggleNoteTask).toHaveBeenCalledWith('/R/a', 'Enviar a proposta', true);
});

it('Início: evento que começa em até 15 min ganha a linha com o primeiro ponto e "ver mais"; sem fatos nada aparece', async () => {
  const soon = new Date(Date.now() + 10 * 60_000);
  const event = { id: 'ev1', title: 'Revisão Acme', start: soon.toISOString(), end: new Date(soon.getTime() + 3600_000).toISOString(), calendar: 'x', attendees: 2, source: 'google' };
  const later = { ...event, id: 'ev2', title: 'Outra', start: new Date(Date.now() + 3 * 3600_000).toISOString(), end: new Date(Date.now() + 4 * 3600_000).toISOString() };
  const memoryBriefEvent = vi.fn(async (id: string) => (id === 'ev1' ? brief : null));
  bootRenderer({ calendarEvents: async () => [event, later], memoryBriefEvent }, meetings);
  await tick();
  await tick();
  await tick();
  const line = g.document.querySelector('.ev-memory') as any;
  expect(line).not.toBeNull();
  expect(line.querySelector('.ev-mem-text').textContent).toContain('Mandar a proposta');
  expect(line.querySelector('.ev-mem-text').classList.contains('late')).toBe(true);
  expect(line.querySelector('.ev-mem-more').textContent).toBe('ver mais');
  expect(memoryBriefEvent).toHaveBeenCalledTimes(1); // só o evento dentro de 15 min
  expect(g.document.querySelectorAll('.ev-memory')).toHaveLength(1);
});

// ---- Configurações › Memória ----
async function openMemorySettings(over: Record<string, unknown> = {}) {
  const status = { enabled: true, facts: 4, people: 2, orgs: 1, pendingMeetings: 7, backfill: { state: 'idle', done: 0, total: 0 }, notify: true };
  const list = {
    people: [{ name: 'Ana', facts: [{ id: 'f1', kind: 'request', who: 'Ana', org: 'acme', about: 'desconto', text: 'Ana pediu desconto <b>10%</b>', status: 'open', mine: true, source: { dir: '/R/1', title: 'Kickoff', date: '2026-10-01T10:00:00-03:00' } }, { id: 'f2', kind: 'decision', who: 'Ana', about: 'plano', text: 'Começar pelo piloto', status: 'open', mine: false, source: { dir: '/R/2', title: 'R2', date: '2026-10-05T10:00:00-03:00' } }] }],
    orgs: [{ name: 'acme', facts: [] }],
  };
  const api = {
    memoryStatus: vi.fn(async () => status), memoryList: vi.fn(async () => list), memorySetEnabled: vi.fn(async () => ({ ok: true })), memorySetNotify: vi.fn(async () => ({ ok: true })),
    memoryBackfillStart: vi.fn(async () => ({ total: 7 })), memoryBackfillCancel: vi.fn(), memoryRemove: vi.fn(async () => ({ ok: true })), memoryUpdate: vi.fn(async () => ({ ok: true })), memoryForget: vi.fn(async () => ({ ok: true })), memoryClear: vi.fn(async () => ({ ok: true })), followupsSetDone: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  const { handlers } = bootRenderer({ getSettings: async () => ({ root: '/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, rootDisplay: '~/Rice', memory: true, followupNotify: true }), aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }), ...api }, meetings);
  await tick();
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('#set-memory')).toBeTruthy());
  await tick();
  return { api, handlers, section: g.document.querySelector('#set-memory') as any };
}

const dialogOk = () => (([...g.document.querySelectorAll('.dialog button')].filter((b: any) => !/Cancelar/.test(b.textContent)).pop()) as any).click();
const dialogCancel = () => ([...g.document.querySelectorAll('.dialog button')].find((b: any) => /Cancelar/.test(b.textContent)) as any).click();

async function openMemoryPage(over: Record<string, unknown> = {}) {
  const r = await openMemorySettings(over);
  g.document.getElementById('memory-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.mp-page .mp-entity, .mp-page .mp-empty')).toBeTruthy());
  await tick();
  return r;
}

it('Memória (Configurações): só a opção, o link para a página, as reuniões antigas e a área de apagar; nada de lista nem resumo no topo', async () => {
  const { api, section } = await openMemorySettings();
  expect(section.textContent).toContain('Tudo fica neste Mac');
  expect(section.textContent).toContain('modelo leve');
  expect(section.querySelector('.mem-stats')).toBeNull();
  expect(section.querySelector('.mem-group')).toBeNull();
  expect(section.querySelector('.mem-search')).toBeNull();
  const sw = g.document.getElementById('memory-enabled') as any;
  expect(sw.checked).toBe(true);
  sw.checked = false;
  sw.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await tick();
  expect(api.memorySetEnabled).toHaveBeenCalledWith(false);
  const danger = section.querySelector('.mem-danger') as any;
  expect(danger.hidden).toBe(false);
  expect(danger.querySelector('.mem-danger-title').textContent).toBe('Apagar memória');
  expect(section.lastElementChild).toBe(danger); // a área destrutiva fica no fim
});

it('Memória (Configurações): "Abrir Memória" leva à página', async () => {
  const { section } = await openMemorySettings();
  ([...section.querySelectorAll('button')].find((b: any) => b.textContent === 'Abrir Memória') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.mp-page')).toBeTruthy());
  expect(g.document.getElementById('memory-link').classList.contains('active')).toBe(true);
});

it('Menu lateral: Memória logo abaixo de Pendências, ativa quando aberta', async () => {
  await openMemoryPage();
  expect(g.document.getElementById('memory-link').previousElementSibling.id).toBe('followups-link');
  expect(g.document.getElementById('memory-link').classList.contains('active')).toBe(true);
  expect(g.document.querySelector('.mp-page .page-title').textContent).toBe('Memória');
});

it('Página Memória: abas Pessoas/Empresas, busca e linha por pessoa; abrir mostra o detalhe com tudo, texto da IA só como texto; editar, resolver e apagar', async () => {
  const { api } = await openMemoryPage();
  const tabs = [...g.document.querySelectorAll('.mp-tab')] as any[];
  expect(tabs.map((t) => t.textContent)).toEqual(['Pessoas', 'Empresas']);
  expect(g.document.querySelector('.mp-search')).not.toBeNull();
  const row = g.document.querySelector('.mp-entity') as any;
  expect(row.querySelector('.mp-entity-name').textContent).toBe('Ana');
  expect(row.querySelector('.mp-open').textContent).toBe('1 em aberto');
  row.click();
  await vi.waitFor(() => expect(g.document.querySelector('.mp-detail-head')).toBeTruthy());
  const page = g.document.querySelector('.mp-page') as any;
  expect(page.querySelector('.mp-name').textContent).toBe('Ana');
  expect(page.querySelector('b')).toBeNull();
  const titles = [...page.querySelectorAll('.mp-sec-title')].map((n: any) => n.textContent);
  expect(titles.slice(0, 2)).toEqual(['Pendências em aberto', 'Decisões']); // pendências abertas primeiro
  const facts = [...page.querySelectorAll('.mem-fact')] as any[];
  expect(facts[0].querySelector('.mem-text').textContent).toBe('Ana pediu desconto <b>10%</b>');
  expect(facts[0].querySelector('.mem-src').textContent).toContain('Kickoff');
  expect(page.querySelector('.mp-meetings .mem-src')).not.toBeNull();
  const buttons = (f: any) => [...f.querySelectorAll('.mem-actions button')].map((b: any) => b.title);
  expect(buttons(facts[0])).toEqual(['Editar', 'Marcar como resolvido', 'Apagar']);
  facts[0].querySelectorAll('.mem-actions button')[0].click();
  const input = page.querySelector('.mem-edit') as any;
  input.value = 'Ana pediu 15% de desconto';
  input.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  expect(api.memoryUpdate).toHaveBeenCalledWith('f1', { text: 'Ana pediu 15% de desconto' });
  (g.document.querySelectorAll('.mp-page .mem-fact')[0] as any).querySelectorAll('.mem-actions button')[1].click();
  await tick();
  expect(api.followupsSetDone).toHaveBeenCalledWith('f1', true);
  (g.document.querySelectorAll('.mp-page .mem-fact')[1] as any).querySelectorAll('.mem-actions button')[1].click();
  await tick();
  expect(api.memoryRemove).toHaveBeenCalledWith('f2');
});

it('Página Memória: busca filtra pela memória, e a aba Empresas lista as empresas', async () => {
  const { api } = await openMemoryPage();
  const search = g.document.querySelector('.mp-search') as any;
  search.value = 'desconto';
  search.dispatchEvent(new g.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  expect(api.memoryList).toHaveBeenLastCalledWith('desconto');
  (g.document.querySelectorAll('.mp-tab')[1] as any).click();
  await tick();
  expect(g.document.querySelector('.mp-entity-name').textContent).toBe('acme');
});

it('Memória: esquecer pede confirmação (cancelar não faz nada); apagar tudo fica nas Configurações, também com confirmação', async () => {
  const { api, section } = await openMemoryPage();
  (g.document.querySelector('.mp-entity') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.mem-forget')).toBeTruthy());
  (g.document.querySelector('.mem-forget') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  expect(g.document.querySelector('.dialog').textContent).toContain('Esquecer tudo sobre Ana');
  dialogCancel();
  await tick();
  expect(api.memoryForget).not.toHaveBeenCalled();
  (g.document.querySelector('.mem-forget') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  dialogOk();
  await tick();
  expect(api.memoryForget).toHaveBeenCalledWith('person', 'Ana');
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('#set-memory .mem-danger')).toBeTruthy());
  const sec = g.document.querySelector('#set-memory') as any;
  ([...sec.querySelectorAll('.mem-danger button')].find((b: any) => b.textContent === 'Apagar toda a memória') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  expect(g.document.querySelector('.dialog').textContent).toContain('não pode ser desfeito');
  dialogOk();
  await tick();
  expect(api.memoryClear).toHaveBeenCalled();
  expect(section).toBeTruthy();
});

it('Memória vazia: o resumo do topo e "Apagar" somem; a página explica o que vai aparecer e oferece montar as reuniões antigas', async () => {
  const empty = { enabled: true, facts: 0, people: 0, orgs: 0, pendingMeetings: 3, backfill: { state: 'idle', done: 0, total: 0 }, notify: true };
  const { section } = await openMemoryPage({ memoryStatus: vi.fn(async () => empty), memoryList: vi.fn(async () => ({ people: [], orgs: [] })) });
  expect((g.document.querySelector('#set-memory .mem-danger') as any)?.hidden ?? true).toBe(true);
  expect(g.document.body.textContent).not.toContain('Nada na memória ainda.'); // sem a frase solta do resumo
  const empty$ = g.document.querySelector('.mp-empty') as any;
  expect(empty$.querySelector('h2').textContent).toBe('Nada na memória ainda');
  expect(g.document.querySelectorAll('.mp-empty h2')).toHaveLength(1);
  expect(empty$.querySelector('p').textContent).toContain('pediram, prometeram e decidiram');
  expect([...empty$.querySelectorAll('button')].some((b: any) => b.textContent === 'Montar memória das reuniões antigas')).toBe(true);
  expect(g.document.querySelector('.mp-search')).toBeNull();
  expect(section).toBeTruthy();
});

it('Reuniões antigas: botão com o número e o aviso de IA, só roda depois da confirmação; progresso compacto (linha, barra fina, título real) e cancelar', async () => {
  const { api, section, handlers } = await openMemorySettings();
  const backfill = section.querySelector('.mem-backfill') as any;
  expect(backfill.textContent).toContain('7 reuniões');
  expect(backfill.textContent).toContain('usa a IA uma vez para cada uma');
  const go = [...backfill.querySelectorAll('button')].find((b: any) => b.textContent === 'Montar memória das reuniões antigas') as any;
  go.click();
  await vi.waitFor(() => expect(g.document.querySelector('.dialog')).toBeTruthy());
  expect(g.document.querySelector('.dialog').textContent).toContain('7 reuniões');
  expect(api.memoryBackfillStart).not.toHaveBeenCalled(); // nada sem o clique de confirmação
  dialogOk();
  await tick();
  expect(api.memoryBackfillStart).toHaveBeenCalledTimes(1);
  const running = (current: string, currentAt?: string) => ({ enabled: true, facts: 4, people: 2, orgs: 1, pendingMeetings: 5, backfill: { state: 'running', done: 1, total: 4, current, currentAt }, notify: true });
  api.memoryStatus.mockImplementation(async () => running('Kickoff Acme'));
  handlers['memory:progress']!({});
  await tick();
  const bf = section.querySelector('.mem-backfill') as any;
  expect(bf.querySelector('.mem-run-text').textContent).toBe('Montando a memória · 1 de 4');
  expect(bf.querySelector('.mem-run').lastElementChild.textContent).toBe('Cancelar'); // link discreto à direita, na mesma linha
  expect(bf.querySelector('.mem-bar').getAttribute('role')).toBe('progressbar');
  expect(bf.querySelector('.mem-bar span').style.width).toBe('25%');
  expect(bf.querySelector('.mem-now').textContent).toBe('Agora: Kickoff Acme');
  expect(bf.querySelector('.mem-now').title).toBe('Agora: Kickoff Acme');
  expect(bf.querySelector('progress')).toBeNull();
  // título padrão: mostra título + data
  api.memoryStatus.mockImplementation(async () => running('Reunião', '2026-10-08T10:00:00-03:00'));
  handlers['memory:progress']!({});
  await tick();
  expect(section.querySelector('.mem-now').textContent).toMatch(/^Agora: Reunião · \d{1,2} de out\.?$/);
  ([...section.querySelectorAll('.mem-backfill button')].find((b: any) => b.textContent === 'Cancelar') as any).click();
  expect(api.memoryBackfillCancel).toHaveBeenCalled();
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.mem-bar \{[^}]*height:3px[^}]*border-radius:999px[^}]*background:var\(--line\)/);
  expect(css).toMatch(/\.mem-bar > span \{[^}]*background:var\(--ink\)/);
  expect(css).toMatch(/\.mem-now \{[^}]*text-overflow:ellipsis/);
});

it('Pendências: seção das Configurações liga/desliga o aviso', async () => {
  const { api } = await openMemorySettings();
  const sw = g.document.getElementById('followup-notify') as any;
  expect(sw.checked).toBe(true);
  sw.checked = false;
  sw.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  expect(api.memorySetNotify).toHaveBeenCalledWith(false);
});

it('contadores no singular e no plural (pt e en): 1 empresa / 2 empresas, 1 reunião / 7 reuniões, 1 pendência vencida', () => {
  const tn = (k: string, n: number) => g.window.RiceI18n.tn(k, n);
  expect(tn('memory.n-orgs', 1)).toBe('1 empresa');
  expect(tn('memory.n-orgs', 2)).toBe('2 empresas');
  expect(tn('memory.n-people', 1)).toBe('1 pessoa');
  expect(tn('memory.n-facts', 1)).toBe('1 fato');
  expect(tn('memory.backfill.finished', 1)).toBe('Pronto: 1 reunião.');
  expect(tn('memory.backfill.finished', 3)).toBe('Pronto: 3 reuniões.');
  expect(tn('memory.backfill.help', 1)).toContain('1 reunião com notas ainda não está');
  expect(tn('memory.backfill.confirm', 1)).toContain('1 reunião?');
  expect(tn('followups.badge.title', 1)).toBe('1 pendência vencida');
  expect(tn('followups.badge.title', 2)).toBe('2 pendências vencidas');
  g.window.RiceI18n.setLanguage('en');
  expect(tn('memory.n-orgs', 1)).toBe('1 company');
  expect(tn('memory.n-orgs', 2)).toBe('2 companies');
  expect(tn('memory.n-people', 1)).toBe('1 person');
  expect(tn('memory.n-people', 3)).toBe('3 people');
  expect(tn('memory.backfill.finished', 1)).toBe('Done: 1 meeting.');
  expect(tn('followups.badge.title', 1)).toBe('1 overdue follow-up');
  g.window.RiceI18n.setLanguage('pt-BR');
});

it('Página Memória: abas e busca com a mesma altura (36px), sublinhado no fim da linha; busca desce em janela estreita; detalhe com "Esquecer" à direita', async () => {
  await openMemoryPage();
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.mp-tab \{[^}]*height:36px/);
  expect(css).toMatch(/\.mp-search \{[^}]*height:36px/);
  expect(css).toMatch(/\.mp-head \{[^}]*align-items:flex-end[^}]*border-bottom:1px solid var\(--line\)/);
  expect(css).toMatch(/@container mp \(max-width: 620px\) \{[\s\S]*?\.mp-search \{[^}]*flex:1 1 100%/);
  (g.document.querySelector('.mp-entity') as any).click();
  await vi.waitFor(() => expect(g.document.querySelector('.mp-detail-head')).toBeTruthy());
  const head = g.document.querySelector('.mp-detail-head') as any;
  expect([...head.children].map((c: any) => c.className.split(' ')[0])).toEqual(['mp-detail-title', 'mem-forget']);
  expect(css).toMatch(/\.mem-forget \{[^}]*margin-left:auto[^}]*color:var\(--muted\)/);
});
