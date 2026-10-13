// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';

const g = globalThis as any;
beforeAll(() => {
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'home']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const now = new Date(2026, 9, 9, 9, 0, 0); // sex 09/10/2026 09:00 local
const at = (dayOffset: number, h: number, m = 0) => new Date(2026, 9, 9 + dayOffset, h, m).toISOString();
const ev = (id: string, title: string, dayOffset: number, h: number, extra: Record<string, unknown> = {}) => ({
  id, title, start: at(dayOffset, h), end: at(dayOffset, h + 1), calendar: 'Trabalho', attendees: 0, source: 'google', ...extra,
});

const allDay = (id: string, title: string, dayOffset: number, days = 1, extra: Record<string, unknown> = {}) => ({
  id, title, start: new Date(2026, 9, 9 + dayOffset).toISOString(), end: new Date(2026, 9, 9 + dayOffset + days).toISOString(), calendar: 'Pessoal', attendees: 0, source: 'eventkit', allDay: true, ...extra,
});

it('groupUpcoming: Hoje / Amanhã / "seg., 12 de out.", ignora o que já terminou e o que passa de 7 dias', () => {
  const groups = g.window.RiceHome.groupUpcoming(
    [ev('a', 'Passou', 0, 7), ev('b', 'Daily', 0, 10), ev('c', 'Amanhã cedo', 1, 8), ev('d', 'Seg', 3, 9), ev('e', 'Seg 2', 3, 11), ev('f', 'Longe', 9, 9)],
    now,
  );
  expect(groups.map((x: any) => x.label)).toEqual(['Hoje', 'Amanhã', 'seg., 12 de out.']);
  expect(groups[0].items.map((x: any) => x.id)).toEqual(['b']);
  expect(groups[2].items.map((x: any) => x.id)).toEqual(['d', 'e']);
});

it('groupUpcoming: dia inteiro separado dos com horário, repetido em cada dia que ocupa; dia vazio não aparece', () => {
  const groups = g.window.RiceHome.groupUpcoming([allDay('f', 'Feriado', 1, 2), allDay('t', 'Treinar', 0), ev('d', 'Seg', 3, 9)], now);
  expect(groups.map((x: any) => [x.label, x.allDay.map((e: any) => e.id), x.items.map((e: any) => e.id)])).toEqual([
    ['Hoje', ['t'], []],
    ['Amanhã', ['f'], []],
    ['dom., 11 de out.', ['f'], []],
    ['seg., 12 de out.', [], ['d']],
  ]);
});

function renderHome(events: any[], over: Record<string, unknown> = {}) {
  const box = g.document.createElement('div');
  const cb = { onJoin: vi.fn(), onNotes: vi.fn(), onRecord: vi.fn(), onConnect: vi.fn() };
  g.window.RiceHome.render(box, { events, now, google: { connected: true, hasClient: true }, ...cb, ...over });
  return { box, cb };
}

const evAt = (id: string, title: string, startMin: number, durMin: number, extra: Record<string, unknown> = {}) => ({
  id, title, start: new Date(now.getTime() + startMin * 60_000).toISOString(), end: new Date(now.getTime() + (startMin + durMin) * 60_000).toISOString(), calendar: 'Trabalho', attendees: 0, source: 'google', ...extra,
});
const labels = (r: any) => [...r.querySelectorAll('button')].map((b: any) => b.textContent);

it('render: monocromático (sem pontos de cor), hora | título | participantes | ações, na mesma ordem em toda linha', () => {
  const { box } = renderHome([
    ev('b', 'Daily', 0, 10, { attendees: 5, color: '#336699', joinUrl: 'https://meet.google.com/x' }),
    ev('d', 'Dentista', 0, 16),
  ]);
  expect(box.querySelector('h1').textContent).toBe('Agenda');
  expect(box.querySelector('.cal-dot')).toBeNull();
  expect(box.innerHTML).not.toMatch(/#336699|rgb\(51, 102, 153\)/);
  const rows = [...box.querySelectorAll('.event')];
  expect(rows).toHaveLength(2);
  for (const r of rows) expect([...r.children].map((c: any) => c.className.split(' ')[0])).toEqual(['ev-time', 'ev-main', 'ev-meta', 'ev-actions']);
  expect(rows[0].querySelector('.ev-time').textContent).toBe('10:00–11:00');
  expect(rows[0].querySelector('.ev-title').textContent).toBe('Daily');
  expect(rows[0].querySelector('.ev-meta').textContent).toBe('5 participantes');
});

it('agora ou em até 10 min: "Entrar" e "Gravar agora" (destacado); antes disso "Preparar notas", sempre no mesmo lugar', () => {
  const link = 'https://meet.google.com/x';
  const { box, cb } = renderHome([
    evAt('now', 'Acontecendo', -10, 30, { attendees: 3, joinUrl: link }),
    evAt('soon', 'Já já', 6, 30, { attendees: 2 }),
    evAt('later', 'Mais tarde', 120, 30, { attendees: 2, joinUrl: link }),
    evAt('nolink', 'Sem link', 180, 30, { attendees: 2 }),
    evAt('solo', 'Dentista', 240, 30),
  ]);
  const rows = [...box.querySelectorAll('.event')];
  expect(rows.map(labels)).toEqual([['Entrar', 'Gravar agora'], ['Gravar agora'], ['Preparar notas'], ['Preparar notas'], []]);
  expect(rows.map((r: any) => r.classList.contains('soon'))).toEqual([true, true, false, false, false]);
  expect(rows[0].querySelector('.ev-rec').classList.contains('hot')).toBe(true);
  // a 2ª ação é sempre o último filho (o espaço de "Entrar" é reservado)
  for (const r of rows.slice(0, 4)) expect(r.querySelector('.ev-actions').children).toHaveLength(2);
  rows[0].querySelector('.ev-join').click();
  rows[0].querySelector('.ev-rec').click();
  rows[2].querySelector('.ev-actions').lastElementChild.click();
  expect(cb.onJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 'now' }));
  expect(cb.onRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'now' }));
  expect(cb.onNotes).toHaveBeenCalledWith(expect.objectContaining({ id: 'later' }));
});

it('gravando outra reunião: sem "Gravar agora", volta "Preparar notas"', () => {
  const { box } = renderHome([evAt('now', 'Acontecendo', -10, 30, { attendees: 3 })], { recording: true });
  expect(labels(box.querySelector('.event'))).toEqual(['Preparar notas']);
});

it('"agora": marcador discreto só no evento em andamento; cabeçalho do dia: nome + data', () => {
  const { box } = renderHome([evAt('now', 'Acontecendo', -10, 30, { attendees: 3 }), evAt('later', 'Depois', 120, 30)]);
  const tags = [...box.querySelectorAll('.now-tag')];
  expect(tags.map((n: any) => n.textContent)).toEqual(['agora']);
  expect(tags[0].closest('.event').querySelector('.ev-title').textContent).toBe('Acontecendo');
  const day = box.querySelector('.day-label');
  expect(day.firstChild.textContent).toBe('Hoje');
  expect(day.querySelector('.day-date').textContent).toBe('· sex., 9 de out.');
});

it('cartão "Conecte sua agenda" só aparece sem NENHUMA fonte; leva às Configurações > Agenda', () => {
  const { box, cb } = renderHome([], { google: { connected: false, hasClient: false }, connected: false });
  const card = box.querySelector('.connect-card');
  expect(card.textContent).toContain('Conecte sua agenda');
  card.querySelector('button').click();
  expect(cb.onConnect).toHaveBeenCalled();
  // Calendário do macOS conectado (Google não): sem cartão
  expect(renderHome([], { google: { connected: false }, connected: true }).box.querySelector('.connect-card')).toBeNull();
});

it('estado vazio com alguma fonte conectada', () => {
  const { box } = renderHome([]);
  expect(box.querySelector('.connect-card')).toBeNull();
  expect(box.textContent).toContain('Nada na agenda nos próximos 7 dias.');
});

it('dia inteiro: uma linha de texto corrido ("Dia inteiro: A, B, C +N"), sem pontos nem chips, antes dos eventos com horário', () => {
  const { box } = renderHome([
    allDay('a', 'Treinar', 0, 1, { color: '#33AA66' }), allDay('b', 'Ler livro', 0), allDay('c', 'Leetcode', 0), allDay('d', 'Feriado', 0), allDay('e', 'Outro', 0),
    ev('x', 'Daily', 0, 10, { attendees: 2 }),
  ]);
  const rows = [...box.querySelectorAll('.event')];
  expect(rows[0].classList.contains('allday')).toBe(true);
  expect(rows[0].textContent).toBe('Dia inteiro: Treinar, Ler livro, Leetcode +2');
  expect(rows[0].children).toHaveLength(0);
  expect(box.querySelector('.cal-dot, .allday-item')).toBeNull();
  expect(rows[1].textContent).toContain('Daily');
});

it('em inglês: Today/Tomorrow, nomes de dias em en-US e textos da página', () => {
  g.window.RiceI18n.setLanguage('en');
  try {
    const groups = g.window.RiceHome.groupUpcoming([ev('b', 'Daily', 0, 10), ev('c', 'Early', 1, 8), ev('d', 'Mon', 3, 9)], now);
    expect(groups.map((x: any) => x.label)).toEqual(['Today', 'Tomorrow', 'Mon, Oct 12']);
    const box = g.document.createElement('div');
    g.window.RiceHome.render(box, {
      events: [ev('b', 'Daily', 0, 10, { attendees: 1, joinUrl: 'https://meet.google.com/x', start: at(0, 9, 5), end: at(0, 9, 35) }), ev('x', 'Big', 0, 12, { attendees: 3 })],
      now,
      google: { connected: false },
      connected: false,
      onJoin: vi.fn(),
      onNotes: vi.fn(),
      onConnect: vi.fn(),
    });
    const text = box.textContent;
    for (const part of ['Calendar', 'Connect your calendar', '1 attendee', '3 attendees', 'Join', 'Prep notes']) expect(text).toContain(part);
    expect(text).not.toContain('1 attendees');
  } finally {
    g.window.RiceI18n.setLanguage('pt-BR');
  }
});

it('dia inteiro de HOJE e evento em andamento aparecem em "Hoje" (fuso America/Sao_Paulo; fim do dia inteiro às 23:59:59 ou à meia-noite seguinte)', () => {
  const before = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    const sp = new Date('2026-10-10T19:00:00Z'); // sáb 10/out, 16:00 em São Paulo
    const mk = (id: string, start: string, end: string, allDay: boolean) => ({ id, title: id, start, end, calendar: 'x', attendees: 0, source: 'eventkit', allDay });
    const groups = g.window.RiceHome.groupUpcoming([
      mk('Treinar', '2026-10-10T03:00:00.000Z', '2026-10-11T02:59:59.000Z', true), // fim 23:59:59 do mesmo dia
      mk('Ler livro', '2026-10-10T03:00:00.000Z', '2026-10-11T03:00:00.000Z', true), // fim à meia-noite seguinte
      mk('Feriado', '2026-10-12T03:00:00.000Z', '2026-10-13T03:00:00.000Z', true),
      mk('Em andamento', '2026-10-10T18:00:00.000Z', '2026-10-10T20:00:00.000Z', false), // 15:00–17:00, já começou
      mk('Já acabou', '2026-10-10T14:00:00.000Z', '2026-10-10T15:00:00.000Z', false),
    ], sp);
    expect(groups.map((x: any) => [x.label, x.allDay.map((e: any) => e.id), x.items.map((e: any) => e.id)])).toEqual([
      ['Hoje', ['Treinar', 'Ler livro'], ['Em andamento']],
      ['seg., 12 de out.', ['Feriado'], []],
    ]);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

it('Início: só o campo de pergunta na linha (Nova war room fica na barra lateral), e o título vem logo depois', () => {
  const box = g.document.createElement('div');
  g.window.RiceHome.render(box, { events: [], now, google: { connected: true }, connected: true, onJoin: vi.fn(), onNotes: vi.fn(), onConnect: vi.fn(), onAsk: vi.fn(), onNewWarRoom: vi.fn() });
  const row = box.querySelector('.home-ask-row') as any;
  expect([...row.children].map((c: any) => c.className.split(' ')[0])).toEqual(['home-ask']);
  expect(box.querySelector('.home-shortcut')).toBeNull();
  expect(row.nextElementSibling.tagName).toBe('H1');
});
