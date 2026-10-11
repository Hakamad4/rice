// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer, press, type } from '../helpers/boot-renderer';

const g = globalThis as any;

function chips(value: string[] = [], onChange = vi.fn()) {
  bootRenderer({}, []);
  const c = g.window.RiceChips.create({ value, placeholder: 'Adicionar termo e Enter', removeLabel: (t: string) => `Remover ${t}`, onChange });
  g.document.body.append(c.root);
  return { c, onChange, labels: () => [...c.root.querySelectorAll('.chip-text')].map((n: any) => n.textContent) };
}
const paste = (input: any, text: string) => {
  const e: any = new g.window.Event('paste', { bubbles: true, cancelable: true });
  e.clipboardData = { getData: () => text };
  input.dispatchEvent(e);
  return e.defaultPrevented;
};

it('Enter cria um chip; vírgula também; vazio não cria nada', () => {
  const { c, onChange, labels } = chips();
  type(c.input, 'Bem-te-vi');
  press(c.input, 'Enter');
  expect(labels()).toEqual(['Bem-te-vi']);
  expect(c.input.value).toBe('');
  type(c.input, 'OKR');
  press(c.input, ',');
  expect(labels()).toEqual(['Bem-te-vi', 'OKR']);
  press(c.input, 'Enter'); // campo vazio
  expect(labels()).toHaveLength(2);
  expect(onChange).toHaveBeenLastCalledWith(['Bem-te-vi', 'OKR']);
  expect(onChange).toHaveBeenCalledTimes(2);
});

it('× remove o chip e devolve o foco ao campo; Backspace no campo vazio remove o último', () => {
  const { c, onChange, labels } = chips(['a', 'b', 'c']);
  c.root.querySelectorAll('.chip-x')[1].click();
  expect(labels()).toEqual(['a', 'c']);
  expect(g.document.activeElement).toBe(c.input);
  expect(onChange).toHaveBeenLastCalledWith(['a', 'c']);
  type(c.input, 'x');
  press(c.input, 'Backspace'); // campo com texto: Backspace normal, não remove chip
  expect(labels()).toEqual(['a', 'c']);
  c.input.value = '';
  press(c.input, 'Backspace');
  expect(labels()).toEqual(['a']);
  press(c.input, 'Backspace');
  press(c.input, 'Backspace'); // sem chips: nada
  expect(labels()).toEqual([]);
});

it('colar várias linhas cria vários chips; uma palavra só vira texto normal', () => {
  const { c, labels } = chips(['Ana']);
  expect(paste(c.input, 'Horizonte\nBem-te-vi\r\n  Sprint  \n\nana')).toBe(true); // "ana" repetido (outra caixa) é ignorado
  expect(labels()).toEqual(['Ana', 'Horizonte', 'Bem-te-vi', 'Sprint']);
  expect(paste(c.input, 'palavra')).toBe(false); // sem quebra: o campo cuida
  expect(paste(c.input, 'um, dois; três')).toBe(true);
  expect(labels().slice(-3)).toEqual(['um', 'dois', 'três']);
});

it('duplicatas são ignoradas sem diferenciar maiúsculas e minúsculas, e o texto fica no campo', () => {
  const { c, onChange, labels } = chips(['OKR']);
  type(c.input, 'okr');
  press(c.input, 'Enter');
  expect(labels()).toEqual(['OKR']);
  expect(onChange).not.toHaveBeenCalled();
  type(c.input, 'Ação');
  press(c.input, 'Enter');
  type(c.input, 'AÇÃO');
  press(c.input, 'Enter');
  expect(labels()).toEqual(['OKR', 'Ação']);
});

it('sair do campo com texto digitado cria o chip (nada se perde)', () => {
  const { c, labels } = chips();
  type(c.input, 'Pendente');
  c.input.dispatchEvent(new g.window.Event('blur'));
  expect(labels()).toEqual(['Pendente']);
  expect(c.input.value).toBe('');
});

it('termo longo é cortado e espaços colapsam; o texto do chip nunca vira HTML', () => {
  const { c, labels } = chips();
  type(c.input, `  a   b ${'x'.repeat(100)}`);
  press(c.input, 'Enter');
  expect(labels()[0]!.length).toBeLessThanOrEqual(60);
  expect(labels()[0]!.startsWith('a b x')).toBe(true);
  type(c.input, '<img src=x onerror=1>');
  press(c.input, 'Enter');
  expect(c.root.querySelector('img')).toBeNull();
  expect(labels()[1]).toBe('<img src=x onerror=1>');
});

it('Configurações: chips vêm do settings.vocabulary (uma linha por termo) e salvam no mesmo formato, com debounce', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const setVocabulary = vi.fn(async () => ({ ok: true }));
    bootRenderer({ setVocabulary, aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }), getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, vocabulary: 'Horizonte\nBem-te-vi\nhorizonte, OKR', vocabularyAttendees: true }) }, []);
    g.document.getElementById('settings-link').click();
    await vi.waitFor(() => expect(g.document.getElementById('vocab-input')).not.toBeNull());
    expect([...g.document.querySelectorAll('.chip-text')].map((n: any) => n.textContent)).toEqual(['Horizonte', 'Bem-te-vi', 'OKR']);
    g.document.querySelector('.chip-x').click();
    type(g.document.getElementById('vocab-input'), 'Sprint');
    press(g.document.getElementById('vocab-input'), 'Enter');
    expect(setVocabulary).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(setVocabulary).toHaveBeenCalledTimes(1);
    expect(setVocabulary).toHaveBeenCalledWith('Bem-te-vi\nOKR\nSprint', true);
  } finally {
    vi.useRealTimers();
  }
});

it('visual: contêiner com o estilo dos campos, chips com raio de 6px e 12px, × pequeno em cor secundária', () => {
  const html = readFileSync('src/renderer/index.html', 'utf8');
  const rule = (sel: string) => html.split('\n').find((l) => l.trimStart().startsWith(sel)) ?? '';
  expect(rule('.chips {')).toMatch(/border:1px solid var\(--line\).*border-radius:8px.*background:var\(--field-bg\)/);
  expect(rule('.chips {')).toContain('flex-wrap:wrap');
  expect(rule('.chip {')).toMatch(/border-radius:6px.*font-size:12px/);
  expect(rule('.chip-x {')).toContain('color:var(--muted)');
});
