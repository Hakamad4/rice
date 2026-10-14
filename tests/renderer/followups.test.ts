// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Kickoff Acme', startedAt: '2026-10-12T10:00:00-03:00', state: 'done' }];
const tick = () => new Promise((r) => setTimeout(r, 40));
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const src = { dir: '/R/a', title: 'Kickoff Acme', date: '2026-10-01T10:00:00-03:00' };
const f = (id: string, text: string, over: Record<string, unknown> = {}) => ({ id, kind: 'commitment', who: 'Eu', about: '', text, status: 'open', mine: true, source: src, ...over });

const groups = (over: Record<string, unknown[]> = {}) => ({
  overdue: [f('late', 'Eu mando a proposta', { due: iso(-3) })], today: [f('today', 'Eu ligo para a Acme', { due: iso(0) })], week: [f('week', 'Eu reviso o contrato', { due: iso(2) })], later: [],
  nodue: [f('nodue', 'Eu organizo a pasta')],
  done: [f('done', 'Eu enviei o convite', { status: 'done', doneAt: '2026-10-05T10:00:00Z', doneBy: { dir: '/R/9', title: 'Reunião de follow-up', date: '2026-10-05T10:00:00-03:00' } })],
  ...over,
});

async function open(over: Record<string, unknown> = {}) {
  const followupsList = vi.fn(async (flt: string) => ({ groups: flt === 'others' ? groups({ overdue: [], today: [], week: [], nodue: [], done: [], later: [f('o1', 'Carlos manda a minuta', { mine: false, who: 'Carlos', due: iso(20) })] }) : groups(), overdueMine: 1 }));
  const api = {
    followupsList, followupsCount: vi.fn(async () => ({ overdue: 2 })), followupsSetDone: vi.fn(async () => ({ ok: true })), followupsSetDue: vi.fn(async () => ({ ok: true })), followupsAdd: vi.fn(async () => ({ ok: true })),
    followupsRemindersStatus: vi.fn(async () => ({ active: false })), followupsToReminders: vi.fn(async () => ({ ok: true, count: 1 })), readMeeting: vi.fn(async () => ({ meta: { notesStatus: 'done', ...meetings[0] }, transcript: '', annotations: '', notes: '', chat: [] })),
    ...over,
  };
  const { handlers } = bootRenderer(api, meetings);
  await tick();
  g.localStorage.clear();
  g.document.getElementById('followups-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.fu-page .fu-row')).toBeTruthy());
  await tick();
  return { api, handlers };
}
const rows = () => [...g.document.querySelectorAll('.fu-row')] as any[];
const titles = () => [...g.document.querySelectorAll('.fu-group-title')].map((h: any) => h.firstChild.textContent);

it('barra lateral: item "Pendências" abaixo de Início, ícone de linha, com o contador das minhas vencidas', async () => {
  const { api } = await open();
  const nav = [...g.document.querySelectorAll('.nav-item')].map((b: any) => b.id);
  expect(nav.indexOf('followups-link')).toBe(nav.indexOf('home-link') + 1);
  const link = g.document.getElementById('followups-link');
  expect(link.querySelector('svg.icon-check-circle')).toBeTruthy();
  expect(link.querySelector('span:not(.ico)').textContent).toBe('Pendências');
  expect(g.document.getElementById('followups-badge').textContent).toBe('2');
  expect(g.document.getElementById('followups-badge').hidden).toBe(false);
  expect(link.classList.contains('active')).toBe(true);
  void api;
});

it('sem vencidas o contador some', async () => {
  await open({ followupsCount: async () => ({ overdue: 0 }) });
  expect(g.document.getElementById('followups-badge').hidden).toBe(true);
});

it('agrupa em Vencidas, Hoje, Esta semana, Sem prazo e Feitas (recolhido); filtro "Minhas" por padrão', async () => {
  const { api } = await open();
  expect(titles()).toEqual(['Vencidas', 'Hoje', 'Esta semana', 'Sem prazo', 'Feitas']);
  expect(api.followupsList).toHaveBeenCalledWith('mine');
  const done = g.document.querySelector('.fu-done-group') as any;
  expect(done.tagName).toBe('DETAILS');
  expect(done.open).toBe(false);
  expect(g.document.querySelector('.fu-group-title.late').textContent).toContain('Vencidas'); // destaque âmbar
  const chips = [...g.document.querySelectorAll('.fu-chip')] as any[];
  expect(chips.map((c) => c.textContent)).toEqual(['Minhas', 'Dos outros', 'Todas']);
  expect(chips[0].getAttribute('aria-pressed')).toBe('true');
});

it('cada linha: checkbox, texto, prazo editável com um clique e link discreto para a reunião de origem', async () => {
  const { api } = await open();
  const first = rows()[0];
  expect(first.querySelector('input.fu-box')).toBeTruthy();
  expect(first.querySelector('.fu-text').textContent).toBe('Eu mando a proposta');
  expect(first.querySelector('.fu-due.late')).toBeTruthy();
  expect(first.querySelector('.mem-src').textContent).toContain('Kickoff Acme');
  // prazo: um clique abre o popover do app (Hoje, Amanhã, Sexta, Próxima semana, Escolher data); escolher a data salva
  first.querySelector('.fu-due').click();
  const pop = g.document.querySelector('.fu-due-pop') as any;
  expect([...pop.querySelectorAll('button')].map((b: any) => b.textContent).slice(0, 2)).toEqual(['Hoje', 'Amanhã']);
  expect([...pop.querySelectorAll('button')].map((b: any) => b.textContent)).toEqual(expect.arrayContaining(['Próxima semana', 'Escolher data…', 'Remover prazo']));
  expect(g.document.querySelector('select')).toBeNull(); // nada de <select> nativo
  ([...pop.querySelectorAll('button')].find((b: any) => b.textContent === 'Escolher data…') as any).click();
  const input = g.document.querySelector('.fu-date') as any;
  expect(input.hidden).toBe(false);
  input.value = iso(5);
  input.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await tick();
  expect(api.followupsSetDue).toHaveBeenCalledWith('late', iso(5));
  // sem prazo: nada de repetir "Sem prazo" na linha (o grupo já diz); só "+ Prazo", visível no hover/foco, e também editável
  const nodue = rows().find((r) => r.querySelector('.fu-text').textContent === 'Eu organizo a pasta');
  expect(nodue.querySelector('.fu-due.none').textContent).toBe('+ Prazo');
  expect(nodue.textContent).not.toContain('Sem prazo');
  // link da origem abre a reunião
  rows()[0].querySelector('.mem-src').click();
  await tick();
  expect(api.readMeeting).toHaveBeenCalledWith('/R/a');
});

it('marcar o checkbox conclui; a feita pela IA numa reunião seguinte mostra "concluída em …" e reabre com um clique', async () => {
  const { api } = await open();
  const box = rows()[0].querySelector('input.fu-box') as any;
  box.checked = true;
  box.dispatchEvent(new g.window.Event('change', { bubbles: true }));
  await tick();
  expect(api.followupsSetDone).toHaveBeenCalledWith('late', true);
  const done = rows().find((r) => r.querySelector('.fu-text').textContent === 'Eu enviei o convite');
  expect(done.classList.contains('done')).toBe(true);
  expect(done.querySelector('.fu-closed').textContent).toContain('concluída em Reunião de follow-up');
  done.querySelector('.fu-reopen').click();
  await tick();
  expect(api.followupsSetDone).toHaveBeenCalledWith('done', false);
});

it('filtros: "Dos outros" mostra o que prometeram a mim, com o responsável; "Todas" mostra tudo', async () => {
  const { api } = await open();
  ([...g.document.querySelectorAll('.fu-chip')].find((c: any) => c.textContent === 'Dos outros') as any).click();
  await tick();
  expect(api.followupsList).toHaveBeenCalledWith('others');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].querySelector('.fu-who').textContent).toBe('Com Carlos');
  expect(titles()).toEqual(['Depois']);
  expect(g.localStorage.getItem('rice.followups.filter')).toBe('others'); // a escolha fica lembrada
  ([...g.document.querySelectorAll('.fu-chip')].find((c: any) => c.textContent === 'Todas') as any).click();
  await tick();
  expect(api.followupsList).toHaveBeenCalledWith('all');
});

it('adicionar à mão: campo no topo, opcionalmente ligada a uma reunião; vazio não envia', async () => {
  const { api } = await open();
  const input = g.document.querySelector('.fu-add-input') as any;
  const form = g.document.querySelector('.fu-add') as any;
  form.dispatchEvent(new g.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  expect(api.followupsAdd).not.toHaveBeenCalled();
  input.value = 'Ligar para o Zé amanhã';
  expect(g.document.querySelector('.fu-add select')).toBeNull();
  const picker = g.document.querySelector('.fu-add-meeting') as any;
  picker.querySelector('.menu-select-btn').click();
  const opts = [...g.document.querySelectorAll('.select-opt')] as any[];
  expect(opts[0].textContent).toContain('Sem reunião'); // primeira opção
  expect(opts[1].querySelector('.select-opt-text').textContent).toContain('Kickoff Acme'); // título + data
  expect(opts[1].querySelector('.select-opt-sub').textContent).toMatch(/12 de out/);
  expect(g.document.querySelector('.select-search')).toBeNull(); // poucas reuniões: sem busca
  opts[1].click();
  form.dispatchEvent(new g.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  expect(api.followupsAdd).toHaveBeenCalledWith({ text: 'Ligar para o Zé amanhã', dir: '/R/a' });
  expect(input.value).toBe('');
});

it('texto das pendências nunca vira HTML', async () => {
  await open({ followupsList: async () => ({ groups: groups({ nodue: [f('x', 'Mandar <img src=x onerror=alert(1)> agora')] }), overdueMine: 0 }) });
  expect(g.document.querySelector('.fu-page img')).toBeNull();
  expect([...g.document.querySelectorAll('.fu-text')].some((n: any) => n.textContent.includes('<img'))).toBe(true);
});

it('Lembretes do macOS: "Enviar minhas" fica na barra de filtros, só com a integração ativa; sem ícone solto nas linhas', async () => {
  await open();
  expect(g.document.querySelector('.fu-rem-all')).toBeNull();
  const { api } = await open({ followupsRemindersStatus: async () => ({ active: true }) });
  expect(g.document.querySelector('.fu-rem')).toBeNull(); // o ícone solto da linha foi embora: a origem fica só na meta
  expect(g.document.querySelector('.fu-tail .icon')).toBeNull();
  const bar = g.document.querySelector('.fu-bar') as any;
  expect(bar.querySelector('.fu-filters')).not.toBeNull();
  expect(bar.lastElementChild.className).toBe('fu-rem-all');
  expect(g.document.querySelector('.fu-body .fu-rem-all')).toBeNull();
  (g.document.querySelector('.fu-rem-all') as any).click();
  await tick();
  expect(api.followupsToReminders).toHaveBeenCalledWith('mine');
});

it('ritmo da lista: linhas de 10px com separador sutil, hover na linha inteira, checkbox no centro da 1ª linha, meta a 4px, mais espaço antes do grupo', async () => {
  await open();
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.fu-row \{[^}]*padding:10px var\(--space-2\)/);
  expect(css).toMatch(/\.fu-row \+ \.fu-row::before \{[^}]*border-top:1px solid var\(--line\)/);
  expect(css).toMatch(/\.fu-row:hover[^{]*\{ background:var\(--hover\)/);
  expect(css).toMatch(/\.fu-text \{[^}]*line-height:20px/);
  expect(css).toMatch(/\.fu-box \{[^}]*margin-top:2px/);
  expect(css).toMatch(/\.fu-main \{[^}]*max-width:68ch[^}]*gap:var\(--space-1\)/);
  expect(css).toMatch(/\.fu-group-title \{[^}]*margin:var\(--space-5\) 0 var\(--space-1\)/);
  expect(css).toMatch(/\.fu-due\.none \{ opacity:0; \}/);
});

it('a página se refaz quando a memória muda (nota nova, pendência fechada pela IA)', async () => {
  const { api, handlers } = await open();
  const before = api.followupsList.mock.calls.length;
  handlers['memory:changed']!(null);
  await tick();
  expect(api.followupsList.mock.calls.length).toBeGreaterThan(before);
});

it('abre pela notificação (app:open-followups)', async () => {
  const { handlers } = await open();
  g.document.getElementById('home-link').click();
  await tick();
  handlers['app:open-followups']!(null);
  await tick();
  expect(g.document.getElementById('followups-link').classList.contains('active')).toBe(true);
});

it('linha Feita: "concluída em <reunião> · Reabrir" fica na mesma linha de meta, mesmo tamanho e cor, separado por ·', async () => {
  await open();
  const done = rows().find((r) => r.querySelector('.fu-text').textContent === 'Eu enviei o convite');
  const sub = done.querySelector('.fu-sub') as any;
  const closed = sub.querySelector('.fu-closed') as any; // dentro da meta, junto da origem
  expect(closed.parentElement).toBe(sub);
  expect([...closed.children].map((c: any) => c.textContent)).toEqual(['concluída em Reunião de follow-up', '·', 'Reabrir']);
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.fu-reopen \{[^}]*font:inherit[^}]*color:inherit/); // mesmo tamanho e cor do texto ao lado
  expect(css).toMatch(/\.fu-closed \{[^}]*font-size:11px[^}]*color:var\(--muted\)/);
});

it('marcações monocromáticas: o checkbox marcado das pendências e das notas usa --ink, não o azul', async () => {
  await open();
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/input\.fu-box:checked, \.md li\.task input\[type=checkbox\]:checked \{ background:var\(--ink\); border-color:var\(--ink\); \}/);
});

it('formulário "Adicionar pendência": campo, seletor e botão com a mesma altura; em janela estreita empilham', async () => {
  await open();
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.fu-add > \* \{ height:36px; box-sizing:border-box; margin:0; \}/);
  expect(css).toMatch(/\.fu-add > \.fu-add-go \{ height:36px; min-height:36px;/); // o botão (.btn 32px) também fica com 36px
  expect(css).toMatch(/\.fu-add \.menu-select-btn \{ width:100%; height:36px;/);
  expect(css).toMatch(/@media \(max-width: 560px\) \{ \.fu-add \{ flex-direction:column; \} \.fu-add > \* \{ width:100%; flex:none; \} \}/);
  expect([...g.document.querySelector('.fu-add').children].map((c: any) => c.tagName)).toEqual(['INPUT', 'DIV', 'BUTTON']);
});

it('seletor de reunião: com muitas reuniões ganha busca que filtra por título', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ dir: `/R/${i}`, title: i === 7 ? 'Planejamento Zeta' : `Reunião ${i}`, startedAt: '2026-10-12T10:00:00-03:00', state: 'done' }));
  const { api } = await open({ listMeetings: async () => many });
  expect(api).toBeTruthy();
  (g.document.querySelector('.fu-add-meeting .menu-select-btn') as any).click();
  const search = g.document.querySelector('.select-search') as any;
  expect(search).not.toBeNull();
  search.value = 'zeta';
  search.dispatchEvent(new g.window.Event('input', { bubbles: true }));
  const titles = [...g.document.querySelectorAll('.select-opt')].map((o: any) => o.textContent);
  expect(titles).toHaveLength(1);
  expect(titles[0]).toContain('Planejamento Zeta');
});
