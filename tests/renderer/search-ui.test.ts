// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer, press, type } from '../helpers/boot-renderer';

const g = globalThis as any;
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const MEETINGS = [
  { dir: '/R/a', title: 'Planejamento do trimestre', startedAt: day(1), state: 'done' },
  { dir: '/R/b', title: 'Weekly', startedAt: day(2), state: 'done' },
];
const RESULTS = [
  {
    dir: '/R/a', title: 'Planejamento do trimestre', date: day(1), folder: null,
    hits: [
      { field: 'title', snippet: 'Planejamento do trimestre', offset: 0, marks: [[0, 5]] },
      { field: 'notes', snippet: 'Adiar a pré-venda para novembro', offset: 20, marks: [[8, 17]] },
    ],
  },
  { dir: '/R/b', title: 'Weekly', date: day(2), folder: null, hits: [{ field: 'transcript', snippet: 'a pré-venda atrasou', offset: 90, marks: [[2, 12]] }] },
];

async function boot(extra: Record<string, unknown> = {}) {
  const search = vi.fn(async () => RESULTS);
  const out = bootRenderer({ search, ...extra }, MEETINGS);
  await vi.waitFor(() => expect(g.document.querySelectorAll('.meeting').length).toBe(2));
  return { ...out, search };
}

it('busca: debounce de ~120 ms, resultados com título, data, trecho com negrito e origem', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { search } = await boot();
    const input = g.document.getElementById('search');
    type(input, 'p');
    type(input, 'pre-venda');
    await vi.advanceTimersByTimeAsync(60);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(80);
    await vi.waitFor(() => expect(g.document.querySelectorAll('.result')).toHaveLength(2));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('pre-venda');
    expect(g.document.body.classList.contains('searching')).toBe(true);
    expect(g.document.getElementById('results').hidden).toBe(false);

    const first = g.document.querySelector('.result');
    expect(first.querySelector('.r-title').textContent).toBe('Planejamento do trimestre');
    expect(first.querySelector('.r-title b').textContent).toBe('Plane');
    expect(first.querySelector('.r-date').textContent).toMatch(/\d/);
    expect(first.querySelector('.r-src').textContent).toBe('nas notas');
    expect(first.querySelector('.r-snip').textContent).toBe('Adiar a pré-venda para novembro');
    expect(first.querySelector('.r-snip b').textContent).toBe('pré-venda');
    expect(g.document.querySelectorAll('.result')[1].querySelector('.r-src').textContent).toBe('na transcrição');
    // nada de innerHTML: o trecho com tags vira texto
    expect(first.querySelector('script')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('busca: sem resultados mostra "Nenhuma reunião encontrada"; Esc limpa e volta à lista normal', async () => {
  const { search } = await boot({ search: vi.fn(async () => []) });
  void search;
  const input = g.document.getElementById('search');
  type(input, 'zzz');
  await vi.waitFor(() => expect(g.document.querySelector('.r-none')?.textContent).toBe('Nenhuma reunião encontrada.'));
  press(input, 'Escape');
  expect(input.value).toBe('');
  expect(g.document.body.classList.contains('searching')).toBe(false);
  expect(g.document.getElementById('results').hidden).toBe(true);
  expect(g.document.querySelectorAll('.meeting')).toHaveLength(2);
});

it('busca: ↑↓ percorrem os resultados (foco fica no campo) e Enter abre a reunião rolando até o trecho', async () => {
  const readMeeting = vi.fn(async (dir: string) => ({
    meta: { title: 'Planejamento do trimestre', startedAt: day(1), state: 'done', notesStatus: 'done' },
    transcript: '', annotations: '', notes: dir === '/R/a' ? '## Decisões\n\n- Seguir com o roadmap\n- Adiar a pré-venda para novembro\n' : '', chat: [],
  }));
  await boot({ readMeeting });
  const scroll = vi.fn();
  g.window.HTMLElement.prototype.scrollIntoView = scroll;
  const input = g.document.getElementById('search');
  input.focus();
  type(input, 'pre-venda');
  await vi.waitFor(() => expect(g.document.querySelectorAll('.result')).toHaveLength(2));
  press(input, 'ArrowDown');
  expect(g.document.querySelector('.result.selected').dataset.dir).toBe('/R/a');
  expect(input.getAttribute('aria-activedescendant')).toBe('result-0');
  press(input, 'ArrowDown');
  expect(g.document.querySelector('.result.selected').dataset.dir).toBe('/R/b');
  press(input, 'ArrowUp');
  expect(g.document.querySelector('.result.selected').dataset.dir).toBe('/R/a');
  expect(g.document.activeElement).toBe(input);

  press(input, 'Enter');
  await vi.waitFor(() => expect(readMeeting).toHaveBeenCalledWith('/R/a'));
  await vi.waitFor(() => expect(g.document.querySelector('mark.hit-flash')).not.toBeNull());
  const mark = g.document.querySelector('mark.hit-flash');
  expect(mark.textContent).toBe('pré'); // a palavra buscada "pre" (sem acento) acha "pré" no texto
  expect(mark.closest('li').textContent).toContain('Adiar a pré-venda');
  expect(scroll).toHaveBeenCalled();
  // a busca continua aberta, com a reunião aberta marcada
  expect(g.document.querySelector('.result.open').dataset.dir).toBe('/R/a');
});

it('busca: o realce some depois de ~1,5 s e deixa o texto como estava', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const readMeeting = async () => ({
      meta: { title: 'Planejamento do trimestre', startedAt: day(1), state: 'done', notesStatus: 'done' },
      transcript: '**[10:00:00] Outros:** a pré-venda atrasou\n\n', annotations: '', notes: '', chat: [],
    });
    await boot({ readMeeting, search: vi.fn(async () => [RESULTS[1]]) });
    g.window.HTMLElement.prototype.scrollIntoView = () => {};
    type(g.document.getElementById('search'), 'venda');
    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() => expect(g.document.querySelectorAll('.result')).toHaveLength(1));
    g.document.querySelector('.result').click();
    await vi.waitFor(() => expect(g.document.querySelector('.t-row mark.hit-flash')?.textContent).toBe('venda'));
    await vi.advanceTimersByTimeAsync(1700);
    expect(g.document.querySelector('mark.hit-flash')).toBeNull();
    expect(g.document.querySelector('.t-row .t-text').textContent).toBe('a pré-venda atrasou');
  } finally {
    vi.useRealTimers();
  }
});

it('busca: resposta antiga não sobrescreve a mais nova', async () => {
  let release: (v: any) => void = () => {};
  const slow = new Promise((r) => (release = r));
  const search = vi.fn(async (q: string) => (q === 'ab' ? slow : [RESULTS[1]]));
  await boot({ search });
  const input = g.document.getElementById('search');
  type(input, 'ab');
  await vi.waitFor(() => expect(search).toHaveBeenCalledWith('ab'));
  type(input, 'abc');
  await vi.waitFor(() => expect(g.document.querySelectorAll('.result')).toHaveLength(1));
  release(RESULTS);
  await new Promise((r) => setTimeout(r, 20));
  expect(g.document.querySelectorAll('.result')).toHaveLength(1);
  expect(g.document.querySelector('.result').dataset.dir).toBe('/R/b');
});
