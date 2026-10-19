// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Crise', startedAt: new Date().toISOString(), state: 'recording' }];
const tick = () => new Promise((r) => setTimeout(r, 40));
const ok = { available: true };

function state(over: Record<string, unknown> = {}) {
  return {
    dir: '/R/a',
    cfg: { kind: 'warroom', ideas: { on: true, intervalMin: 5 }, investigation: { intervalMin: 5, paused: false }, sources: { web: false, mcp: false, folder: null }, cycles: 2, facts: [{ id: 'f1', at: '', text: 'Dólar a 5', source: { type: 'url', ref: 'https://x' } }] },
    ideas: [{ id: 'i1', at: new Date().toISOString(), kind: 'idea', text: 'Falar com o cliente' }],
    state: { running: false, cycles: 2, maxCycles: 120, error: '', investigation: { nextAt: null, error: '', note: '' }, tools: [{ at: '', server: 'web', tool: 'WebSearch', detail: 'dólar' }] },
    recording: true,
    support: { web: ok, mcp: ok, folder: ok },
    cycles: { ideas: 0, investigation: 2 },
    limit: 120,
    moreStep: 30,
    ...over,
  };
}

async function setup(data: any, extra: Record<string, unknown> = {}) {
  const warRoomSet = vi.fn(async () => ({ ok: true }));
  const warRoomFact = vi.fn(async () => ({ ok: true }));
  const warRoomIdea = vi.fn(async () => ({ ok: true, annotations: 'minhas notas\n\n## Ideias da reunião\n\n- Falar com o cliente\n' }));
  const { handlers } = bootRenderer({ warRoomGet: async () => data, warRoomSet, warRoomFact, warRoomIdea, ...extra }, meetings);
  await tick();
  g.document.querySelector('.meeting').click();
  await tick();
  return { warRoomSet, warRoomFact, warRoomIdea, handlers };
}
const tabs = () => [...g.document.querySelectorAll('.mt-tab')].map((b: any) => b.textContent);
const tab = (name: string) => [...g.document.querySelectorAll('.mt-tab')].find((b: any) => b.textContent.startsWith(name)) as any;
const body = () => g.document.querySelector('.mt-body') as any;

it('war room: abas, indicador no topo e achados que entram direto (Fixar/Descartar, sem validação)', async () => {
  const { warRoomFact } = await setup(state({ cfg: { ...state().cfg, sources: { web: true, mcp: false, folder: '/proj/x' } } }));
  expect(tabs()).toEqual(['Notas', 'Transcrição', 'Ideias', 'Investigação · 1']); // contador de achados NOVOS desde a última vez que a aba foi vista
  expect(g.document.getElementById('wr-indicator').textContent).toBe('War room · Internet · Pasta de trabalho');
  tab('Investigação').click();
  const panel = body();
  expect(panel.textContent).toContain('2/120 ciclos');
  expect(panel.textContent).toContain('Dólar a 5');
  expect(panel.textContent).toContain('Pesquisou "dólar"'); // toda ferramenta usada aparece (linha legível por tipo)
  expect([...panel.querySelectorAll('h3.wr-section')].map((h: any) => h.textContent)).toEqual(['Achados']); // sem "Para validar"
  expect(panel.textContent).not.toContain('Confirmar');
  (panel.querySelector('.wr-pin') as any).click();
  expect(warRoomFact).toHaveBeenCalledWith('/R/a', 'f1', 'pin');
  ([...panel.querySelectorAll('.wr-drop')][0] as any).click();
  await tick();
  expect(warRoomFact).toHaveBeenCalledWith('/R/a', 'f1', 'dismiss');
  expect(tabs()).toEqual(['Notas', 'Transcrição', 'Ideias', 'Investigação']); // a aba foi vista: contador zerado
});

it('reunião comum: sem aba de investigação nem indicador; ideias: fixar devolve as anotações', async () => {
  const { warRoomIdea } = await setup(state({ cfg: { ...state().cfg, kind: 'meeting' } }));
  expect(tabs()).toEqual(['Notas', 'Transcrição', 'Ideias', 'Investigação']); // a aba existe sempre
  expect(g.document.getElementById('wr-indicator').hidden).toBe(true);
  tab('Ideias').click();
  const panel = body();
  expect(panel.textContent).toContain('Falar com o cliente');
  [...panel.querySelectorAll('button')].find((b: any) => b.textContent === 'Fixar nas anotações').click();
  await tick();
  expect(warRoomIdea).toHaveBeenCalledWith('/R/a', 'i1', 'pin', expect.any(String));
  tab('Notas').click();
  expect(g.document.querySelector('.anot-read h2').textContent).toBe('Ideias da reunião'); // lido em Markdown, sem o '##' cru
  expect(g.document.querySelector('.anot-read').textContent).toContain('Falar com o cliente');
});

it('provedor sem suporte: linhas com a descrição normal (sem cortar), controles desabilitados e UMA nota com o motivo', async () => {
  const off = { available: false, reason: 'Provedores de API não usam ferramentas.' };
  const note = 'As fontes da investigação funcionam com o Claude por assinatura (internet, MCPs e pasta) e com o ChatGPT (internet e MCPs). Sua IA ativa é OpenCode.';
  await setup(state({ support: { web: off, mcp: off, folder: off }, provider: 'opencode-sub', note }));
  tab('Investigação').click();
  const panel = body();
  const helps = [...panel.querySelectorAll('.wr-panel .wr-box-help')].map((n: any) => n.textContent);
  expect(helps).toEqual(['Busca e lê páginas da internet.', 'Usa os MCPs do seu Claude Code ou Codex.', 'Lê arquivos de uma pasta, sem alterar nada.']);
  expect(helps.some((h: string) => h.includes('…'))).toBe(false); // nenhuma frase cortada
  expect(panel.querySelectorAll('.wr-src-note')).toHaveLength(1); // o motivo aparece uma vez só
  expect(panel.querySelector('.wr-src-note').textContent).toContain(note);
  expect(panel.querySelector('.wr-src-note svg.icon-info')).not.toBeNull();
  expect(panel.querySelector('.wr-box-row.off')).not.toBeNull();
  expect([...panel.querySelectorAll('.wr-box-row input.switch')].every((i: any) => i.disabled)).toBe(true); // as fontes; o switch "Investigação ativa" (rodapé) segue livre
  expect([...panel.querySelectorAll('.wr-box-row')].every((r: any) => !r.textContent.includes(off.reason))).toBe(true);
});

it('provedor com só uma fonte indisponível: a nota diz qual', async () => {
  const folderOff = { available: false, reason: 'Só o Claude garante a leitura limitada à pasta.' };
  const note = 'Com ChatGPT, Pasta de trabalho fica indisponível: Só o Claude garante a leitura limitada à pasta.';
  await setup(state({ support: { web: ok, mcp: ok, folder: folderOff }, provider: 'chatgpt-sub', note }));
  tab('Investigação').click();
  expect(body().querySelector('.wr-src-note').textContent).toContain('Pasta de trabalho fica indisponível');
  expect(body().querySelector('.wr-box-row.off .wr-box-name').textContent).toBe('Pasta de trabalho');
});

it('polimento: abas sublinhadas; linhas de 36px; intervalo só com as ideias ligadas; estado vazio com ícone; botões ghost', async () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.mt-tabs \{[^}]*border-bottom:1px solid var\(--line\)/); // abas sublinhadas, sem pílula
  expect(css).toMatch(/\.mt-tab\[aria-selected="true"\]::after \{[^}]*height:2px/);
  expect(css).toMatch(/\.wr-box-row \{[^}]*min-height:48px/);
  expect(css).toMatch(/\.wr-box \{ border-radius:10px; background:var\(--hover\)/);
  expect(css).toMatch(/\.wr-foot \{[^}]*background:var\(--hover\); margin-top/); // barra: contêiner --hover, sem hairline
  expect(css).toMatch(/\.wr-card \{ padding:12px; border-radius:10px; background:var\(--hover\)/);
  expect(css).toMatch(/\.wr-empty\.inline \{ flex-direction:row; align-items:center/); // ícone e texto na mesma linha, à esquerda
  expect(css).toMatch(/\.wr-empty \.icon \{ width:20px; height:20px; \}/);

  const off = await setup(state({ cfg: { ...state().cfg, kind: 'meeting', ideas: { on: false, intervalMin: 5 } }, ideas: [] }));
  tab('Ideias').click();
  let panel = body();
  expect(panel.querySelector('.wr-foot .wr-toggle').title).toBe('Ideias ao vivo');
  expect(panel.querySelector('.wr-foot .menu-select-btn')).toBeNull(); // sem o intervalo
  expect(panel.querySelector('.wr-empty svg.icon-lightbulb')).not.toBeNull();
  expect(panel.querySelectorAll('.wr-empty')).toHaveLength(1);
  expect(panel.textContent).not.toContain('Os ciclos rodam'); // uma frase só
  expect(off.warRoomSet).toBeDefined();

  await setup(state({ cfg: { ...state().cfg, kind: 'meeting', ideas: { on: true, intervalMin: 10 } } }));
  tab('Ideias').click();
  panel = body();
  expect(panel.querySelector('.wr-foot .wr-toggle').title).toBe('Ideias ao vivo');
  expect(panel.querySelector('.wr-foot .menu-select-btn').textContent).toBe('a cada 10 min'); // no MESMO rodapé de uma linha
  expect(panel.querySelector('.wr-foot input.switch')).not.toBeNull();
  expect(panel.querySelectorAll('.wr-foot')).toHaveLength(1);

  await setup(state());
  tab('Investigação').click();
  panel = body();
  expect([...panel.querySelectorAll('.wr-card .wr-drop')].every((b: any) => b.className === 'btn ghost wr-drop')).toBe(true);
  expect(panel.querySelectorAll('.wr-panel .wr-box-row').length).toBe(3);
});


it('reunião normal: a aba Investigação mostra "Transformar em War room"; no War room o selo ao lado da data volta a reunião normal', async () => {
  const { warRoomSet } = await setup(state({ cfg: { ...state().cfg, kind: 'meeting' } }));
  expect(g.document.querySelector('.mt-kind')).toBeNull(); // o chip solto saiu
  tab('Investigação').click();
  const cta = body().querySelector('.wr-cta') as any;
  expect(cta.querySelector('.wr-cta-title svg.icon-radar')).not.toBeNull(); // ícone e título na mesma linha
  expect(cta.querySelector('.wr-cta-title').textContent).toBe('Transformar em War room');
  expect(body().querySelectorAll('.wr-desc')).toHaveLength(1); // descrição em UM parágrafo, com "Saiba mais" inline
  expect(body().querySelector('.wr-desc .link-button').textContent).toBe('Saiba mais');
  const go = [...body().querySelectorAll('button')].find((b: any) => b.textContent === 'Ativar War room') as any;
  expect(go.className).toBe('btn primary');
  go.click();
  expect(warRoomSet).toHaveBeenCalledWith('/R/a', { kind: 'warroom' });
  expect(JSON.parse(g.localStorage.getItem('rice.meetingTabs') || '{}')['/R/a'] ?? 'war').toBeTruthy();
  expect(g.document.querySelector('#chat-tabs, #live-panel')).toBeNull();
});

it('War room: selo "War room" ao lado da data volta a reunião normal; a barra de fontes é uma linha com Internet · MCPs · Pasta', async () => {
  const { warRoomSet } = await setup(state());
  const badge = g.document.querySelector('.page-meta .wr-badge') as any;
  expect(badge.textContent).toBe('War room');
  badge.click();
  expect(warRoomSet).toHaveBeenCalledWith('/R/a', { kind: 'meeting' });
  tab('Investigação').click();
  expect([...body().querySelectorAll('.wr-panel .wr-box-name')].map((n: any) => n.textContent)).toEqual(['Internet', 'MCPs', 'Pasta de trabalho']); // lista vertical de 3 linhas numa caixa; o switch de pausa fica no rodapé
  expect(body().querySelectorAll('.wr-panel .wr-box')).toHaveLength(1);
  expect([...body().querySelectorAll('.wr-panel .wr-box-help')].every((n: any) => n.textContent.length > 0)).toBe(true); // descrição curta embaixo do nome
});

it('atalhos "Nova war room": item na sidebar abaixo de Nova reunião; criam a reunião como War room e abrem em Investigação', async () => {
  const createMeeting = vi.fn(async () => '/R/a');
  const warRoomSet = vi.fn(async () => ({ ok: true }));
  bootRenderer({ createMeeting, warRoomSet, warRoomGet: async () => state() }, meetings);
  await tick();
  const side = g.document.getElementById('new-war') as any;
  expect(side.previousElementSibling.id).toBe('new');
  expect(side.textContent).toContain('Nova war room');
  expect(side.querySelector('.ico').dataset.icon).toBe('radar');
  side.click();
  await tick();
  expect(createMeeting).toHaveBeenCalledWith('', undefined, undefined, 'warroom'); // o tipo vai com a criação (ou o rascunho reaproveitado)
  expect(tab('Investigação').getAttribute('aria-selected')).toBe('true');
});

it('explicações: descrição fixa no topo de cada aba com "Saiba mais"; cada fonte com a descrição curta embaixo do nome', async () => {
  await setup(state());
  tab('Ideias').click();
  expect(body().querySelector('.wr-desc').textContent).toContain('a IA lê o trecho recente e sugere ideias, perguntas e riscos');
  tab('Investigação').click();
  expect(body().querySelector('.wr-desc').textContent).toContain('Modo de investigação');
  expect(body().querySelector('.wr-desc .link-button').textContent).toBe('Saiba mais');
  expect(body().querySelectorAll('.wr-desc')).toHaveLength(1);
  expect([...body().querySelectorAll('.wr-panel .wr-box-help')].map((n: any) => n.textContent)).toEqual(['Busca e lê páginas da internet.', 'Usa os MCPs do seu Claude Code ou Codex.', 'Lê arquivos de uma pasta, sem alterar nada.']); // substitui o ⓘ
  await setup(state({ cfg: { ...state().cfg, kind: 'meeting' } }));
  tab('Investigação').click();
  expect(body().querySelector('.wr-desc')).not.toBeNull(); // também no estado vazio de "Transformar em War room"
});

it('ideias: contagem regressiva, "Gerar agora" e erro do ciclo sempre visível com "Tentar agora"', async () => {
  const warRoomRunNow = vi.fn(async () => ({ ok: true }));
  const data = state({
    cfg: { ...state().cfg, kind: 'meeting' },
    ideas: [],
    state: { running: false, cycles: 0, maxCycles: 120, error: 'OpenCode: limite do modelo gratuito', tools: [], nextAt: Date.now() + 100_000, note: '' },
  });
  const { warRoomSet } = await setup(data);
  g.window.rice.warRoomRunNow = warRoomRunNow;
  tab('Ideias').click();
  const panel = body();
  expect(panel.textContent).toMatch(/próximas ideias em 1:\d\d/);
  expect(panel.querySelector('.wr-error').textContent).toContain('limite do modelo gratuito');
  const click = (label: string) => [...panel.querySelectorAll('button')].find((b: any) => b.textContent === label).click();
  click('Gerar agora');
  await tick();
  click('Tentar agora');
  expect(warRoomRunNow).toHaveBeenCalledTimes(2);
  expect(warRoomSet).not.toHaveBeenCalled();
});

it('"Continuar no terminal ▾": menu com os CLIs detectados + "Copiar prompt"; escolher abre o harness e avisa; copiar usa copyText; vale em War room e em reunião normal', async () => {
  const warRoomHandoff = vi.fn(async (_d: string, target: string) => (target === 'copy' ? { ok: true, prompt: 'PROMPT' } : { ok: true, label: 'Claude Code' }));
  const copyText = vi.fn(async () => true);
  const extra = { warRoomHarnesses: async () => [{ id: 'claude', label: 'Claude Code' }, { id: 'agy', label: 'Antigravity (agy)' }], warRoomHandoff, copyText };
  for (const kind of ['warroom', 'meeting']) {
    await setup(state({ cfg: { ...state().cfg, kind } }), extra);
    tab('Investigação').click();
    const button = body().querySelector('.wr-handoff') as any;
    expect(button.textContent).toBe('Abrir no terminal');
    if (kind === 'warroom') expect(button.closest('.wr-term').querySelector('.wr-box-help').textContent).toContain('já com o contexto desta reunião'); // seção própria com a explicação
    expect(body().querySelectorAll('.wr-note, .wr-handoff-note')).toHaveLength(0); // a frase não fica solta nem embaixo do botão
    expect(button.title).toContain('usa as permissões e a conta dele');
    button.click();
    await tick();
    const items = [...g.document.querySelectorAll('.action-item')] as any[];
    expect(items.map((i) => i.textContent)).toEqual(['Claude Code', 'Antigravity (agy)', 'Copiar prompt', 'O outro harness usa as permissões e a conta dele; o Rice não controla o que ele faz.']); // a nota é a linha final do MENU
    items[0].click();
    await tick();
    expect(warRoomHandoff).toHaveBeenLastCalledWith('/R/a', 'claude');
    expect(g.document.body.textContent).toContain('Aberto no Terminal com Claude Code');
    button.click();
    await tick();
    ([...g.document.querySelectorAll('.action-item')].find((i: any) => i.textContent === 'Copiar prompt') as any).click();
    await tick();
    expect(copyText).toHaveBeenLastCalledWith('PROMPT');
  }
});

it('sem nenhum CLI detectado o menu avisa e só oferece "Copiar prompt"', async () => {
  await setup(state(), { warRoomHarnesses: async () => [], warRoomHandoff: vi.fn(), copyText: vi.fn() });
  tab('Investigação').click();
  (body().querySelector('.wr-handoff') as any).click();
  await tick();
  expect([...g.document.querySelectorAll('.action-item')].map((i: any) => i.textContent)).toEqual(['Nenhum CLI encontrado', 'Copiar prompt', 'O outro harness usa as permissões e a conta dele; o Rice não controla o que ele faz.']);
});

it('"Saiba mais" é link inline dentro do MESMO parágrafo (sem margem de botão) e "Continuar no terminal" não quebra o ícone', () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.wr-desc button\.link-button \{ display:inline; padding:0; margin:0;/);
  expect(css).toMatch(/\.wr-handoff \{ display:inline-flex;[^}]*white-space:nowrap/);
});

it('Investigação: rodapé "[a cada 5 min ▾] · Ciclos 2/120 · próximo em ~m:ss" com intervalo PRÓPRIO; textos de investigação (não de ideias)', async () => {
  const warRoomRunNow = vi.fn(async () => ({ ok: true }));
  const data = state({
    cfg: { ...state().cfg, investigation: { intervalMin: 10, paused: false }, sources: { web: true, mcp: true, folder: null }, facts: [] },
    state: { running: false, cycles: 2, maxCycles: 120, error: '', tools: [], nextAt: null, note: '', investigation: { nextAt: Date.now() + 259_000, error: '', note: 'little-speech' } },
  });
  const { warRoomSet } = await setup(data, { warRoomRunNow });
  tab('Investigação').click();
  const foot = body().querySelector('.wr-foot') as any;
  expect(foot.querySelector('.wr-foot-lead .menu-select-btn').textContent).toBe('a cada 10 min'); // o da investigação, não o das ideias (5)
  expect(foot.querySelector('.wr-next').textContent).toMatch(/^· 2\/120 ciclos · próximo em 4:\d\d$/);
  expect(body().textContent).toContain('Ainda há pouca fala nova para investigar.');
  expect(body().textContent).not.toContain('para gerar ideias');
  expect(body().textContent).toContain('Os achados aparecem aqui conforme a conversa avança.'); // com fonte ligada
  expect(body().textContent).not.toContain('Ligue uma fonte acima');
  foot.querySelector('.menu-select-btn').click();
  ([...g.document.querySelectorAll('.select-opt')].find((o: any) => o.textContent.includes('15 min')) as any).click();
  expect(warRoomSet).toHaveBeenCalledWith('/R/a', { investigationMin: 15 });
  ([...foot.querySelectorAll('button')].find((b: any) => b.textContent === 'Investigar') as any).click();
  expect(warRoomRunNow).toHaveBeenCalledWith('/R/a', 'investigation');
});

it('Investigação sem nenhuma fonte ligada: o vazio pede para ligar uma fonte; "Gerar agora" nas Ideias roda só a trilha de ideias', async () => {
  const warRoomRunNow = vi.fn(async () => ({ ok: true }));
  await setup(state({ cfg: { ...state().cfg, sources: { web: false, mcp: false, folder: null }, facts: [] } }), { warRoomRunNow });
  tab('Investigação').click();
  expect(body().textContent).toContain('Ligue uma fonte acima');
  tab('Ideias').click();
  ([...body().querySelectorAll('.wr-foot button')].find((b: any) => b.textContent === 'Gerar agora') as any).click();
  expect(warRoomRunNow).toHaveBeenCalledWith('/R/a', 'ideas');
});

describe('achados: fixados no topo, fonte clicável, desfazer, Parar e pausar', () => {
  const now = new Date().toISOString();
  const facts = [
    { id: 'a', at: now, text: 'Antigo', source: { type: 'url', ref: 'https://exemplo.com/a' } },
    { id: 'b', at: now, text: 'Fixado', source: { type: 'file', ref: 'sub/a.ts:12' }, pinned: true },
    { id: 'c', at: now, text: 'Recente', source: { type: 'tool', ref: 'notion' } },
  ];
  const withFacts = (extra: Record<string, unknown> = {}) => state({ cfg: { ...state().cfg, facts }, ...extra });

  it('mais recentes primeiro, fixados no topo com marcador; fonte clicável só para URL/arquivo', async () => {
    const warRoomOpenSource = vi.fn(async () => ({ ok: true }));
    await setup(withFacts(), { warRoomOpenSource });
    tab('Investigação').click();
    const cards = [...body().querySelectorAll('.wr-finding')] as any[];
    expect(cards.map((c) => c.querySelector('p').textContent)).toEqual(['Fixado', 'Recente', 'Antigo']);
    expect(cards[0].classList.contains('pinned')).toBe(true);
    expect(cards.map((c) => c.querySelector('.wr-source').tagName)).toEqual(['BUTTON', 'SMALL', 'BUTTON']); // a ferramenta não é clicável
    cards[0].querySelector('button.wr-source').click();
    expect(warRoomOpenSource).toHaveBeenCalledWith('/R/a', 'b');
    expect(cards[0].querySelector('.wr-pin').getAttribute('aria-pressed')).toBe('true');
  });

  it('descartar mostra "Achado descartado · Desfazer" por alguns segundos', async () => {
    const warRoomFact = vi.fn(async () => ({ ok: true }));
    await setup(withFacts(), { warRoomFact });
    tab('Investigação').click();
    ([...body().querySelectorAll('.wr-drop')][1] as any).click();
    await tick();
    expect(warRoomFact).toHaveBeenCalledWith('/R/a', 'c', 'dismiss');
  });

  it('durante um ciclo "Investigar agora" vira "Parar"; "Investigação ativa" pausa sem mexer nas fontes', async () => {
    const warRoomStop = vi.fn(async () => ({ ok: true }));
    const { warRoomSet } = await setup(withFacts({ state: { running: true, cycles: 2, maxCycles: 120, error: '', tools: [], nextAt: null, note: '', investigation: { nextAt: null, error: '', note: '' } } }), { warRoomStop });
    tab('Investigação').click();
    const stop = body().querySelector('.wr-foot .wr-stop') as any;
    expect(stop.textContent).toBe('Parar');
    expect(stop.querySelector('svg.icon-square')).not.toBeNull();
    stop.click();
    expect(warRoomStop).toHaveBeenCalledWith('/R/a');
    const toggle = body().querySelector('.wr-foot .wr-toggle input.switch') as any;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new g.window.Event('change'));
    expect(warRoomSet).toHaveBeenCalledWith('/R/a', { investigationPaused: true });
  });

  it('pausada: status "Pausada" no rodapé, switch desligado e "Investigar agora" desabilitado', async () => {
    await setup(withFacts({ cfg: { ...withFacts().cfg, investigation: { intervalMin: 5, paused: true } } }));
    tab('Investigação').click();
    expect(body().querySelector('.wr-foot .wr-toggle input.switch').checked).toBe(false);
    expect(body().querySelector('.wr-foot .wr-next').textContent).toBe('· pausada');
    expect(([...body().querySelectorAll('.wr-foot button')].find((b: any) => b.textContent === 'Investigar') as any).disabled).toBe(true);
  });

  it('nas Ideias, durante um ciclo "Gerar agora" também vira "Parar"', async () => {
    const warRoomStop = vi.fn(async () => ({ ok: true }));
    await setup(state({ state: { running: true, cycles: 1, maxCycles: 120, error: '', tools: [], nextAt: null, note: '', investigation: { nextAt: null, error: '', note: '' } } }), { warRoomStop });
    tab('Ideias').click();
    (body().querySelector('.wr-foot .wr-stop') as any).click();
    expect(warRoomStop).toHaveBeenCalledWith('/R/a');
  });
});

it('ferramentas usadas: uma linha legível por tipo, recolhida por padrão, no máx. 20 com +N', async () => {
  const tools = [
    { at: '', server: 'file', tool: 'Read', detail: '/Users/x/projeto/src/main/warroom/engine.ts' },
    { at: '', server: 'file', tool: 'Grep', detail: '120|max_?cycles|maxCycles|MAX_CYCLES|ciclos|cycles' },
    { at: '', server: 'file', tool: 'Grep', detail: '\\bfoo\\b' },
    { at: '', server: 'file', tool: 'Glob', detail: 'src/**/*.ts' },
    { at: '', server: 'web', tool: 'WebSearch', detail: 'preço do dólar' },
    { at: '', server: 'web', tool: 'WebFetch', detail: 'https://www.exemplo.com.br/noticia?id=1' },
    { at: '', server: 'notion', tool: 'search', detail: '' },
    { at: '', server: 'file', tool: 'Edit', detail: 'x' },
  ];
  await setup(state({ state: { running: false, cycles: 2, maxCycles: 120, error: '', tools, investigation: { nextAt: null, error: '', note: '' } } }));
  tab('Investigação').click();
  const details = body().querySelector('details.wr-tools') as any;
  expect(details.open).toBe(false); // recolhida por padrão
  expect(details.querySelector('summary').textContent).toBe('Ferramentas usadas (8)');
  const lines = [...details.querySelectorAll('.wr-tool')].map((li: any) => li.querySelector('span').textContent);
  expect(lines).toEqual([
    'Edit', // mais recente primeiro; tipo desconhecido mostra só o nome
    'notion · search',
    'Abriu www.exemplo.com.br',
    'Pesquisou "preço do dólar"',
    'Listou src/**/*.ts',
    'Procurou "foo"',
    'Procurou "120"',
    'Leu engine.ts',
  ]);
  const read = [...details.querySelectorAll('.wr-tool')].find((li: any) => li.textContent.includes('engine.ts')) as any;
  expect(read.title).toBe('/Users/x/projeto/src/main/warroom/engine.ts'); // caminho completo no tooltip
  expect(read.querySelector('svg.icon-file-text')).not.toBeNull();
  expect([...details.querySelectorAll('.wr-tool svg')].every((s: any) => s.classList.contains('icon'))).toBe(true);
});

it('ferramentas usadas: 20 linhas no máximo, com +N para o resto; Grep longo corta em 30 caracteres', async () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ at: '', server: 'file', tool: 'Grep', detail: i === 22 ? 'abcdefghijklmnopqrstuvwxyzABCDEFGH|x' : `termo${i}` })); // o mais recente é o longo
  await setup(state({ state: { running: false, cycles: 1, maxCycles: 120, error: '', tools: many, investigation: { nextAt: null, error: '', note: '' } } }));
  tab('Investigação').click();
  const details = body().querySelector('details.wr-tools') as any;
  expect(details.querySelector('summary').textContent).toBe('Ferramentas usadas (23)');
  const items = [...details.querySelectorAll('.wr-tool')];
  expect(items).toHaveLength(21);
  expect(items[20].textContent).toBe('+3');
  expect(items[0].querySelector('span').textContent).toBe('Procurou "abcdefghijklmnopqrstuvwxyzABCD…"');
});

describe('rodapé de controles (mesmo nas Ideias e na Investigação)', () => {
  it('barra de ferramentas: [switch + Ativa] [intervalo] [Tipo, nas Ideias] [status] à esquerda; botões à direita; tooltip na frase do harness', async () => {
    await setup(state());
    tab('Investigação').click();
    const foot = body().querySelector('.wr-foot') as any;
    expect([...foot.children].map((c: any) => c.className)).toEqual(['wr-foot-lead', 'wr-foot-actions']);
    expect([...foot.querySelector('.wr-foot-lead').children].map((c: any) => c.className.split(' ')[0])).toEqual(['wr-toggle', 'menu-select-root', 'wr-next']);
    expect(foot.querySelector('.wr-toggle').textContent).toBe('Ativa');
    expect(foot.querySelector('.wr-toggle').title).toBe('Investigação ativa');
    expect([...foot.querySelectorAll('.wr-foot-actions button')].map((b: any) => b.textContent)).toEqual(['Investigar']); // o terminal tem seção própria
    expect(foot.querySelector('.wr-run svg.icon-search')).not.toBeNull();
    expect(body().querySelector('.wr-term .wr-box-name').textContent).toBe('Continuar no seu terminal');
    expect(body().querySelector('.wr-term .wr-box-help').textContent).toContain('usa a conta e as permissões dele'); // o aviso do outro harness fica visível
    tab('Ideias').click();
    const ideas = body().querySelector('.wr-foot') as any;
    expect([...ideas.querySelector('.wr-foot-lead').children].map((c: any) => c.className.split(' ')[0])).toEqual(['wr-toggle', 'menu-select-root', 'tpl-picker-root', 'wr-next']); // "Tipo" junto do intervalo
    expect([...ideas.querySelectorAll('.wr-foot-actions button')].map((b: any) => b.textContent)).toEqual(['Gerar agora']);
  });

  it('"A investigação roda enquanto a reunião é gravada" só aparece quando NÃO está gravando (no lugar do status)', async () => {
    await setup(state({ recording: false }));
    tab('Investigação').click();
    expect(body().querySelector('.wr-foot .wr-next').textContent).toBe('· aguardando gravação');
    expect(body().querySelector('.wr-foot .wr-next').title).toBe('A investigação roda enquanto a reunião é gravada'); // a frase longa vira o tooltip
    const run = [...body().querySelectorAll('.wr-foot button')].find((b: any) => b.textContent === 'Investigar') as any;
    expect(run.disabled).toBe(true);
    expect(run.title).toBe('Comece a gravar para usar'); // motivo do desabilitado
    await setup(state({ recording: true }));
    tab('Investigação').click();
    expect(body().querySelector('.wr-foot .wr-next').textContent).not.toContain('aguardando');
    expect(body().querySelector('.wr-foot .wr-next').title).toBe('');
  });

  it('CSS: contêiner --hover (padding 8px 12px, raio 10px), TODOS os controles de 32px com borda 1px --line e raio 8px, switch compacto 28×16, desabilitado a .5; abaixo de 640px os botões só descem se não couberem', () => {
    const css = rendered('src/renderer/index.html');
    expect(css).toMatch(/\.wr-foot \{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background:var\(--hover\);/);
    expect(css).toMatch(/\.wr-foot \.btn, \.wr-foot \.menu-select-btn, \.wr-foot \.tpl-chip \{ height:32px; box-sizing:border-box;[^}]*border-radius:8px; background:transparent; box-shadow:inset 0 0 0 1px var\(--line\)/);
    expect(css).toMatch(/\.wr-foot \.btn:disabled \{ opacity:\.45; cursor:not-allowed; \}/);
    expect(css).toMatch(/\.wr-foot input\.switch \{ width:28px; height:16px; \}/);
    expect(css).toMatch(/\.wr-toggle \{[^}]*height:32px/);
    expect(css).toMatch(/@container detail \(max-width: 640px\) \{ \.wr-foot \.wr-foot-actions \{ flex-wrap:wrap; justify-content:flex-end; \} \}/); // os botões só descem quando não cabem
    expect(css).toMatch(/\.tpl-opt-desc \{[^}]*-webkit-line-clamp:2/); // descrições da lista em 2 linhas, sem cortar com …
  });
});


it('bloco "Transformar em War room": ações numa linha à ESQUERDA abaixo do texto (primário + ghost, 32px); sem nota solta; "Saiba mais" inline', async () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.wr-cta \{ display:flex; flex-direction:column; align-items:flex-start;/);
  expect(css).toMatch(/\.wr-cta-actions \{ justify-content:flex-start; \}/);
  expect(css).toMatch(/\.wr-cta \[class~=btn\] \{ height:32px;/);
  expect(css).toMatch(/\.wr-desc \{ text-wrap:pretty;/);
  expect(css).not.toMatch(/\.wr-desc[^}]*\.link-button[^}]*display:block/);
  await setup(state({ cfg: { ...state().cfg, kind: 'meeting' } }), { warRoomHarnesses: async () => [], warRoomHandoff: vi.fn(), copyText: vi.fn() });
  tab('Investigação').click();
  const cta = body().querySelector('.wr-cta') as any;
  expect([...cta.children].map((c: any) => c.className)).toEqual(['wr-cta-text', 'wr-cta-actions']); // texto e, abaixo, as ações
  expect([...cta.querySelectorAll('.wr-cta-actions button')].map((b: any) => [b.textContent, b.className.split(' ').slice(0, 2).join(' ')])).toEqual([['Ativar War room', 'btn primary'], ['Abrir no terminal', 'btn ghost']]);
  expect(body().querySelectorAll('.wr-note, .wr-handoff-note')).toHaveLength(0);
  expect(cta.querySelector('.wr-handoff').title).toContain('usa as permissões e a conta dele');
  const desc = body().querySelector('.wr-desc') as any;
  expect(desc.querySelector('.link-button').previousSibling.textContent.endsWith('\u00a0')).toBe(true); // ligado à última palavra
});

it('rodapé numa linha: o status não quebra sob o switch (o grupo da direita desce inteiro); "Parar" com quadrado vermelho de 10px e borda vermelha sutil (Investigação, Ideias e chat)', () => {
  const css = rendered('src/renderer/index.html');
    expect(css).toMatch(/\.wr-foot \.wr-stop \{[^}]*box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--rec\) 55%, transparent\)/);
  expect(css).toMatch(/\.wr-stop \.icon \{ width:10px; height:10px; color:var\(--rec\); fill:var\(--rec\);/);
  expect(css).toMatch(/\.send-btn\[data-stop="1"\] \.icon \{ width:10px; height:10px; color:var\(--rec\);/); // o stop do chat
});

describe('templates de ideias na aba Ideias', () => {
  const ideaTemplates = [
    { id: 'general', title: 'Geral', description: 'Ideias, perguntas e riscos sobre o que foi dito.', icon: 'lightbulb', instruction: 'x', categories: [], builtin: true },
    { id: 'sales', title: 'Vendas', description: 'Objeções do cliente, sinais de compra e o próximo passo.', icon: 'briefcase', instruction: 'y', categories: ['Objeção'], builtin: true },
  ];
  it('seletor "Tipo: Geral ▾" é o MESMO componente dos templates de notas: lista com ícone/nome/descrição, ✓ no atual, prévia ao lado (nome, descrição, instrução, categorias) e "Gerenciar templates…"', async () => {
    const { warRoomSet } = await setup(state({ ideaTemplates, ideaTemplateId: 'general' }));
    tab('Ideias').click();
    const chip = body().querySelector('.wr-foot .tpl-chip') as any;
    expect(chip.textContent).toBe('Tipo: Geral');
    chip.click();
    const options = [...g.document.querySelectorAll('[role=option]')] as any[];
    expect(options.map((o) => o.querySelector('.tpl-opt-title').textContent)).toEqual(['Geral', 'Vendas']);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].querySelector('.tpl-opt-desc').textContent).toBe('Objeções do cliente, sinais de compra e o próximo passo.'); // inteira, sem …
    options[1].dispatchEvent(new g.window.MouseEvent('mouseover', { bubbles: true }));
    const preview = g.document.querySelector('.tpl-popover-preview') as any;
    expect(preview.querySelector('.tpl-preview-title').textContent).toBe('Vendas');
    expect(preview.textContent).toContain('Objeções do cliente, sinais de compra e o próximo passo.');
    expect(preview.textContent).toContain('y'); // a instrução
    expect([...preview.querySelectorAll('.tpl-sec-chip')].map((c: any) => c.textContent)).toEqual(['Objeção']);
    expect(g.document.querySelector('.tpl-manage').textContent).toContain('Gerenciar');
    options[1].click();
    expect(warRoomSet).toHaveBeenCalledWith('/R/a', { ideaTemplate: 'sales' });
  });
  it('ideia guarda o template que a gerou: selo discreto só quando é diferente do atual; categoria no lugar do tipo', async () => {
    await setup(state({
      ideaTemplates, ideaTemplateId: 'sales',
      ideas: [
        { id: 'i1', at: new Date().toISOString(), kind: 'idea', text: 'Da Geral', templateId: 'general', templateTitle: 'Geral' },
        { id: 'i2', at: new Date().toISOString(), kind: 'idea', text: 'De Vendas', category: 'Objeção', templateId: 'sales', templateTitle: 'Vendas' },
      ],
    }));
    tab('Ideias').click();
    const cards = [...body().querySelectorAll('.wr-card')] as any[];
    const byText = (t2: string) => cards.find((c) => c.textContent.includes(t2));
    expect(byText('Da Geral').querySelector('.wr-idea-tag').textContent).toBe('Geral');
    expect(byText('De Vendas').querySelector('.wr-idea-tag')).toBeNull();
    expect(byText('De Vendas').querySelector('.wr-time').textContent).toContain('Objeção');
  });
});

it('limite de ciclos atingido: aviso e "Continuar mais 30" (libera só esta reunião); sem limite mostra só a contagem', async () => {
  const warRoomSet = vi.fn(async () => ({ ok: true }));
  await setup(state({ cycles: { ideas: 0, investigation: 120 }, limit: 120, warRoomSet }), { warRoomSet });
  tab('Investigação').click();
  expect(body().querySelector('.wr-limit').textContent).toContain('Limite de ciclos atingido');
  const more = [...body().querySelectorAll('.wr-limit button')][0] as any;
  expect(more.textContent).toBe('Continuar mais 30');
  more.click();
  expect(warRoomSet).toHaveBeenCalledWith('/R/a', { moreCycles: true });
  const nowBtn = [...body().querySelectorAll('.wr-foot button')].find((b: any) => b.textContent === 'Investigar') as any;
  expect(nowBtn.disabled).toBe(true); // não gasta mais enquanto o limite estiver atingido
});

it('sem limite: a contagem aparece sem "/máximo" e sem aviso', async () => {
  await setup(state({ cycles: { ideas: 0, investigation: 6 }, limit: 0 }));
  tab('Investigação').click();
  expect(body().textContent).toContain('6 ciclos');
  expect(body().textContent).not.toContain('6/');
  expect(body().querySelector('.wr-limit')).toBeNull();
});

it('seletor de tipo no rodapé: lista compacta (200px) e prévia abaixo limitada, para caber na janela', () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.tpl-popover\.compact-list \.tpl-list \{ max-height:200px; \}/);
  expect(readFileSync('src/renderer/template-picker.js', 'utf8')).toContain("options.kind === 'ideas' ? ' compact-list'");
});

it('filtro Todos/Fixados nas Ideias e na Investigação: conta, filtra e mostra o vazio de fixados', async () => {
  const facts = [{ id: 'f1', at: '', text: 'Dólar a 5', source: { type: 'url', ref: 'https://x' } }, { id: 'f2', at: '', text: 'Selic 10', pinned: true, source: { type: 'url', ref: 'https://y' } }];
  const ideas = [{ id: 'i1', at: new Date().toISOString(), kind: 'idea', text: 'Falar com o cliente' }, { id: 'i2', at: new Date().toISOString(), kind: 'idea', text: 'Mandar proposta', pinned: true }];
  await setup(state({ cfg: { ...state().cfg, facts }, ideas }));
  tab('Ideias').click();
  const chips = () => [...body().querySelectorAll('.wr-filter-btn')] as any[];
  expect(chips().map((b) => b.textContent)).toEqual(['Todos 2', 'Fixados 1']);
  chips()[1].click();
  await new Promise((r) => setTimeout(r, 0));
  expect([...body().querySelectorAll('.wr-card p')].map((p: any) => p.textContent)).toEqual(['Mandar proposta']);
  tab('Investigação').click();
  expect(chips().map((b) => b.textContent)).toEqual(['Todos 2', 'Fixados 1']);
  chips()[1].click();
  await new Promise((r) => setTimeout(r, 0));
  expect([...body().querySelectorAll('.wr-finding p')].map((p: any) => p.textContent)).toEqual(['Selic 10']);
});


describe('Gerar agora: feedback imediato', () => {
  const idle = (): any => state({ cfg: { ...state().cfg, kind: 'meeting' }, ideas: [], state: { running: false, phase: '', startedAt: 0, cycles: 0, maxCycles: 120, error: '', tools: [], nextAt: null, note: '', investigation: { nextAt: null, error: '', note: '' } } });

  it('o botão muda no clique, ANTES de a promessa resolver, fica desabilitado e volta no fim', async () => {
    let finish: (v: unknown) => void = () => {};
    const warRoomRunNow = vi.fn(() => new Promise((r) => (finish = r)));
    await setup(idle(), { warRoomRunNow });
    tab('Ideias').click();
    const run = () => body().querySelector('.wr-foot .wr-run') as any;
    run().click(); // nada resolveu ainda
    const busy = run();
    expect(busy.textContent).toBe('Gerando ideias…');
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.querySelector('.wr-line')).not.toBeNull();
    expect(body().querySelector('.wr-foot .wr-next').textContent).toContain('Preparando…');
    busy.click(); // clique duplo não dispara outro ciclo
    expect(warRoomRunNow).toHaveBeenCalledTimes(1);
    finish({ ok: true, result: 'ran' });
    await tick();
    expect(run().textContent).toBe('Gerar agora');
    expect(run().disabled).toBe(false);
  });

  it('segue a etapa real do main (pensando → escrevendo) e, depois de ~20 s, mostra "Ainda pensando…" com Parar', async () => {
    const d: any = idle();
    d.state = { ...d.state, running: true, phase: 'thinking', startedAt: Date.now() - 1000 };
    await setup(d);
    tab('Ideias').click();
    expect(body().querySelector('.wr-foot .wr-next').textContent).toContain('Pensando…');
    expect((body().querySelector('.wr-foot .wr-busy') as any).disabled).toBe(true);
    expect(body().querySelector('.wr-foot .wr-stop')).not.toBeNull(); // Parar vale desde a preparação
    d.state = { ...d.state, startedAt: Date.now() - 25_000 };
    tab('Notas').click();
    tab('Ideias').click();
    expect(body().querySelector('.wr-foot .wr-next').textContent).toContain('Ainda pensando…');
    expect(body().querySelector('.wr-foot .wr-stop').textContent).toBe('Parar');
  });

  it('erro: o botão volta e o aviso aparece', async () => {
    const warRoomRunNow = vi.fn(async () => ({ ok: false, message: 'Só durante a gravação' }));
    await setup(idle(), { warRoomRunNow });
    tab('Ideias').click();
    (body().querySelector('.wr-foot .wr-run') as any).click();
    await tick();
    expect((body().querySelector('.wr-foot .wr-run') as any).disabled).toBe(false);
  });

  it('Investigação: muda no clique, mostra Preparando…, aceita Parar na preparação e ignora clique duplo', async () => {
    let finish: (v: unknown) => void = () => {};
    const warRoomRunNow = vi.fn(() => new Promise((r) => (finish = r)));
    const warRoomStop = vi.fn(async () => ({ ok: true }));
    const d: any = state();
    d.state = { ...d.state, running: false, phase: '', track: '', startedAt: 0 };
    await setup(d, { warRoomRunNow, warRoomStop });
    tab('Investigação').click();
    const run = () => body().querySelector('.wr-foot .wr-run') as any;
    run().click();
    const busy = body().querySelector('.wr-foot .wr-busy') as any;
    expect(busy.textContent).toBe('Investigando…');
    expect(busy.disabled).toBe(true);
    expect(body().querySelector('.wr-foot .wr-next').textContent).toContain('Preparando…');
    busy.click();
    expect(warRoomRunNow).toHaveBeenCalledTimes(1);
    expect(warRoomRunNow).toHaveBeenCalledWith('/R/a', 'investigation');
    (body().querySelector('.wr-foot .wr-stop') as any).click(); // Parar já na preparação
    expect(warRoomStop).toHaveBeenCalledWith('/R/a');
    finish({ ok: true, result: 'skipped' });
    await tick();
    expect(run().disabled).toBe(false);
  });

  it('ciclo da OUTRA trilha em andamento: o botão espera a vez (sem Parar, sem clique)', async () => {
    const warRoomRunNow = vi.fn(async () => ({ ok: true }));
    const d: any = state();
    d.state = { ...d.state, running: true, phase: 'thinking', track: 'ideas', startedAt: Date.now() - 500 };
    await setup(d, { warRoomRunNow });
    tab('Investigação').click();
    const busy = body().querySelector('.wr-foot .wr-busy') as any;
    expect(busy.textContent).toBe('Aguardando o outro ciclo…');
    expect(body().querySelector('.wr-foot .wr-stop')).toBeNull();
    expect(body().querySelector('.wr-foot .wr-next').textContent).toContain('Aguardando o outro ciclo…');
    busy.click();
    expect(warRoomRunNow).not.toHaveBeenCalled();
  });
});
