// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;

function setup() {
  g.window.RiceLiveScroll = undefined;
  new Function(readFileSync('src/renderer/live-scroll.js', 'utf8'))();
  const detail = g.document.createElement('div');
  const button = g.document.createElement('button');
  button.hidden = true;
  let height = 1000;
  Object.defineProperty(detail, 'scrollHeight', { get: () => height });
  Object.defineProperty(detail, 'clientHeight', { value: 400 });
  detail.scrollTop = 0;
  const live = g.window.RiceLiveScroll.create({ detail, button });
  live.setActive(true);
  return { detail, button, live, grow: (n: number) => (height += n) };
}

it('no meio da página: segmentos novos não mexem na rolagem e o botão "Ao vivo" aparece', () => {
  const { detail, button, live, grow } = setup();
  detail.scrollTop = 300; // longe do fim (600 é o fim)
  live.follow(() => grow(40));
  expect(detail.scrollTop).toBe(300);
  expect(button.hidden).toBe(false);
});

it('no fim (±48px): acompanha o que chega e o botão fica escondido', () => {
  const { detail, button, live, grow } = setup();
  detail.scrollTop = 560; // 40px do fim
  live.follow(() => grow(60));
  expect(detail.scrollTop).toBe(1060);
  expect(button.hidden).toBe(true);
});

it('o botão volta ao fim, some e religa o acompanhamento', () => {
  const { detail, button, live, grow } = setup();
  detail.scrollTop = 100;
  live.follow(() => grow(40));
  button.click();
  expect(detail.scrollTop).toBe(1040);
  expect(button.hidden).toBe(true);
  live.follow(() => grow(30));
  expect(detail.scrollTop).toBe(1070);
});

it('sem gravação ativa o botão nunca aparece', () => {
  const { detail, button, live, grow } = setup();
  live.setActive(false);
  detail.scrollTop = 0;
  live.follow(() => grow(40));
  expect(button.hidden).toBe(true);
});

it('reunião em andamento: item fixo na barra lateral com ponto, título e tempo; o botão da faixa leva até ela', async () => {
  const meetings = [{ dir: '/R/a', title: 'Planejamento', startedAt: new Date().toISOString(), state: 'recording' }, { dir: '/R/b', title: 'Outra', startedAt: new Date().toISOString(), state: 'done' }];
  const { handlers } = bootRenderer({ sessionState: async () => ({ state: 'recording', dir: '/R/a' }) }, meetings);
  await new Promise((r) => setTimeout(r, 50));
  await handlers['session:state']!('recording');
  const item = g.document.getElementById('live-item');
  expect(item.hidden).toBe(false);
  expect(item.textContent).toMatch(/^Gravando · Planejamento · 00:0\d$/);
  expect(item.querySelector('.live-dot')).not.toBeNull();
  expect(g.document.getElementById('rec-label').textContent).toMatch(/^00:0\d · Abrir reunião$/);
  g.document.getElementById('rec').click(); // outra tela: abre a reunião em vez de parar
  await new Promise((r) => setTimeout(r, 50));
  expect(g.document.getElementById('rec-label').textContent).toBe('Parar');
  await handlers['session:state']!('idle');
  expect(g.document.getElementById('live-item').hidden).toBe(true);
});
