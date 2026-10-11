import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/renderer/index.html', 'utf8');

it('define a escala de respiro --space-1..8 (4, 8, 12, 16, 24, 32, 48, 64) e os tokens compactos --gap-1..6', () => {
  const expected = [4, 8, 12, 16, 24, 32, 48, 64];
  expected.forEach((px, i) => expect(css).toContain(`--space-${i + 1}:${px}px`));
  for (let i = 1; i <= 6; i++) expect(css).toMatch(new RegExp(`--gap-${i}:\\d+px`));
});

it('grupos de botões têm gap mínimo de 8px (--space-3)', () => {
  for (const sel of ['.page-actions', '.ev-actions', '#rec-bar', '#ask', '.tpl-section-actions']) {
    const rule = css.split(sel + ' {')[1]?.split('}')[0] ?? '';
    expect(rule, sel).toContain('gap:var(--gap-3)');
  }
  expect(css.split('.dlg-foot {')[1]?.split('}')[0]).toContain('gap:8px'); // rodapé dos diálogos
});

it('itens da barra lateral têm 2px de espaço vertical e raio 6px', () => {
  for (const sel of ['.nav-item', '.meeting']) {
    const rule = css.split(sel + ' {')[1]?.split('}')[0] ?? '';
    expect(rule, sel).toContain('margin:0 0 var(--gap-1)');
    expect(rule, sel).toContain('border-radius:6px');
  }
});

it('botões têm padding de hover 6px 10px e foco visível', () => {
  expect(css).toMatch(/button \{[^}]*padding:6px 10px/);
  expect(css).toContain('button:focus-visible');
  expect(css).toContain('outline:2px solid var(--accent)');
});

it('barra de título integrada: faixa arrastável de 48px e botões da faixa com no-drag', () => {
  expect(css).toContain('--titlebar:48px');
  expect(css.split('#rec-bar {')[1]?.split('}')[0]).toContain('-webkit-app-region:drag');
  expect(css.split('.side-drag {')[1]?.split('}')[0]).toContain('-webkit-app-region:drag');
  expect(css.split('.win-tools {')[1]?.split('}')[0]).toContain('-webkit-app-region:no-drag');
  expect(css).toMatch(/\.win-tools button, #rec-bar button[^{]*\{ -webkit-app-region:no-drag; \}/);
});

it('campos: estilo único com tokens, borda 1px, raio 8px, padding 8×10 e anel de foco (sem outline nativo)', () => {
  const rule = css.split('textarea, select {')[1]?.split('}')[0] ?? '';
  for (const part of ['appearance:none', 'background:var(--field-bg)', 'border:1px solid var(--line)', 'border-radius:8px', 'padding:8px 10px', 'outline:none']) expect(rule).toContain(part);
  expect(css).toContain('box-shadow:0 0 0 3px var(--ring)');
  expect(css).toMatch(/--field-bg:rgba\(255,255,255,\.06\)/); // escuro
  expect(css).toContain('color:var(--muted); opacity:1'); // placeholder
  expect(css).not.toMatch(/input:focus-visible/);
});

it('padrão de diálogo: raio 14px, 520px (90vw), padding 24px; título 16px/600; campos a 14px; rótulo 12px; rodapé a 20px, botões de 32px com gap 8px', () => {
  const dialog = css.split('.dialog {')[1]?.split('}')[0] ?? '';
  for (const part of ['border-radius:14px', 'max-width:520px', 'padding:24px', 'width:min(520px,90vw)']) expect(dialog).toContain(part);
  expect(css.split('.dialog h2.dlg-title {')[1]?.split('}')[0]).toMatch(/font-size:16px; font-weight:600; line-height:1\.3/);
  expect(css.split('.dlg-body {')[1]?.split('}')[0]).toContain('gap:14px');
  expect(css.split('.dlg-label {')[1]?.split('}')[0]).toMatch(/font-size:12px; font-weight:500; color:var\(--muted\)/);
  expect(css.split('.dlg-field {')[1]?.split('}')[0]).toContain('gap:6px');
  const foot = css.split('.dlg-foot {')[1]?.split('}')[0] ?? '';
  expect(foot).toMatch(/margin-top:20px; padding-top:16px; border-top:1px solid var\(--line\)/);
  expect(foot).toContain('justify-content:flex-end');
  const btn = css.split('.dlg-foot button {')[1]?.split('}')[0] ?? '';
  expect(btn).toMatch(/height:32px[^}]*border-radius:8px/);
  expect(css).toMatch(/\.dialog button\.ghost \{[^}]*inset 0 0 0 1px var\(--line\)/); // secundário com borda, não texto solto
  expect(css).toContain('textarea::-webkit-resizer { background:transparent; }');
  expect(css).toContain('::-webkit-scrollbar-corner { background:transparent; }'); // sem alça branca nativa
  expect(css).toMatch(/input\[type=checkbox\] \{ appearance:none[^}]*width:16px; height:16px[^}]*border-radius:4px/);
  expect(css.split('.dlg-foot button.danger:disabled {')[1]?.split('}')[0]).toContain('color:var(--bad)');
});

it('logos dos provedores: arquivos locais (CSP self), máscara com cor da marca e variação no escuro', () => {
  expect(css).toContain('--brand:#D97757');
  expect(css).toContain('assets/providers/openai.svg');
  // ChatGPT é monocromático (cor do texto: branco no escuro, preto no claro) e o Gemini usa o gradiente oficial
  expect(css).toMatch(/\.logo-chatgpt \{ --brand:var\(--ink\)/);
  expect(css).not.toMatch(/\.logo-chatgpt \{[^}]*#412991/);
  expect(css).toMatch(/\.logo-gemini \{[^}]*linear-gradient\(to top right, #4796E3[^)]*#9177C7[^)]*#CA6673/);
  expect(css).not.toMatch(/https?:\/\/[^"')]*\.svg/); // nada de CDN
});

it('menus em popover (idioma e templates) usam a mesma base: padding 6px, raio 10px, itens de 30px com raio 6px e gap de 2px', () => {
  const popover = css.split('.menu-popover {')[1]?.split('}')[0] ?? '';
  for (const part of ['padding:6px', 'border-radius:10px', 'border:1px solid var(--line)']) expect(popover).toContain(part);
  const item = css.split('.menu-item {')[1]?.split('}')[0] ?? '';
  for (const part of ['min-height:30px', 'padding:6px 10px', 'border-radius:6px', 'margin:0 0 2px', 'outline:none']) expect(item).toContain(part);
  expect(css).toMatch(/\.menu-item\.active, \.menu-item:hover \{ background:var\(--hover\); \}/);
  expect(css).toMatch(/\.menu-item \.check \{[^}]*color:var\(--accent\)/);
  // os menus herdam a base
  expect(readFileSync('src/renderer/action-menu.js', 'utf8')).toContain("'menu-popover action-menu'"); // o menu de idioma usa o menu de ações
  expect(readFileSync('src/renderer/template-picker.js', 'utf8')).toContain('menu-popover tpl-popover');
  expect(readFileSync('src/renderer/template-picker.js', 'utf8')).toContain("'menu-item tpl-opt'");
});

it('sem <select> nativo no app: nenhum arquivo do renderer cria ou declara um', () => {
  for (const f of ['ai-providers', 'chat-tools', 'calendar-connect', 'language-settings', 'language-menu', 'settings', 'onboarding', 'templates', 'template-picker', 'renderer', 'home', 'menu-select']) {
    const src = readFileSync(`src/renderer/${f}.js`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(src, f).not.toMatch(/createElement\(['"]select['"]\)|el\('select'|build\('select'|<select/);
  }
  expect(css).not.toContain('<select');
});

it('configurações: um esqueleto só — título 11px caixa alta, 32px entre seções com hairline, descrição de 13px/60ch, linhas rótulo+controle, botões de 32px', () => {
  expect(css).not.toContain('.settings-page > * {'); // a coluna de 680px é a das outras páginas
  expect(css.split('.setting-section + .setting-section {')[1]?.split('}')[0]).toMatch(/margin-top:40px; padding-top:40px; border-top:1px solid var\(--line\)/);
  const h2 = css.split('.setting-section h2 {')[1]?.split('}')[0] ?? '';
  for (const p of ['margin:0 0 10px', 'font-size:11px', 'font-weight:600', 'letter-spacing:.06em', 'text-transform:uppercase', 'color:var(--muted)']) expect(h2).toContain(p);
  const desc = css.split('.set-desc {')[1]?.split('}')[0] ?? '';
  for (const p of ['max-width:60ch', 'font-size:13px', 'color:var(--muted)']) expect(desc).toContain(p);
  expect(css.split('.set-label {')[1]?.split('}')[0]).toMatch(/font-size:14px[^}]*color:var\(--ink\)/);
  expect(css.split('.set-help {')[1]?.split('}')[0]).toMatch(/font-size:12px[^}]*color:var\(--muted\)/);
  expect(css.split('.set-row {')[1]?.split('}')[0]).toMatch(/align-items:center; justify-content:space-between/);
  expect(css.split('.btn {')[1]?.split('}')[0]).toMatch(/height:32px[^}]*border-radius:8px/);
  expect(css).toMatch(/input\[type=checkbox\]\.switch \{[^}]*width:34px; height:20px/);
  expect(css).toMatch(/\.seg-btn\[aria-checked="true"\]/);
});

it('chevron dos dropdowns, segmentado e itens de menu com os tamanhos do brief', () => {
  expect(css).toMatch(/\.icon\.caret \{[^}]*width:12px[^}]*margin-left:6px[^}]*color:var\(--muted\)/);
  const seg = css.split('.segmented {')[1]?.split('}')[0] ?? '';
  for (const p of ['padding:3px', 'gap:2px', 'border-radius:10px']) expect(seg).toContain(p);
  const btn = css.split('.seg-btn {')[1]?.split('}')[0] ?? '';
  for (const p of ['padding:6px 14px', 'border-radius:7px']) expect(btn).toContain(p);
  expect(css).toMatch(/\.seg-btn\[aria-checked="true"\] \{[^}]*box-shadow:0 1px 2px/);
  expect(css).toMatch(/\.seg-btn:hover:not\(:disabled\) \{[^}]*background:var\(--hover\)/);
  expect(css.split('.menu-item {')[1]?.split('}')[0]).toContain('font-size:13px');
  expect(css).toMatch(/\.nav-item \{ display:flex; align-items:center; gap:10px; \}/);
});

it('respiro global: título/meta 24px, meta→abas 32px, abas→conteúdo 24px, blocos 32px, falas 12px, linhas ≥ 40px, texto 72ch/1.6', () => {
  expect(css).toMatch(/\.page-title \{[^}]*margin:-2px -10px var\(--space-5\)/);
  expect(css).toMatch(/\.page-meta \{[^}]*margin:0 0 var\(--space-6\)/);
  expect(css).toMatch(/\.mt-bar \{[^}]*margin:0 0 var\(--space-5\)/);
  expect(css).toMatch(/\n  h2 \{[^}]*margin:var\(--space-6\) 0 var\(--space-4\)/);
  expect(css).toMatch(/\.t-row \{ margin:0 0 var\(--space-3\); \}/);
  for (const rule of [/\.event \{[^}]*height:40px/, /\.stat-row \{[^}]*min-height:40px/, /\.wr-box-row \{[^}]*min-height:48px/]) expect(css).toMatch(rule);
  expect(css).toMatch(/\.page \.md \{ max-width:72ch; \}/);
  expect(css).toMatch(/\.md \{ line-height:1\.6; \}/);
  expect(css).toMatch(/@container detail \(max-width: 580px\) \{ \.page \{ padding-left:var\(--space-5\)/); // janela pequena: menos respiro
});

it('cabeçalho do template: chip e versões de 32px na mesma linha; vazio compacto; menu com linhas de 44px e escala de espaço', () => {
  expect(css).toMatch(/\.tpl-picker \{ display:flex;[^}]*min-height:32px/);
  expect(css).toMatch(/\.tpl-picker \.ver-host \{ margin-left:auto;/);
  expect(css).toMatch(/\.tpl-chip, \.ver-chip \{ height:32px;/);
  expect(css).toMatch(/\.tpl-picker \{ margin:0 0 var\(--space-3\); \}/);
  expect(css).toMatch(/\.tpl-sec-chip \{[^}]*padding:4px 10px[^}]*border-radius:999px/);
  expect(css).toMatch(/\.tpl-popover \.tpl-opt \{ min-height:44px; \}/);
});

it('switches em verde estilo Apple (--switch-on: claro #34C759, escuro #30D158); checkboxes comuns seguem com --accent', () => {
  expect(css).toMatch(/--switch-on:#34C759/);
  expect(css).toMatch(/--switch-on:#30D158/);
  expect(css).toMatch(/input\[type=checkbox\]\.switch:checked \{ background:var\(--switch-on\); \}/);
  expect(css).not.toMatch(/\.switch:checked \{ background:var\(--accent\)/);
});

it('responsivo: títulos das opções da Agenda quebram de linha (nada cortado nem rolagem horizontal em largura pequena)', () => {
  expect(css).toMatch(/\.ai-card\[data-option\] \.ai-head strong \{ white-space:normal; overflow-wrap:anywhere; min-width:0;/);
  expect(css).toMatch(/\.ai-card\[data-option\] \.ai-head \{ height:auto; min-height:48px;/);
});

it('responsivo: abas da reunião mais juntas em coluna muito estreita (≤360px) e com rolagem própria', () => {
  expect(css).toMatch(/\.mt-tabs \{[^}]*overflow-x:auto/);
  expect(css).toMatch(/@container detail \(max-width: 360px\) \{ \.mt-tabs \{ gap:14px; \} \.mt-tab \{ font-size:13px; \} \}/);
});

it('prévia do seletor de template: encostada no menu (sem vão), fundo opaco, cabe na coluna (abaixo quando não couber) e sem cortar a última linha', () => {
  const html = readFileSync('src/renderer/index.html', 'utf8');
  expect(html).toMatch(/\.tpl-popover-preview \{ position:absolute; top:-1px; left:calc\(100% - 1px\); width:280px;[^}]*background:var\(--bg\); border:1px solid var\(--line\); border-radius:0 10px 10px 0;/);
  expect(html).toMatch(/\.tpl-popover\.preview-below \.tpl-popover-preview \{ position:static; width:auto; max-height:none;/); // sem teto de altura: a última linha aparece
  expect(html).toMatch(/\.tpl-popover\.preview-below \.tpl-list \{ max-height:min\(160px, 18vh\); \}/);
  const js = readFileSync('src/renderer/template-picker.js', 'utf8');
  expect(js).toContain("document.getElementById('chat-scrim')"); // com o chat por cima, o limite é a borda do chat
  expect(js).toContain("popover.style.left = `${left}px`"); // o menu desloca para caber na coluna
  expect(js).toContain("popover.classList.toggle('preview-below', rect.left + left + width + 280 > limit)");
});
