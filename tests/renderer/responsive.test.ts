// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered, tokenValue } from '../helpers/tokens';

const g = globalThis as any;
const html = rendered('src/renderer/index.html');
const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const now = new Date().toISOString();
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: now, state: 'done', notesStatus: 'done' }];

it('faixa do topo: contêiner com a ordem pedida — Pergunte ao Rice vira ícone, depois o idioma, depois o Gravar (ponto + curto, e só o ponto)', () => {
  expect(css).toMatch(/#rec-bar \{ container-type:inline-size; container-name:recbar; \}/);
  const widths = [...css.matchAll(/@container recbar \(max-width: (\d+)px\) \{([^\n]*)/g)].map((m) => ({ w: Number(m[1]), body: m[2]! }));
  expect(widths.map((x) => x.w)).toEqual([600, 500, 420, 330]); // do primeiro corte ao último
  expect(widths[0]!.body).toContain('#chat-toggle');
  expect(widths[1]!.body).toContain('.lang-chip');
  expect(widths[2]!.body).toContain('.rec-short');
  expect(widths[3]!.body).toMatch(/#rec \{ width:32px; height:32px/);
  // nunca reticências em botão da faixa
  expect(css).not.toMatch(/#rec-bar #chat-toggle \{[^}]*text-overflow/);
  // alvos de 32px
  expect(css).toMatch(/#chat-toggle \{[^}]*height:32px/);
  expect(css).toMatch(/\.lang-chip \{[^}]*height:32px/);
});

it('botões que viram ícone mantêm o texto completo no tooltip e no aria-label (i18n)', async () => {
  bootRenderer({}, MEETINGS);
  const toggle = g.document.getElementById('chat-toggle');
  expect(toggle.querySelector('.ico svg.icon-message-circle')).not.toBeNull();
  expect(toggle.querySelector('.lbl').textContent).toBe('Pergunte ao Rice');
  expect(toggle.title).toBe('Pergunte ao Rice');
  expect(toggle.getAttribute('aria-label')).toBe('Pergunte ao Rice');
  const rec = g.document.getElementById('rec');
  expect(rec.title).toBe('Gravar');
  expect(rec.getAttribute('aria-label')).toBe('Gravar');
  const chip = g.document.querySelector('.lang-chip');
  expect(chip.title).toBe('Idioma');
  expect(chip.getAttribute('aria-label')).toBe('Idioma');
  expect(chip.querySelector('.lang-short').textContent).toBe('PT');
});

it('Gravar: rótulo longo ("Continuar gravação") e curto ("Gravar"); tooltip e aria-label sempre com o texto completo', async () => {
  const sessionState = vi.fn(async () => ({ state: 'idle', dir: null as string | null }));
  const { handlers } = bootRenderer({ sessionState }, MEETINGS);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.getElementById('rec-label').textContent).toBe('Continuar gravação'));
  expect(g.document.getElementById('rec-short').textContent).toBe('Gravar');
  expect(g.document.getElementById('rec').title).toBe('Continuar gravação');
  sessionState.mockImplementation(async () => ({ state: 'recording', dir: '/R/a' }));
  await handlers['session:state']!('recording');
  await vi.waitFor(() => expect(g.document.getElementById('rec-label').textContent).toBe('Parar'));
  expect(g.document.getElementById('rec-short').textContent).toBe('Parar');
  expect(g.document.getElementById('rec').getAttribute('aria-label')).toBe('Parar');
});

it('Início: título e margens fluidos, cartão do Google em coluna quando estreito, campo com 3 textos (exemplo, rótulo, curto) e ⌘J que some', async () => {
  expect(tokenValue('--title-size')).toBe('clamp(22px, 5cqi, 30px)');
  expect(css).toMatch(/\.page-title \{ font-size:clamp\(22px, 5cqi, 30px\)/);
  expect(css).toMatch(/\.page \{[^}]*padding:24px clamp\(40px, 6cqi, 64px\)/); // coluna central: mínimo de 40px, fluida; em container estreito (≤520px) cai para 24px
  expect(css).toMatch(/#detail \{[^}]*container-type:inline-size; container-name:detail/);
  expect(css).toMatch(/@container detail \(max-width: 520px\) \{ \.connect-card \{ flex-direction:column; align-items:flex-start/);
  expect(css).toMatch(/@container detail \(max-width: 760px\) \{ \.ask-ph \.ph-long \{ display:none; \} \.ask-ph \.ph-mid \{ display:inline; \}/);
  expect(css).toMatch(/@container detail \(max-width: 420px\) \{[^\n]*\.ph-short \{ display:inline; \}/);
  expect(css).toMatch(/@container detail \(max-width: 360px\) \{ \.home-ask kbd \{ display:none; \} \}/);
  bootRenderer({}, MEETINGS);
  await vi.waitFor(() => expect(g.document.querySelector('.home-ask')).not.toBeNull());
  expect([...g.document.querySelectorAll('.ask-ph span')].map((s: any) => s.className)).toEqual(['ph-long', 'ph-mid', 'ph-short']);
  expect(g.document.querySelector('.ph-mid').textContent).toBe('Pergunte sobre suas reuniões');
  expect(g.document.querySelector('.ph-short').textContent).toBe('Pergunte…');
  expect(g.document.querySelector('.home-ask kbd').textContent).toBe('⌘J');
  expect(css).toMatch(/#home-ask-input:not\(:placeholder-shown\) ~ \.ask-ph \{ display:none; \}/); // com texto digitado o exemplo some
});

it('layout: ≤1000px com o chat aberto a sidebar recolhe sozinha; ≤760px o chat vira overlay à direita com sombra', () => {
  expect(css).toMatch(/@media \(max-width: 1000px\) \{[^@]*body\.chat-open:not\(\.side-open\) \{ grid-template-columns:0 minmax\(0,1fr\) var\(--chat-w\)/);
  expect(css).toMatch(/body\.chat-open:not\(\.side-open\) aside \{ visibility:hidden/);
  expect(css).toMatch(/@media \(max-width: 760px\) \{[^@]*grid-template-columns:0 minmax\(0,1fr\) 0/);
  const overlay = css.split('body.chat-open #chat {')[1]?.split('}')[0] ?? '';
  for (const p of ['position:fixed', 'right:0', 'box-shadow:-12px 0 32px', 'z-index:30']) expect(overlay).toContain(p);
  // a regra do overlay vem DEPOIS e vence a da sidebar (especificidade igual)
  expect(css.indexOf('@media (max-width: 760px)')).toBeGreaterThan(css.indexOf('@media (max-width: 1000px)'));
});

it('botão da sidebar com o chat aberto numa janela estreita: reabre à mão (side-open) e volta ao normal quando o chat fecha', async () => {
  const mm = vi.fn((q: string) => ({ matches: /1000/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  g.window.matchMedia = mm;
  bootRenderer({}, MEETINGS);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.body.classList.contains('chat-open')).toBe(true));
  g.document.getElementById('sidebar-toggle').click();
  expect(g.document.body.classList.contains('side-open')).toBe(true);
  expect(g.document.body.classList.contains('side-collapsed')).toBe(false); // a preferência salva não mudou
  g.document.getElementById('sidebar-toggle').click(); // de novo: volta a recolher
  expect(g.document.body.classList.contains('side-open')).toBe(false);
  g.document.getElementById('sidebar-toggle').click();
  expect(g.document.body.classList.contains('side-open')).toBe(true);
  g.document.getElementById('chat-toggle').click(); // fecha o chat
  expect(g.document.body.classList.contains('chat-open')).toBe(false);
  expect(g.document.body.classList.contains('side-open')).toBe(false);
});

it('barra lateral: nome com reticências e contagem que não corta', () => {
  expect(css).toMatch(/\.folder-name \{[^}]*min-width:0[^}]*text-overflow:ellipsis/);
  expect(css).toMatch(/\.folder-count \{[^}]*flex:none/);
  expect(css).toMatch(/\.meeting \.m-title \{[^}]*text-overflow:ellipsis/);
});

it('Gravar só com o ponto: o ponto é um círculo fixo (não achata) e o botão é um quadrado de 32px com o ponto centralizado', () => {
  const dot = css.split('.rec-dot {')[1]?.split('}')[0] ?? '';
  for (const p of ['flex:none', 'width:8px', 'height:8px', 'min-width:8px', 'min-height:8px', 'aspect-ratio:1', 'border-radius:50%']) expect(dot).toContain(p);
  const only = css.split('@container recbar (max-width: 330px) {')[1]?.split('\n')[0] ?? '';
  for (const p of ['width:32px', 'height:32px', 'min-width:32px', 'padding:0', 'justify-content:center', 'align-items:center', 'aspect-ratio:1']) expect(only).toContain(p);
});

it('chat por cima em janela estreita (≤760px): fundo escurecido que fecha ao clicar, botão de fechar no cabeçalho e Esc', async () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.chat-scrim \{ display:none; position:fixed; inset:0; z-index:29; background:var\(--scrim\);/);
  expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*?body\.chat-open \.chat-scrim \{ display:block; \} body\.chat-open \.chat-close \{ display:inline-flex; \}/);
  expect(css).toMatch(/\.chat-close \{ display:none; flex:none; \}/); // só aparece no modo por cima
  expect(css).toContain('<div class="chat-scrim" id="chat-scrim"');
  expect(css).toMatch(/id="chat-close"[^>]*aria-label="Fechar"/);
});

it('clicar no fundo escurecido, no botão de fechar ou apertar Esc fecha o chat quando está por cima', async () => {
  bootRenderer({}, [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }]);
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  g.document.querySelector('.meeting').click();
  await vi.waitFor(() => expect(g.document.querySelector('.mt-tab')).not.toBeNull());
  const scrim = g.document.getElementById('chat-scrim');
  scrim.style.display = 'block'; // o CSS da janela estreita (media query) não existe no happy-dom: simula o modo por cima
  const open = () => g.document.body.classList.contains('chat-open');
  if (!open()) g.document.getElementById('chat-toggle').click();
  expect(open()).toBe(true);
  scrim.click();
  expect(open()).toBe(false);
  g.document.getElementById('chat-toggle').click();
  expect(open()).toBe(true);
  g.document.getElementById('chat-close').click();
  expect(open()).toBe(false);
  g.document.getElementById('chat-toggle').click();
  g.document.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(open()).toBe(false);
});
