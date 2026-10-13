// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Planejamento', startedAt: '2026-01-01T10:00:00-03:00', state: 'done' }];
const tick = () => new Promise((r) => setTimeout(r, 40));

async function setup(over: Record<string, unknown> = {}) {
  const pauseRecording = vi.fn(async () => ({ ok: true, paused: true }));
  const unpauseRecording = vi.fn(async () => ({ ok: true, paused: false }));
  const { handlers } = bootRenderer({
    sessionState: async () => ({ state: 'recording', dir: '/R/a', paused: false }),
    readMeeting: async () => ({ meta: { notesStatus: 'done', ...meetings[0] }, transcript: '# T\n\n**[10:00:05] Eu:** abrindo\n', annotations: '', notes: '', chat: [] }),
    saveAnnotations: async () => ({ ok: true }),
    attachList: async () => ({ items: [], images: { supported: true, provider: 'claude-api' } }),
    pauseRecording,
    unpauseRecording,
    ...over,
  }, meetings);
  await tick();
  handlers['session:state']!('recording');
  await tick();
  await tick();
  return { handlers, pauseRecording, unpauseRecording };
}
const pauseBtn = () => g.document.getElementById('pause') as any;

it('"Pausar" ao lado de "Parar" só gravando; pausado, o estado vive no próprio botão ("Continuar · 00:00", play, âmbar) e não há selo separado', async () => {
  const { handlers, pauseRecording, unpauseRecording } = await setup();
  expect(pauseBtn().hidden).toBe(false);
  expect(pauseBtn().textContent).toBe('Pausar');
  expect(pauseBtn().querySelector('svg.icon-pause')).toBeTruthy(); // ícone de linha, sem emoji
  expect(g.document.getElementById('paused-badge')).toBeNull();
  pauseBtn().click();
  expect(pauseRecording).toHaveBeenCalledTimes(1);
  handlers['session:pause']!({ dir: '/R/a', paused: true });
  expect(pauseBtn().textContent).toMatch(/^Continuar · \d\d:\d\d$/);
  expect(pauseBtn().classList.contains('paused')).toBe(true);
  expect(pauseBtn().querySelector('svg.icon-play')).toBeTruthy();
  expect(pauseBtn().getAttribute('aria-label')).toMatch(/^Continuar a gravação · Pausado \d\d:\d\d$/); // faixa estreita: só o ícone, com o estado no title
  expect(pauseBtn().title).toBe(pauseBtn().getAttribute('aria-label'));
  pauseBtn().click();
  expect(unpauseRecording).toHaveBeenCalledTimes(1);
  handlers['session:pause']!({ dir: '/R/a', paused: false });
  expect(pauseBtn().textContent).toBe('Pausar');
  expect(pauseBtn().classList.contains('paused')).toBe(false);
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.pause-btn\.paused \{ color:var\(--warn\); \}/);
});

it('pausado, a barra lateral diz "Pausado" e o ponto fica âmbar e parado (item ao vivo, item da reunião, cartão do Início); continuar volta a "Gravando" e vermelho', async () => {
  const { handlers } = await setup();
  const dots = () => [...g.document.querySelectorAll('.live-dot')] as any[];
  const live = () => (g.document.querySelector('#live-item .live-text') as any).textContent as string;
  expect(live()).toMatch(/^Gravando · /);
  expect(dots().length).toBeGreaterThanOrEqual(1);
  expect(dots().every((d) => !d.classList.contains('paused'))).toBe(true);
  handlers['session:pause']!({ dir: '/R/a', paused: true });
  await tick();
  expect(live()).toMatch(/^Pausado · /);
  expect(live()).not.toContain('Gravando');
  expect(dots().length).toBeGreaterThanOrEqual(2); // item ao vivo + item da reunião na lista
  expect(dots().every((d) => d.classList.contains('paused'))).toBe(true);
  expect([...g.document.querySelectorAll('.meeting .live-dot')].every((d: any) => d.title === 'Pausado')).toBe(true);
  expect(g.document.getElementById('rec').classList.contains('paused')).toBe(true); // o ponto do "Parar" também
  const css = (await import('node:fs')).readFileSync('src/renderer/index.html', 'utf8');
  expect(css).toMatch(/\.live-dot\.paused \{ background:var\(--warn\); animation:none; \}/);
  expect(css).toMatch(/#rec\.recording\.paused \.rec-dot \{ background:var\(--warn\); animation:none; \}/);
  handlers['session:pause']!({ dir: '/R/a', paused: false });
  await tick();
  expect(live()).toMatch(/^Gravando · /);
  expect(dots().every((d) => !d.classList.contains('paused'))).toBe(true);
});

it('fora da gravação o botão e o selo não aparecem', async () => {
  const { handlers } = await setup({ sessionState: async () => ({ state: 'idle', dir: null, paused: false }) });
  handlers['session:state']!('idle');
  await tick();
  expect(pauseBtn().hidden).toBe(true);
});

it('já abre pausado quando o app recarrega com a gravação pausada', async () => {
  await setup({ sessionState: async () => ({ state: 'recording', dir: '/R/a', paused: true }) });
  expect(pauseBtn().textContent).toMatch(/^Continuar/);
});

it('o relógio da gravação para enquanto pausado e não conta o tempo parado', async () => {
  const real = Date.now;
  let now = real();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const { handlers } = await setup();
    const label = () => (g.document.querySelector('#live-item .live-text') as any)?.textContent ?? '';
    now += 65_000;
    handlers['session:state']!('recording');
    await tick();
    const before = label();
    expect(before).toMatch(/01:0[45]/);
    handlers['session:pause']!({ dir: '/R/a', paused: true });
    now += 10 * 60_000; // dez minutos pausado
    handlers['session:pause']!({ dir: '/R/a', paused: true });
    expect(label()).toMatch(/01:0[45]/);
    expect(label()).toMatch(/^Pausado · /);
    handlers['session:pause']!({ dir: '/R/a', paused: false, line: '*[gravação pausada de 10:01 a 10:11]*' });
    expect(label()).toMatch(/01:0[45]|01:0[67]/); // retoma de onde parou
    expect(label()).toMatch(/^Gravando · /);
  } finally {
    vi.restoreAllMocks();
  }
});

it('ao continuar, o marcador "gravação pausada de 14:03 a 14:07" (mesmo estilo do de repouso e do de retomada) entra discreto na transcrição ao vivo, só na reunião aberta', async () => {
  const { handlers } = await setup();
  g.document.querySelector('.meeting').click();
  await tick();
  await tick();
  [...g.document.querySelectorAll('.mt-tab')].find((b: any) => b.textContent === 'Transcrição').click();
  await tick();
  handlers['session:pause']!({ dir: '/R/a', paused: true });
  handlers['session:pause']!({ dir: '/R/a', paused: false, line: '*[gravação pausada de 14:03 a 14:07]*' });
  const gap = [...g.document.querySelectorAll('.transcript .t-gap')].map((r: any) => r.textContent);
  expect(gap).toContain('gravação pausada de 14:03 a 14:07');
  handlers['session:pause']!({ dir: '/outra', paused: false, line: '*[gravação pausada de 09:00 a 09:01]*' });
  expect([...g.document.querySelectorAll('.transcript .t-gap')].map((r: any) => r.textContent)).not.toContain('gravação pausada de 09:00 a 09:01');
});
