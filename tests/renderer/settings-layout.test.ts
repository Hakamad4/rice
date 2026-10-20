// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;

async function open(extra: Record<string, unknown> = {}, lang: 'pt-BR' | 'en' = 'pt-BR', count = 14) {
  const out = bootRenderer({
    uiLanguage: lang,
    getSettings: async () => ({ root: '/Users/x/Rice', rootDisplay: '~/Rice', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, identifySpeakers: false, vocabulary: 'OKR', vocabularyAttendees: true }),
    setKeepAudio: vi.fn(async () => ({ ok: true })),
    setIdentifySpeakers: vi.fn(async () => ({ ok: true })),
    setVocabulary: vi.fn(async () => ({ ok: true })),
    revealRoot: vi.fn(async () => ({ ok: true })),
    chooseRoot: vi.fn(async () => ({})),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    ...extra,
  }, []);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelectorAll('.settings-page .setting-section').length).toBe(count));
  return out;
}
const sections = () => [...g.document.querySelectorAll('.settings-page .setting-section')] as any[];

it('toda seção segue o esqueleto: <h2> primeiro, descrição opcional, depois o conteúdo', async () => {
  await open();
  expect(sections().map((s) => s.querySelector('h2').textContent)).toEqual(['Idioma', 'Pasta das reuniões', 'Inteligência artificial', 'Agenda', 'Vocabulário', 'Participantes', 'Capturas de tela', 'Memória', 'Pendências', 'Ferramentas e MCPs no chat', 'Áudio', 'Privacidade e segurança', 'Atalhos', 'Atualizações']);
  for (const s of sections()) {
    expect(s.firstElementChild.tagName).toBe('H2');
    expect(s.querySelectorAll('h2')).toHaveLength(1);
    expect(s.querySelector('h3, .setting-label, .setting-field')).toBeNull(); // sem estilos antigos
  }
  expect(g.document.querySelector('.settings-page > h1').textContent).toBe('Configurações');
});

it('linhas "rótulo à esquerda, controle à direita" (idioma, participantes, áudio, agenda) com a explicação embaixo do rótulo', async () => {
  await open();
  const rows = [...g.document.querySelectorAll('.settings-page .set-row')] as any[];
  expect(rows.map((r) => r.querySelector('.set-label').textContent)).toEqual([
    'Idioma do app', 'Idioma das reuniões', 'Limite de ciclos por reunião', 'Incluir os participantes do evento da agenda', 'Identificar participantes (beta)', 'Capturar a tela durante a gravação', 'Avisar quando uma pendência minha vence', 'Permitir ferramentas e MCPs no chat (por sua conta e risco)', 'Escolher o microfone automaticamente', 'Manter o áudio das reuniões', 'Modo 100% local', 'Lembrar de avisar os participantes', 'Ocultar dados pessoais ao enviar para a IA', 'Áudio', 'Reunião inteira', 'Procurar atualizações automaticamente',
  ]);
  for (const r of rows) {
    expect(r.firstElementChild.className).toBe('set-text'); // rótulo + ajuda à esquerda
    expect(r.lastElementChild.className).toBe('set-control'); // controle à direita
    const help = r.querySelector('.set-help');
    if (help) expect(help.previousElementSibling.className).toBe('set-label'); // a explicação vem logo abaixo do rótulo
  }
  expect(rows[0].querySelector('[role=radiogroup]')).not.toBeNull();
  expect([...rows[1].querySelectorAll('[role=radio]')].map((b: any) => b.textContent)).toEqual(['Português', 'English', 'Automático']);
});

it('interruptores no lugar de checkbox: switch estilizado à direita, com os mesmos ids e o mesmo efeito', async () => {
  const rice = (await open()).rice;
  for (const id of ['vocab-attendees', 'identify-speakers', 'keep-audio']) {
    const sw = g.document.getElementById(id);
    expect(sw.classList.contains('switch'), id).toBe(true);
    expect(sw.getAttribute('role'), id).toBe('switch');
    expect(sw.getAttribute('aria-label'), id).toBeTruthy();
    expect(sw.closest('.set-control'), id).not.toBeNull();
  }
  const keep = g.document.getElementById('keep-audio');
  expect(keep.checked).toBe(true);
  keep.checked = false;
  keep.onchange();
  expect(rice.setKeepAudio).toHaveBeenCalledWith(false);
  const identify = g.document.getElementById('identify-speakers');
  identify.checked = true;
  identify.onchange();
  expect(rice.setIdentifySpeakers).toHaveBeenCalledWith(true);
});

it('pasta das reuniões: ícone, caminho curto em fonte normal (sem caixa de código) e dois botões ghost iguais', async () => {
  const rice = (await open()).rice;
  const block = g.document.querySelector('.settings-page .folder-block-row');
  expect(block.querySelector('svg.icon-folder')).not.toBeNull();
  const path = block.querySelector('.folder-path');
  expect(path.textContent).toBe('~/Rice');
  expect(path.title).toBe('/Users/x/Rice'); // o completo no tooltip
  expect(sections()[1].querySelector('code')).toBeNull();
  const buttons = [...block.querySelectorAll('.folder-actions button')] as any[];
  expect(buttons.map((b) => b.textContent)).toEqual(['Mostrar no Finder', 'Alterar…']);
  expect(buttons.every((b) => b.className === 'btn ghost')).toBe(true);
  buttons[0].click();
  expect(rice.revealRoot).toHaveBeenCalled();
  buttons[1].click();
  await vi.waitFor(() => expect(rice.chooseRoot).toHaveBeenCalled());
  // a frase do que é salvo ali fica abaixo, em tom secundário
  expect(block.nextElementSibling.className).toBe('set-desc');
  expect(block.nextElementSibling.textContent).toContain('Cada reunião vira uma pasta aqui');
});

it('vocabulário: campo de chips na largura toda abaixo da descrição; a opção da agenda é uma linha com switch', async () => {
  await open();
  const vocab = sections()[4];
  expect(vocab.children[1].className).toBe('set-desc');
  expect(vocab.children[2].className).toBe('chips');
  expect(vocab.children[3].className).toBe('set-row inline'); // switch: fica ao lado do rótulo mesmo em coluna estreita
  expect(vocab.querySelector('.set-row .switch')).not.toBeNull();
});

it('em inglês: mesmos blocos, textos traduzidos', async () => {
  await open({}, 'en');
  expect(sections().map((s) => s.querySelector('h2').textContent)).toEqual(['Language', 'Meetings folder', 'Artificial intelligence', 'Calendar', 'Vocabulary', 'Participants', 'Screenshots', 'Memory', 'Follow-ups', 'Tools and MCPs in chat', 'Audio', 'Privacy and security', 'Shortcuts', 'Updates']);
  expect([...g.document.querySelectorAll('.folder-actions button')].map((b: any) => b.textContent)).toEqual(['Show in Finder', 'Change…']);
});

const css = [...rendered('src/renderer/index.html').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

it('responsivo (≤560px): linhas rótulo+controle viram coluna, segmentado em largura total com segmentos iguais, switches ficam ao lado do rótulo', async () => {
  const block = css.split('@container detail (max-width: 520px) {').slice(1).map((b) => b.split('\n  }\n')[0]).join('\n') // blocos de mesma largura (breakpoints fundidos) valem juntos;
  expect(block).toMatch(/\.set-row:not\(\.inline\) \{ flex-direction:column; align-items:stretch/);
  expect(block).toMatch(/\.set-row:not\(\.inline\) \.set-text \{ max-width:none; \}/);
  expect(block).toMatch(/\.set-row:not\(\.inline\) \.segmented \{ display:flex; width:100%; \}/);
  expect(block).toMatch(/\.set-row:not\(\.inline\) \.seg-btn \{ flex:1; text-align:center/);
  expect(block).toMatch(/\.folder-block-row \{ flex-wrap:wrap; \}/);
  expect(block).toMatch(/\.folder-actions \.btn \{ flex:1; \}/);
  await open();
  const rows = [...g.document.querySelectorAll('.settings-page .set-row')] as any[];
  expect(rows.map((r) => r.classList.contains('inline'))).toEqual([false, false, false, true, true, true, true, true, true, true, true, true, true, false, false, true]); // só os interruptores (e os dois menus da guarda padrão) ficam lado a lado
});

it('responsivo: caminho longo da pasta é cortado no meio (completo no tooltip) e nada quebra palavra por palavra', async () => {
  const long = '/Users/maria/Documents/Clientes/Acme/Reuniões de planejamento/2026/Rice';
  await open({ getSettings: async () => ({ root: long, rootDisplay: '~/Documents/Clientes/Acme/Reuniões de planejamento/2026/Rice', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true }) });
  const path = g.document.querySelector('.folder-path');
  expect(path.textContent.length).toBeLessThanOrEqual(44);
  expect(path.textContent).toContain('…');
  expect(path.textContent.startsWith('~/Documents')).toBe(true);
  expect(path.textContent.endsWith('/2026/Rice')).toBe(true);
  expect(path.title).toBe(long);
  expect(css).toMatch(/\.folder-path \{[^}]*text-overflow:ellipsis/); // e reticências de segurança
  expect(css).toMatch(/\.chips \{[^}]*flex-wrap:wrap/); // chips quebram linha
});

it('seção Agenda: depois de "Inteligência artificial", com o MESMO componente do guia (macOS recomendado + Google avançado recolhido)', async () => {
  await open({ eventKitStatus: async () => ({ access: 'granted' }), googleStatus: async () => ({ hasClient: false, connected: false }), eventKitRequest: vi.fn(), openInternetAccounts: vi.fn() });
  const secs = sections();
  const cal = secs[3];
  expect(cal.querySelector('h2').textContent).toBe('Agenda');
  await vi.waitFor(() => expect(cal.querySelector('.ai-card[data-option=macos]')).not.toBeNull());
  expect(cal.querySelector('.ai-card[data-option=macos]').classList.contains('open')).toBe(true);
  expect(cal.querySelector('.ai-card[data-option=google]').classList.contains('open')).toBe(false);
  expect(cal.querySelector('.ai-status').textContent).toBe('Acesso ao Calendário permitido');
  expect(cal.textContent.match(/nada da reunião é enviado ao Google/g)).toHaveLength(1);
});

const tick = () => new Promise((r) => setTimeout(r, 40));
const visibleSections = (root: any = g.document) => [...root.querySelectorAll('.settings-page .setting-section')].filter((s: any) => !s.hidden).map((s: any) => s.querySelector('h2').textContent);
const navButtons = () => [...g.document.querySelectorAll('.set-nav .set-nav-item')] as any[];
const navItem = (name: string) => navButtons().find((b) => b.textContent === name) as any;

it('navegação por seções: grupos Geral, IA, Reuniões e Privacidade; cada item com ícone de linha; só a seção escolhida aparece', async () => {
  g.localStorage.clear();
  await open();
  const nav = g.document.querySelector('.set-nav');
  expect([...nav.querySelectorAll('.set-nav-group')].map((n: any) => n.textContent)).toEqual(['Geral', 'IA', 'Reuniões']);
  expect(navButtons().map((b) => b.textContent)).toEqual(['Idioma', 'Áudio', 'Pasta das reuniões', 'Atualizações', 'Atalhos', 'Inteligência artificial', 'Ferramentas e MCPs', 'Agenda', 'Vocabulário', 'Participantes', 'Capturas de tela', 'Memória', 'Pendências', 'Privacidade']);
  expect(navButtons().every((b) => b.querySelector('svg.icon'))).toBe(true);
  expect(visibleSections()).toEqual(['Idioma']); // a primeira seção, sem lembrança
  expect(navItem('Idioma').getAttribute('aria-current')).toBe('true');
});

it('clicar num item mostra só essa seção (título 20px 600) e lembra a escolha', async () => {
  g.localStorage.clear();
  await open();
  navItem('Inteligência artificial').click();
  expect(visibleSections()).toEqual(['Inteligência artificial']);
  expect(navItem('Inteligência artificial').getAttribute('aria-current')).toBe('true');
  expect(navItem('Idioma').getAttribute('aria-current')).toBe('false');
  expect(g.localStorage.getItem('rice.settingsSection')).toBe('ai');
  const css2 = css.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css2).toMatch(/\.set-content > \.setting-section > h2 \{[^}]*font-size:20px[^}]*font-weight:600/);
});

it('reabrir Configurações volta à última seção lembrada; localStorage quebrado não derruba a tela', async () => {
  g.localStorage.clear();
  await open();
  navItem('Privacidade').click();
  g.document.getElementById('settings-link').click();
  await tick();
  expect(visibleSections()).toEqual(['Privacidade e segurança']);
  const spy = vi.spyOn(g.localStorage, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
  const box = g.document.createElement('div');
  box.className = 'page settings-page';
  g.document.body.append(box);
  try {
    await g.window.RiceSettings.render(box, { confirm: vi.fn(), onChatToolsChange: vi.fn() });
    await tick();
    expect(visibleSections(box)).toEqual(['Idioma']); // sem armazenamento, volta ao padrão sem erro
  } finally {
    spy.mockRestore();
    box.remove();
  }
});

it('seção escolhida pelo chamador (IA ao configurar um provedor; Agenda ao conectar) abre direto nela', async () => {
  g.localStorage.clear();
  await open();
  const settings = g.window.RiceSettings;
  const box = g.document.createElement('div');
  box.className = 'page settings-page';
  g.document.body.append(box);
  await settings.render(box, { section: 'ai', confirm: vi.fn(), onChatToolsChange: vi.fn() });
  await tick();
  expect(visibleSections(box)).toEqual(['Inteligência artificial']);
  await settings.render(box, { focus: 'calendar', confirm: vi.fn(), onChatToolsChange: vi.fn() });
  await tick();
  expect(visibleSections(box)).toEqual(['Agenda']);
  box.remove();
});

it('menu de seções para telas estreitas: as seções viram abas sublinhadas roláveis (sem seletor); grupos e ícones somem abaixo de 620px', async () => {
  g.localStorage.clear();
  await open();
  expect(g.document.querySelector('.set-picker')).toBeNull();
  const block = css.split('@container detail (max-width: 640px) {').slice(1).map((b) => b.split('\n  }\n')[0]).join('\n') // blocos de mesma largura (breakpoints fundidos) valem juntos;
  expect(block).toMatch(/\.set-nav \{ width:100%; flex-direction:row;[^}]*overflow-x:auto;[^}]*border-bottom:1px solid var\(--line\)/);
  expect(block).toMatch(/\.set-nav-group \{ display:none; \}/);
  expect(block).toMatch(/\.set-nav-item\[aria-current="true"\]::after \{[^}]*height:2px/);
  expect(block).toMatch(/\.set-layout \{ flex-direction:column/);
});

it('responsivo: menu de 210px com itens de 32px e 13px; conteúdo em container próprio; linhas empilham abaixo de 560px do conteúdo', () => {
  const css2 = css.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css2).toMatch(/\.set-nav \{ width:210px;/);
  expect(css2).toMatch(/\.set-nav-item \{[^}]*min-height:32px[^}]*font-size:13px[^}]*overflow-wrap:anywhere/);
  expect(css2).not.toMatch(/\.set-nav-item \{[^}]*ellipsis/); // nada cortado com reticências
  expect(css2).toMatch(/\.set-content \{[^}]*container-name:setcontent/);
  const block = css2.split('@container setcontent (max-width: 560px) {')[1]?.split('\n  }\n')[0] ?? '';
  expect(block).toMatch(/\.set-row:not\(\.inline\) \{ flex-direction:column/);
  expect(block).toMatch(/\.folder-actions \.btn \{ flex:1; \}/);
});

it('responsivo (<620px): o conteúdo ocupa a largura toda (stretch + width:100%); sem isso o container-type o encolhia a ~0 e o texto ficava vertical', () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/@container detail \(max-width: 640px\) \{ \.set-layout \{ flex-direction:column; align-items:stretch; gap:0; \} \.set-content \{ flex:none; width:100%; \}/);
});

it('limite de ciclos: menu padrão com o valor atual; o aviso de "Sem limite" só aparece com 0', async () => {
  await open({ getSettings: async () => ({ root: '/Users/x/Rice', rootDisplay: '~/Rice', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, warroomMaxCycles: 0 }) });
  const row = [...g.document.querySelectorAll('.settings-page .set-row')].find((r: any) => r.querySelector('.set-label').textContent === 'Limite de ciclos por reunião') as any;
  expect(row).toBeTruthy();
  expect(row.querySelector('.set-help').textContent).toContain('Ideias e investigação contam separado.');
  expect(row.querySelector('.menu-select-btn').textContent).toBe('Sem limite');
  const warn = [...g.document.querySelectorAll('.settings-page p.set-help')].find((p: any) => p.textContent.startsWith('Sem limite, uma reunião longa')) as any;
  expect(warn.hidden).toBe(false);
});

it('chave OFFLINE_TRANSLATION ligada: a seção "Tradução ao vivo" (modelo offline e créditos) aparece; desligada, não', async () => {
  await open();
  expect(g.document.querySelector('#set-translate')).toBeNull();
  expect(navButtons().map((b) => b.textContent)).not.toContain('Tradução ao vivo');
  expect(g.document.body.textContent).not.toContain('CC-BY');
  await open({ translateOfflineStatus: async () => ({ state: 'not-installed', packs: [], ramBytes: 0, enabled: true, localMode: false }) }, 'pt-BR', 15);
  expect(g.document.querySelector('#set-translate')).not.toBeNull();
  expect(navButtons().map((b) => b.textContent)).toContain('Tradução ao vivo');
});
