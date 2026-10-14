// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const g = globalThis as any;

beforeAll(() => {
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'ai-providers', 'chat-tools', 'calendar-connect', 'menu-select', 'language-settings', 'onboarding']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const provider = (over: Record<string, unknown> = {}) => ({ connected: false, detail: 'Nenhuma chave salva.', hasKey: false, ...over });
/** Resposta de `ai:status`; nunca traz o valor de uma chave. */
function aiStatus(active = 'claude-sub', over: Record<string, any> = {}) {
  return {
    active,
    models: {},
    providers: {
      'claude-sub': provider({ detail: 'Sem token, o Rice usa o login do Claude Code.' }),
      'claude-api': provider(),
      'chatgpt-sub': provider({ installed: true, detail: 'Codex CLI encontrado. Clique em “Testar conexão”.' }),
      'openai-api': provider(),
      'gemini-api': provider(),
      'opencode-sub': provider({ installed: true, detail: 'OpenCode encontrado, mas sem login. Faça login no Terminal.' }),
      ...over,
    },
  };
}

function fakeRice(over: Record<string, unknown> = {}) {
  return {
    getSettings: async () => ({ root: '/Users/x/Rice' }),
    aiStatus: async () => aiStatus(),
    asrStatus: async () => ({ state: 'loading', downloadPercent: 42 }),
    permissionStatus: async () => ({ microphone: 'granted' }),
    saveAiKey: vi.fn(async () => ({ ok: false, message: 'O token deve começar com “sk-ant-oat”.' })),
    testAi: vi.fn(async () => ({ ok: true, message: 'Conexão funcionando.' })),
    clearAiKey: vi.fn(async () => ({ ok: true })),
    setAiProvider: vi.fn(async () => ({ ok: true })),
    setAiModel: vi.fn(async () => ({ ok: true })),
    listAiModels: vi.fn(async () => ({ ok: true, models: ['claude-sonnet-5-5', 'claude-opus-5-5'] })),
    chooseRoot: vi.fn(),
    openPrivacy: vi.fn(),
    setOnboardingDone: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}

it('mostra o status ao vivo de cada etapa', async () => {
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const steps = [...box.querySelectorAll('.step')];
  expect(steps).toHaveLength(11);
  expect(steps[0].classList.contains('done')).toBe(false); // sem token
  expect(steps[1].classList.contains('done')).toBe(true); // pasta
  expect(steps[2].querySelector('h3').textContent).toBe('Idioma'); // novo passo
  expect(steps[3].classList.contains('done')).toBe(true); // microfone permitido
  expect(steps[4].classList.contains('done')).toBe(false);
  expect(steps[4].textContent).toContain('Baixando 42%');
  expect(box.textContent).toContain('claude setup-token');
  expect(steps[0].textContent).toContain('Conectar a IA');
});

it('provedor ativo conectado marca a etapa 1 como pronta e mostra remover', async () => {
  g.window.rice = fakeRice({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true, last4: 'wxyz', detail: 'Token salvo (…wxyz).' }) }) });
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  expect(box.querySelector('.step').classList.contains('done')).toBe(true);
  const clear = [...box.querySelectorAll('button')].find((b: any) => b.textContent === 'Remover') as any;
  expect(clear.hidden).toBe(false);
});

it('erro de validação aparece e "Fechar guia" marca onboardingDone', async () => {
  const rice = fakeRice();
  g.window.rice = rice;
  const onClose = vi.fn();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose });
  const btn = (t: string) => [...box.querySelectorAll('button')].find((b: any) => b.textContent === t) as any;
  btn('Salvar').click();
  await vi.waitFor(() => expect(box.querySelector('.ai-card .feedback').textContent).toContain('sk-ant-oat'));
  btn('Fechar guia').click();
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(rice.setOnboardingDone).toHaveBeenCalled();
});

it('com etapa pendente mostra a dica de reabrir; tudo pronto não mostra', async () => {
  const hint = 'Você pode reabrir este guia em “Como usar o Rice” na barra lateral.';
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  expect(box.textContent).toContain(hint);
  g.window.rice = fakeRice({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true, last4: 'wxyz' }) }), asrStatus: async () => ({ state: 'ready' }) });
  const ready = g.document.createElement('div');
  await g.window.RiceGuide.render(ready, { onClose: () => {} });
  expect(ready.textContent).not.toContain(hint);
});

const calStep = async (over: Record<string, unknown> = {}) => {
  const rice: any = fakeRice({
    googleStatus: vi.fn(async () => ({ hasClient: false, connected: false, calendars: 0 })),
    googleSaveClient: vi.fn(async () => ({ ok: true })),
    googleConnect: vi.fn(async () => ({ ok: true })),
    googleDisconnect: vi.fn(async () => ({ ok: true })),
    eventKitStatus: vi.fn(async () => ({ access: 'notDetermined' })),
    eventKitRequest: vi.fn(async () => ({ access: 'notDetermined' })),
    openInternetAccounts: vi.fn(async () => {}),
    openCalendarPrivacy: vi.fn(async () => {}),
    ...over,
  });
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  return { rice, box, step: box.querySelector('[data-step="calendar"]') as any };
};
const btn = (root: any, text: string) => [...root.querySelectorAll('button')].find((b: any) => b.textContent === text) as any;

it('Agenda: título "Agenda", "Opcional" uma vez só, macOS aberto e recomendado, Google recolhido', async () => {
  const { step } = await calStep();
  expect(step.querySelector('h3').textContent).toBe('Agenda');
  expect(step.querySelector('.step-state').textContent).toBe('Opcional');
  expect((step.textContent.match(/pcional/g) || []).length).toBe(1);
  const mac = step.querySelector('.ai-card[data-option=macos]');
  const google = step.querySelector('.ai-card[data-option=google]');
  expect(mac.classList.contains('open')).toBe(true);
  expect(google.classList.contains('open')).toBe(false);
  expect(mac.querySelector('strong').textContent).toBe('Calendário do macOS (recomendado)');
  expect(mac.textContent).toContain('Ajustes do Sistema › Contas de Internet');
  expect(google.querySelector('strong').textContent).toBe('Conectar direto ao Google (avançado)');
  expect(step.textContent.match(/nada da reunião é enviado ao Google/g)).toHaveLength(1);
  expect(step.textContent).not.toContain('Sem Google Cloud');
});

it('Agenda, macOS: status real do acesso e ações certas para cada caso', async () => {
  const cases: [string, string, string[]][] = [
    ['notDetermined', 'Acesso ao Calendário ainda não permitido', ['Abrir Contas de Internet', 'Permitir acesso ao Calendário']],
    ['denied', 'Acesso negado. Libere em Privacidade e Segurança › Calendários.', ['Abrir Contas de Internet', 'Abrir Ajustes de Calendários']],
    ['granted', 'Acesso ao Calendário permitido', ['Abrir Contas de Internet']],
  ];
  for (const [access, text, buttons] of cases) {
    const { step } = await calStep({ eventKitStatus: async () => ({ access }) });
    const mac = step.querySelector('.ai-card[data-option=macos]');
    expect(mac.querySelector('.ai-status').textContent, access).toBe(text);
    expect([...mac.querySelectorAll('.ai-actions button')].map((b: any) => b.textContent), access).toEqual(buttons);
  }
  const { step, rice } = await calStep();
  btn(step, 'Abrir Contas de Internet').click();
  expect(rice.openInternetAccounts).toHaveBeenCalled();
  btn(step, 'Permitir acesso ao Calendário').click();
  await vi.waitFor(() => expect(rice.eventKitRequest).toHaveBeenCalled());
});

it('Agenda: conectado pelo macOS ou pelo Google aparece no título e marca o passo como feito', async () => {
  const mac = await calStep({ eventKitStatus: async () => ({ access: 'granted' }) });
  expect(mac.step.classList.contains('done')).toBe(true);
  expect(mac.step.querySelector('.step-state').textContent).toBe('Conectado: Calendário do macOS');
  const google = await calStep({ googleStatus: async () => ({ hasClient: true, connected: true, calendars: 3 }) });
  expect(google.step.classList.contains('done')).toBe(true);
  expect(google.step.querySelector('.step-state').textContent).toBe('Conectado: Google');
  expect(google.step.querySelector('.ai-card[data-option=google] .ai-status').textContent).toBe('Conectado — 3 agendas.');
});

it('Agenda, Google: passos curtos com code, campos com rótulo acima, rodapé com status e Conectar à direita', async () => {
  const { step, rice } = await calStep();
  const google = step.querySelector('.ai-card[data-option=google]');
  expect(google.querySelectorAll('.ai-step')).toHaveLength(4);
  expect([...google.querySelectorAll('.ai-step code')].map((c: any) => c.textContent)).toEqual(['console.cloud.google.com', 'Google Calendar API']);
  expect([...google.querySelectorAll('.ai-field-label')].map((l: any) => l.textContent)).toEqual(['Client ID', 'Client secret']);
  const foot = google.querySelector('.ai-foot');
  expect(foot.querySelector('.ai-status').textContent).toBe('Não conectado');
  expect(foot.querySelector('.ai-actions').lastElementChild.textContent).toBe('Conectar');
  expect(google.querySelector('.ai-pad').lastElementChild).toBe(foot);
  google.querySelector('#google-client-id').value = 'x.apps.googleusercontent.com';
  google.querySelector('#google-client-secret').value = 'seg';
  btn(google, 'Conectar').click();
  await vi.waitFor(() => expect(rice.googleConnect).toHaveBeenCalled());
  expect(rice.googleSaveClient).toHaveBeenCalledWith('x.apps.googleusercontent.com', 'seg');
});

it('Agenda: erro ao conectar aparece no feedback', async () => {
  const { step } = await calStep({ googleStatus: async () => ({ hasClient: true, connected: false }), googleConnect: async () => ({ ok: false, message: 'Você não autorizou o acesso.' }) });
  btn(step, 'Conectar').click();
  await vi.waitFor(() => expect(step.querySelector('#google-feedback').textContent).toBe('Você não autorizou o acesso.'));
});

const card = (box: any, vendor: string) => box.querySelector(`.ai-card[data-vendor=${vendor}]`) as any;
const cardBtn = (c: any, text: string) => [...c.querySelectorAll('button')].find((b: any) => b.textContent === text) as any;

it('quatro cartões (Claude, ChatGPT, Google Gemini, OpenCode) com logo; só o OpenCode não tem abas', async () => {
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const cards = [...box.querySelectorAll('[data-step="ai"] .ai-card')] as any[];
  expect(cards.map((c) => c.dataset.vendor)).toEqual(['claude', 'chatgpt', 'gemini', 'opencode', 'agy', 'local']);
  expect(cards.map((c) => c.querySelector('strong').textContent)).toEqual(['Claude', 'ChatGPT', 'Google Gemini', 'OpenCode', 'Antigravity', 'Modelo local']);
  expect(cards.map((c) => c.querySelector('.provider-logo').className)).toEqual(['provider-logo logo-claude', 'provider-logo logo-chatgpt', 'provider-logo logo-gemini', 'provider-logo logo-opencode', 'provider-logo logo-agy', 'provider-logo logo-local']);
  for (const c of cards.slice(0, 2)) expect([...c.querySelectorAll('[role=tab]')].map((t: any) => t.textContent)).toEqual(['Assinatura', 'Chave de API']);
  expect(cards[2].querySelectorAll('[role=tab]')).toHaveLength(0); // Google Gemini: só a chave de API
  expect(card(box, 'claude').querySelector('.ai-card-state').textContent).toContain('Ativo');
});

it('OpenCode: sem login mostra a instrução do terminal com "Copiar comando"; nada de campo ou aba de API', async () => {
  const writeText = vi.fn(async (_t: string) => {});
  Object.defineProperty(g.navigator, 'clipboard', { value: { writeText }, configurable: true });
  const rice = fakeRice({ listAiModels: vi.fn(async () => ({ ok: true, models: [] })) });
  (rice as any).copyText = async (t: string) => { await writeText(t); return true; };
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const c = card(box, 'opencode');
  expect(c.querySelector('[role=tab]')).toBeNull();
  expect(c.querySelector('input')).toBeNull();
  expect(c.textContent).toContain('opencode auth login');
  expect(c.querySelector('.ai-login-hint')).toBeNull(); // a caixa grande de login saiu: a instrução está só no passo
  expect((c.textContent.match(/opencode auth login/g) || []).length).toBe(1);
  expect(c.querySelector('.ai-status-text').textContent).toBe('Sem login');
  await vi.waitFor(() => expect(rice.listAiModels).toHaveBeenCalledWith('opencode-sub'));
  const copy = [...c.querySelectorAll('.cmd-copy')].find((b: any) => b.closest('.cmd-line').textContent.includes('opencode auth login')) as any;
  expect(copy.getAttribute('aria-label')).toBe('Copiar comando');
  copy.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('opencode auth login'));
  cardBtn(c, 'Usar este').click();
  await vi.waitFor(() => expect(rice.setAiProvider).toHaveBeenCalledWith('opencode-sub'));
});

it('OpenCode: com login lista os modelos autenticados, sem a dica de login, e salva a escolha', async () => {
  const rice = fakeRice({
    aiStatus: async () => aiStatus('opencode-sub', { 'opencode-sub': provider({ installed: true, loggedIn: true, connected: true, detail: 'Conectado.' }) }),
    listAiModels: vi.fn(async () => ({ ok: true, models: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5'] })),
  });
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const c = card(box, 'opencode');
  await vi.waitFor(() => expect(rice.listAiModels).toHaveBeenCalled());
  expect(c.querySelector('.ai-login-hint')).toBeNull();
  expect(c.querySelector('.ai-card-state').textContent).toContain('Ativo');
  expect(c.querySelector('details.ai-fold')).not.toBeNull(); // logado: os passos viram "Como configurar"
  expect(c.querySelector('.ai-status-text').textContent).toBe('Conectado · Automático');
  c.querySelector('.menu-select-btn, button[aria-haspopup]')?.click();
  await vi.waitFor(() => expect(c.ownerDocument.body.textContent + c.textContent).toContain('openai/gpt-5'));
});

it('OpenCode: o modelo gratuito é opção explícita rotulada e mostra o aviso de privacidade só quando selecionado', async () => {
  const mk = (model: string) => fakeRice({
    aiStatus: async () => ({ ...aiStatus('opencode-sub', { 'opencode-sub': provider({ installed: true, loggedIn: true, connected: true, detail: 'Conectado.' }) }), models: { 'opencode-sub': model } }),
    listAiModels: vi.fn(async () => ({ ok: true, models: ['openai/gpt-5', 'opencode/big-pickle'] })),
  });
  const open = async (model: string) => {
    const rice = mk(model);
    g.window.rice = rice;
    const box = g.document.createElement('div');
    await g.window.RiceGuide.render(box, { onClose: () => {} });
    const c = card(box, 'opencode');
    await vi.waitFor(() => expect(rice.listAiModels).toHaveBeenCalled());
    return c;
  };
  const warning = (c: any) => [...c.querySelectorAll('p')].find((x) => x.textContent?.includes('pode usar suas transcrições'));
  const none = await open('');
  expect(warning(none)?.hidden).toBe(true);
  const modelBtn: any = none.querySelector('.menu-select-btn');
  await vi.waitFor(() => {
    modelBtn.click();
    const ids = [...none.querySelectorAll('.select-opt')].map((o: any) => o.textContent.replace('✓', '').trim());
    expect(ids).toEqual(['Automático', 'openai/gpt-5', 'Gratuito (OpenCode Zen)']);
    modelBtn.click();
  });
  const free = await open('opencode/big-pickle');
  expect(warning(free)?.hidden).toBe(false);
});

it('ChatGPT assinatura: passo a passo do codex login, sem campo de colar; aba API tem campo e aviso de custo', async () => {
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const c = card(box, 'chatgpt');
  cardBtn(c, 'Assinatura').click();
  expect(c.textContent).toContain('npm i -g @openai/codex');
  expect(c.textContent).toContain('codex login');
  expect(c.querySelector('input')).toBeNull();
  expect(cardBtn(c, 'Testar conexão')).toBeDefined();
  expect(cardBtn(c, 'Salvar')).toBeUndefined();
  cardBtn(c, 'Chave de API').click();
  expect(c.textContent).toContain('platform.openai.com');
  expect(c.textContent).toContain('cobrada por uso');
  expect(c.querySelector('input').type).toBe('password');
});

it('Gemini: só a chave de API (sem abas Assinatura/Chave, sem passo de login pelo terminal)', async () => {
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const c = card(box, 'gemini');
  expect(c.querySelector('.ai-tabs')).toBeNull();
  expect(c.textContent).not.toContain('gemini-cli');
  expect(c.textContent).not.toContain('Login with Google');
  expect(c.textContent).toContain('aistudio.google.com');
  expect(c.querySelector('input')).not.toBeNull(); // o campo da chave
});

it('"Usar este" define o provedor ativo (o ativo não tem o botão)', async () => {
  const rice = fakeRice();
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  expect(cardBtn(card(box, 'claude'), 'Usar este')).toBeUndefined(); // o ativo não oferece "Usar este"
  const c = card(box, 'chatgpt');
  cardBtn(c, 'Chave de API').click();
  cardBtn(c, 'Usar este').click();
  await vi.waitFor(() => expect(rice.setAiProvider).toHaveBeenCalledWith('openai-api'));
});

it('salvar chave: vai ao main com o provedor da aba, o campo é limpo e a chave não fica no DOM', async () => {
  const rice = fakeRice({ saveAiKey: vi.fn(async () => ({ ok: true, last4: '7890' })) });
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const c = card(box, 'claude');
  cardBtn(c, 'Chave de API').click();
  const input = c.querySelector('input');
  input.value = 'sk-ant-api03-abcdefghijklmnopqrst7890';
  cardBtn(c, 'Salvar').click();
  await vi.waitFor(() => expect(rice.saveAiKey).toHaveBeenCalledWith('claude-api', 'sk-ant-api03-abcdefghijklmnopqrst7890'));
  expect(input.value).toBe('');
  expect(box.innerHTML).not.toContain('abcdefghijklmnopqrst');
});

it('testar mostra o resultado do provedor da aba; modelo da API vem da listagem e é salvo', async () => {
  const rice = fakeRice({
    aiStatus: async () => aiStatus('claude-sub', { 'claude-api': provider({ connected: true, hasKey: true, last4: '7890', detail: 'Chave salva (…7890).' }) }),
  });
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const c = card(box, 'claude');
  cardBtn(c, 'Chave de API').click();
  cardBtn(c, 'Testar conexão').click();
  await vi.waitFor(() => expect(rice.testAi).toHaveBeenCalledWith('claude-api'));
  await vi.waitFor(() => expect(c.querySelector('.feedback').textContent).toBe('Conexão funcionando.'));
  expect(c.querySelector('select')).toBeNull(); // nada de <select> nativo
  const modelBtn = c.querySelector('.menu-select-btn');
  expect(modelBtn.textContent).toBe('claude-sonnet-5-5 (padrão)');
  await vi.waitFor(() => expect(rice.listAiModels).toHaveBeenCalledWith('claude-api'));
  await vi.waitFor(() => {
    modelBtn.click();
    const ids = [...c.querySelectorAll('.select-opt')].map((o: any) => o.textContent.replace('✓', '').trim());
    expect(ids).toEqual(['claude-sonnet-5-5 (padrão)', 'claude-opus-5-5']);
    modelBtn.click();
  });
  expect(c.querySelector('.ai-status-text').textContent).toBe('Conexão funcionando.');
  modelBtn.click();
  [...c.querySelectorAll('.select-opt')].find((o: any) => o.textContent.includes('claude-opus-5-5')).click();
  expect(rice.setAiModel).toHaveBeenCalledWith('claude-api', 'claude-opus-5-5');
  expect(modelBtn.textContent).toBe('claude-opus-5-5');
  expect(cardBtn(c, 'Remover')).toBeDefined();
});

it('texto de privacidade fala do provedor escolhido e o indicador "via …" usa o logo do provedor', async () => {
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  expect(box.textContent).toContain('enviado ao provedor de IA escolhido');
  const via = g.document.createElement('div');
  g.window.RiceAiProviders.updateVia(via, 'chatgpt-sub');
  expect(via.textContent).toBe('via ChatGPT');
  expect(via.querySelector('.logo-chatgpt')).not.toBeNull();
  g.window.RiceAiProviders.updateVia(via, 'gemini-api');
  expect(via.textContent).toBe('via Gemini (API)');
});

it('pasta das reuniões: explica o que fica salvo, mostra ~/caminho e tem Abrir no Finder e Trocar pasta', async () => {
  const rice: any = fakeRice({ getSettings: async () => ({ root: '/Users/x/Rice', rootDisplay: '~/Rice' }), revealRoot: vi.fn(async () => ({ ok: true })) });
  g.window.rice = rice;
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const step2 = box.querySelectorAll('.step')[1];
  expect(step2.querySelector('h3').textContent).toBe('Onde suas reuniões ficam salvas');
  expect(step2.textContent).toContain('Cada reunião vira uma pasta aqui, com a transcrição, as notas, suas anotações e o áudio (se ativado).');
  expect(step2.textContent).toContain('ficam só neste Mac');
  expect(step2.querySelector('.stat-state').textContent).toBe('~/Rice');
  const btn = (t: string) => [...step2.querySelectorAll('button')].find((b: any) => b.textContent === t) as any;
  btn('Abrir no Finder').click();
  expect(rice.revealRoot).toHaveBeenCalled();
  btn('Trocar pasta…').click();
  await vi.waitFor(() => expect(rice.chooseRoot).toHaveBeenCalled());
});

it('idioma no tutorial e nas configurações: controle segmentado com radiogroup, aria-checked e setas do teclado', async () => {
  const rice: any = fakeRice({
    getSettings: async () => ({ root: '/Users/x/Rice', uiLanguage: 'pt-BR', transcriptionLanguage: 'pt' }),
    setUiLanguage: vi.fn(async () => ({ ok: true })),
    setTranscriptionLanguage: vi.fn(async () => ({ ok: true })),
  });
  g.window.rice = rice;
  const box = g.document.createElement('div');
  g.document.body.append(box);
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const step = box.querySelectorAll('.step')[2];
  expect(step.querySelectorAll('select')).toHaveLength(0);
  const groups = [...step.querySelectorAll('[role=radiogroup]')] as any[];
  expect(groups).toHaveLength(2);
  const radios = (grp: any) => [...grp.querySelectorAll('[role=radio]')] as any[];
  expect(radios(groups[1]).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  expect(radios(groups[1]).map((b) => b.tabIndex)).toEqual([0, -1, -1]); // só o ativo entra no Tab
  radios(groups[1])[0].focus();
  radios(groups[1])[0].dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(rice.setTranscriptionLanguage).toHaveBeenCalledWith('en'));
  radios(groups[1])[0].dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(rice.setTranscriptionLanguage).toHaveBeenCalledWith('auto')); // volta dando a volta
  // depois de salvar o tutorial re-renderiza e o foco continua no botão ativo do grupo
  await vi.waitFor(() => expect(g.document.activeElement?.getAttribute('aria-checked')).toBe('true'));
  expect(g.document.activeElement?.getAttribute('name')).toBe('transcription-language');
  box.remove();
});

it('menu-select: abre o popover .menu-popover, navega com setas, Enter escolhe, Esc fecha e devolve o foco', () => {
  new Function(readFileSync('src/renderer/menu-select.js', 'utf8'))();
  const onChoose = vi.fn();
  const sel = g.window.RiceMenuSelect.create({ items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', ariaLabel: 'Modelo', onChoose });
  g.document.body.append(sel.root);
  const btn = sel.root.querySelector('.menu-select-btn');
  expect(btn.textContent).toBe('A');
  btn.click();
  const pop = sel.root.querySelector('.menu-popover');
  expect(pop.getAttribute('role')).toBeNull();
  expect(pop.querySelector('[role=listbox]')).not.toBeNull();
  pop.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  pop.dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(onChoose).toHaveBeenCalledWith('b');
  expect(btn.textContent).toBe('B');
  expect(sel.root.querySelector('.menu-popover')).toBeNull();
  btn.click();
  sel.root.querySelector('.menu-popover').dispatchEvent(new g.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(sel.root.querySelector('.menu-popover')).toBeNull();
  expect(g.document.activeElement).toBe(btn);
  sel.root.remove();
});

const guide = async (over: Record<string, any> = {}) => {
  g.window.rice = fakeRice(over);
  const box = g.document.createElement('div');
  g.document.body.append(box);
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  return box;
};
const connectedClaude = { aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true, last4: 'wxyz' }) }) };
const open = (box: any) => [...box.querySelectorAll('[data-step="ai"] .ai-card.open')].map((c: any) => c.dataset.vendor);

describe('Conectar a IA: lista compacta com acordeão', () => {
  it('uma linha por provedor com logo, nome, estado e chevron; a ativa fica no topo', async () => {
    const box = await guide({ aiStatus: async () => aiStatus('chatgpt-sub', { 'chatgpt-sub': provider({ installed: true, connected: true, verified: true, detail: 'Conectado.' }), 'claude-sub': provider({ connected: true, hasKey: true, last4: 'wxyz' }) }) });
    const cards = [...box.querySelectorAll('[data-step="ai"] .ai-card')] as any[];
    expect(cards.map((c) => c.dataset.vendor)).toEqual(['chatgpt', 'claude', 'gemini', 'opencode', 'agy', 'local']); // ChatGPT ativo sobe; os outros mantêm a ordem
    for (const c of cards) {
      const head = c.querySelector('.ai-head');
      expect(head.querySelector('.provider-logo')).not.toBeNull();
      expect(head.querySelector('strong').textContent).toBeTruthy();
      expect(head.querySelector('.ai-card-state')).not.toBeNull();
      expect(head.querySelector('.ai-chevron svg')).not.toBeNull();
      expect(head.getAttribute('aria-expanded')).toBeDefined();
    }
    expect(cards.map((c) => c.querySelector('.ai-card-state').textContent)).toEqual(['Ativo', 'Conectado', 'Não configurado', 'Não configurado', 'Não configurado', 'Não configurado']);
    expect(cards[0].querySelector('.state-dot')).not.toBeNull();
  });

  it('estados: login expirado (assinatura que falhou no teste) e chave recusada (API)', async () => {
    const box = await guide({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true }), 'chatgpt-sub': provider({ installed: true, verified: false }), 'gemini-api': provider({ hasKey: true, verified: false }) }) });
    expect(card(box, 'chatgpt').querySelector('.ai-card-state').textContent).toBe('Login expirado');
    expect(card(box, 'gemini').querySelector('.ai-card-state').textContent).toBe('Chave recusada');
  });

  it('com algo conectado abre recolhida; com nada configurado abre o primeiro', async () => {
    const connected = await guide(connectedClaude);
    expect(open(connected)).toEqual([]);
    const none = await guide({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: false, hasKey: false }) }) });
    expect(open(none)).toEqual(['claude']);
  });

  it('acordeão: abrir um fecha o outro; clicar de novo recolhe; detalhe escondido fica inerte (sem foco)', async () => {
    const box = await guide(connectedClaude);
    const head = (v: string) => card(box, v).querySelector('.ai-head');
    head('chatgpt').click();
    expect(open(box)).toEqual(['chatgpt']);
    expect(head('chatgpt').getAttribute('aria-expanded')).toBe('true');
    expect(card(box, 'chatgpt').querySelector('.ai-detail').inert).toBe(false);
    expect(card(box, 'gemini').querySelector('.ai-detail').inert).toBe(true);
    head('gemini').click();
    expect(open(box)).toEqual(['gemini']);
    expect(head('chatgpt').getAttribute('aria-expanded')).toBe('false');
    expect(card(box, 'chatgpt').querySelector('.ai-detail').inert).toBe(true);
    head('gemini').click();
    expect(open(box)).toEqual([]);
  });

  it('a nota do Keychain aparece UMA vez, no rodapé, e não em cada provedor', async () => {
    const box = await guide();
    expect((box.textContent.match(/criptografada no Keychain/g) || []).length).toBe(1);
    const note = box.querySelector('.ai-cards > .ai-note');
    expect(note).not.toBeNull();
    expect(note.parentElement.lastElementChild).toBe(note);
  });

  it('detalhe enxuto: comandos em code com botão de copiar; Testar conexão secundário; Usar este primário só no que não é o ativo', async () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(g.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const box = await guide();
    g.window.rice.copyText = (async (t: string) => { await writeText(t); return true; });
    const c = card(box, 'chatgpt');
    const cmds = [...c.querySelectorAll('.cmd-line code')].map((x: any) => x.textContent);
    expect(cmds).toEqual(['npm i -g @openai/codex', 'brew install codex', 'codex login']);
    c.querySelectorAll('.cmd-copy')[2].click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('codex login'));
    expect(cardBtn(c, 'Testar conexão').className).toContain('secondary');
    expect(cardBtn(c, 'Usar este').className).toContain('primary');
    expect(c.querySelector('.ai-foot .ai-actions').lastElementChild.textContent).toBe('Usar este');
    expect(cardBtn(card(box, 'claude'), 'Usar este')).toBeUndefined(); // o ativo
  });

  it('depois de uma ação a tela se redesenha mantendo aberto o provedor em que o usuário estava', async () => {
    const box = await guide();
    card(box, 'chatgpt').querySelector('.ai-head').click();
    cardBtn(card(box, 'chatgpt'), 'Usar este').click();
    await vi.waitFor(() => expect(g.window.rice.setAiProvider).toHaveBeenCalledWith('chatgpt-sub'));
    await vi.waitFor(() => expect(open(box)).toEqual(['chatgpt']));
  });

  it('erro de login do provedor ativo faz o detalhe dele abrir na próxima vez', async () => {
    g.window.RiceAiProviders.markLoginError('gemini-api');
    const box = await guide(connectedClaude);
    expect(open(box)).toEqual(['gemini']);
    const again = await guide(connectedClaude);
    expect(open(again)).toEqual([]); // vale uma vez só
  });

  it('com tudo recolhido a lista é baixa: 4 linhas de 48px', () => {
    const html = readFileSync('src/renderer/index.html', 'utf8');
    expect(html).toMatch(/\.ai-head \{[^}]*height:48px/);
    expect(html).toMatch(/\.ai-detail \{[^}]*grid-template-rows:0fr/);
    expect(html).toMatch(/\.ai-card\.open \.ai-detail \{[^}]*grid-template-rows:1fr/);
  });
});


describe('Conectar a IA: layout único do detalhe', () => {
  const noLoginOpenCode = (model = '') => ({
    aiStatus: async () => ({ ...aiStatus('claude-sub', { 'opencode-sub': provider({ installed: true, loggedIn: false, connected: model !== '', detail: 'x' }), 'claude-sub': provider({ connected: true, hasKey: true, last4: 'wxyz' }) }), models: { 'opencode-sub': model } }),
    listAiModels: vi.fn(async () => ({ ok: true, models: [] })),
  });
  const detailOf = (c: any) => [...c.querySelector('.ai-pad').children] as any[];
  const kinds = (c: any) => detailOf(c).map((n) => n.className.split(' ')[0] || n.tagName.toLowerCase());

  it('todos os provedores: abas (se houver), passos, campos, rodapé — nessa ordem, numa coluna só', async () => {
    const box = await guide({ aiStatus: async () => aiStatus('chatgpt-sub', {}) });
    expect(kinds(card(box, 'chatgpt'))).toEqual(['ai-tabs', 'ai-steps', 'ai-foot']);
    expect(kinds(card(box, 'claude'))).toEqual(['ai-tabs', 'ai-steps', 'ai-field', 'ai-foot']); // assinatura: campo do token
    expect(kinds(card(box, 'opencode'))).toEqual(['ai-steps', 'ai-field', 'ai-note-line', 'ai-foot']); // sem abas; modelo + nota (oculta)
    cardBtn(card(box, 'claude'), 'Chave de API').click();
    expect(kinds(card(box, 'claude'))).toEqual(['ai-tabs', 'ai-steps', 'ai-field', 'ai-field', 'ai-note-line', 'ai-foot']); // chave, modelo e aviso de custo
  });

  it('passos numerados em círculo, comando em bloco com o botão de copiar DENTRO', async () => {
    const box = await guide(noLoginOpenCode());
    const c = card(box, 'opencode');
    const steps = [...c.querySelectorAll('.ai-steps > .ai-step')] as any[];
    expect(steps.map((s) => s.querySelector('.ai-step-n').textContent)).toEqual(['1', '2', '3']);
    const line = c.querySelector('.cmd-line');
    expect(line.querySelector('code')).not.toBeNull();
    expect(line.querySelector('.cmd-copy')).not.toBeNull(); // dentro do bloco
  });

  it('campo com rótulo ACIMA e controle em largura total (modelo e chave)', async () => {
    const box = await guide(noLoginOpenCode());
    const f = card(box, 'opencode').querySelector('.ai-field');
    expect(f.firstElementChild.tagName).toBe('LABEL');
    expect(f.firstElementChild.textContent).toBe('Modelo');
    expect(f.lastElementChild.querySelector('.menu-select-btn')).not.toBeNull();
    const key = card(box, 'claude').querySelector('.ai-field');
    expect(key.firstElementChild.tagName).toBe('LABEL');
    expect(key.querySelector('input.ai-key')).not.toBeNull();
  });

  it('OpenCode sem login com o gratuito: nota com ícone info logo abaixo do select e rodapé "Sem login · usando o modelo gratuito" (âmbar)', async () => {
    const box = await guide(noLoginOpenCode('opencode/big-pickle'));
    const c = card(box, 'opencode');
    const field = c.querySelector('.ai-field');
    const noteLine = field.nextElementSibling;
    expect(noteLine.className).toBe('ai-note-line');
    expect(noteLine.hidden).toBe(false);
    expect(noteLine.querySelector('svg.icon-info')).not.toBeNull();
    expect(noteLine.textContent).toContain('pode usar suas transcrições');
    expect(c.querySelector('.ai-status-text').textContent).toBe('Sem login · usando o modelo gratuito');
    expect(c.querySelector('.ai-status .state-dot').className).toContain('tone-warn');
    expect((c.textContent.match(/Sem login/g) || []).length).toBe(1); // o estado aparece uma vez
  });

  it('sem o gratuito a nota fica oculta; o rodapé diz só "Sem login"', async () => {
    const box = await guide(noLoginOpenCode(''));
    const c = card(box, 'opencode');
    expect(c.querySelector('.ai-note-line').hidden).toBe(true);
    expect(c.querySelector('.ai-status-text').textContent).toBe('Sem login');
  });

  it('rodapé: estado à esquerda com ponto colorido; Testar (secundário) e Usar este (primário) à direita; ativo sem Usar este', async () => {
    const box = await guide(noLoginOpenCode());
    const foot = card(box, 'opencode').querySelector('.ai-foot');
    expect(foot.firstElementChild.className).toContain('ai-status');
    expect(foot.lastElementChild.className).toBe('ai-actions');
    expect([...foot.querySelectorAll('.ai-actions button')].map((b: any) => b.textContent)).toEqual(['Testar conexão', 'Usar este']);
    expect(cardBtn(card(box, 'opencode'), 'Testar conexão').className).toBe('secondary');
    expect(cardBtn(card(box, 'opencode'), 'Usar este').className).toContain('primary');
    expect(card(box, 'claude').querySelector('.ai-status .state-dot').className).toContain('tone-ok'); // conectado
    expect(cardBtn(card(box, 'claude'), 'Usar este')).toBeUndefined(); // ativo
  });

  it('login expirado vira vermelho no rodapé; teste que falha também', async () => {
    const box = await guide({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true }), 'chatgpt-sub': provider({ installed: true, verified: false }) }), testAi: vi.fn(async () => ({ ok: false, message: 'Sessão expirada.' })) });
    const c = card(box, 'chatgpt');
    expect(c.querySelector('.ai-status-text').textContent).toBe('Login expirado');
    expect(c.querySelector('.ai-status .state-dot').className).toContain('tone-bad');
    cardBtn(c, 'Testar conexão').click();
    await vi.waitFor(() => expect(c.querySelector('.ai-status-text').textContent).toBe('Sessão expirada.'));
    expect(c.querySelector('.ai-status .state-dot').className).toContain('tone-bad');
  });

  it('já configurado: passos colapsam em "Como configurar" (fechado); não configurado: passos à mostra', async () => {
    const box = await guide({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true }) }) });
    const ok = card(box, 'claude').querySelector('details.ai-fold');
    expect(ok.open).toBe(false);
    expect(ok.querySelector('summary').textContent).toBe('Como configurar');
    expect(card(box, 'gemini').querySelector('details.ai-fold')).toBeNull();
    expect(card(box, 'gemini').querySelector('.ai-steps')).not.toBeNull();
  });

  it('CSS: 16px de respiro, 12px entre blocos, círculo de 18px, código com fundo --hover e raio 6px, hairline no rodapé', () => {
    const html = readFileSync('src/renderer/index.html', 'utf8');
    expect(html).toMatch(/\.ai-pad \{[^}]*padding:16px[^}]*gap:12px/);
    expect(html).toMatch(/\.ai-step-n \{[^}]*width:18px; height:18px[^}]*background:var\(--hover\)[^}]*font-size:11px/);
    expect(html).toMatch(/\.cmd-line code \{[^}]*font:12\.5px[^}]*white-space:pre; overflow-x:auto/); // 'curl … | bash' não quebra no meio: rolagem discreta dentro do bloco
    expect(html).toMatch(/\.cmd-copy \{[^}]*width:28px; height:28px/);
    expect(html).toMatch(/\.cmd-line \{[^}]*min-height:36px[^}]*padding:8px 10px 8px 12px; background:var\(--hover\); border-radius:8px; box-shadow:inset 0 0 0 1px var\(--line\)/);
    expect(html).toMatch(/\.ai-foot \{[^}]*padding-top:12px; border-top:1px solid var\(--line\)/);
    expect(html).toMatch(/\.ai-field \{[^}]*gap:6px/);
  });
});

describe('Como usar o Rice: esqueleto e indicadores harmônicos', () => {
  const style = [...readFileSync('src/renderer/index.html', 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

  it('indicador de estado igual em todos: círculo com o número; pronto = círculo cheio com check de linha (nada de "✓" em texto)', async () => {
    const box = await guide({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true }) }), asrStatus: async () => ({ state: 'ready' }) });
    const steps = [...box.querySelectorAll('.step')] as any[];
    expect(steps.length).toBeGreaterThanOrEqual(8); // o passo de privacidade (segurança) soma mais um
    for (const s of steps) {
      expect(s.firstElementChild.className).toBe('step-head');
      expect(s.querySelector('.step-badge').dataset.n).toBeTruthy();
      expect(s.querySelector('.step-badge').textContent).not.toContain('✓');
    }
    const done = steps.filter((s) => s.classList.contains('done'));
    expect(done.length).toBeGreaterThan(0);
    for (const s of done) expect(s.querySelector('.step-badge svg.icon-check')).not.toBeNull();
    const todo = steps.find((s) => !s.classList.contains('done'));
    expect(todo.querySelector('.step-badge svg')).toBeNull();
    expect(todo.querySelector('.step-badge').textContent).toBe(todo.querySelector('.step-badge').dataset.n);
  });

  it('botões do guia são do padrão do app (btn ghost / btn primary, 32px) e o idioma usa as mesmas linhas das Configurações', async () => {
    const box = await guide();
    const buttons = [...box.querySelectorAll('.step-body > .row button, .step-body > .row > button, [data-step="calendar"] .ai-actions button')] as any[];
    expect(buttons.length).toBeGreaterThan(2);
    for (const b of buttons) expect(b.className, b.textContent).toMatch(/^btn (ghost|primary)/);
    const lang = box.querySelectorAll('.step')[2];
    expect(lang.querySelectorAll('.set-row').length).toBe(2);
    expect(lang.querySelector('.setting-field')).toBeNull();
  });

  it('CSS: 32px e hairline entre passos, descrição 13px muted, corpo alinhado ao título, e coluna em largura estreita', () => {
    expect(style).toMatch(/\.step \+ \.step \{ margin-top:40px; padding-top:40px; border-top:1px solid var\(--line\)/);
    expect(style).toMatch(/\.step-badge \{[^}]*width:20px; height:20px; border-radius:50%; background:var\(--hover\); box-shadow:inset 0 0 0 1px var\(--line\); color:var\(--muted\)/);
    expect(style).toMatch(/\.step\.done \.step-badge \{ color:var\(--ink\); \}/);
    expect(style.split('.step-badge {')[1]?.split('}')[0]).not.toContain('accent'); // nada de azul no guia
    expect(style).not.toMatch(/\.step\.done \.step-badge \{[^}]*accent/);
    expect(style).toMatch(/\.step-body > p \{[^}]*font-size:13px[^}]*color:var\(--muted\)/);
    expect(style).toMatch(/\.step-body \{ padding-left:32px; \}/); // 20px do círculo + 12px de espaço = alinha com o título
    expect(style).toMatch(/@container detail \(max-width: 560px\) \{[^@]*\.step-body \{ padding-left:0; \}/);
    expect(style).not.toMatch(/\.path-hl \{[^}]*ui-monospace/); // caminho em fonte normal
  });
});


describe('Como usar o Rice: rodapé e alinhamento', () => {
  it('"Fechar guia" fica num rodapé com hairline, à direita, primário (única ação), depois do último passo', async () => {
    const box = await guide();
    const foot = box.querySelector('.guide-foot');
    expect(foot).not.toBeNull();
    expect(box.lastElementChild).toBe(foot);
    expect(foot.querySelectorAll('button')).toHaveLength(1);
    const close = foot.querySelector('button');
    expect(close.textContent).toBe('Fechar guia');
    expect(close.className).toBe('btn primary');
    expect(foot.lastElementChild).toBe(close); // à direita
    expect(foot.previousElementSibling.classList.contains('step')).toBe(true);
    expect(box.querySelector('.guide-foot .row')).toBeNull(); // o botão solto saiu
    const css2 = style;
    expect(css2).toMatch(/\.guide-foot \{[^}]*margin-top:32px; padding-top:24px; border-top:1px solid var\(--line\)/);
    expect(css2).toMatch(/\.guide-foot \.btn \{ margin-left:auto; \}/);
  });

  it('o aviso de reabrir o guia só aparece com algo pendente, à esquerda do botão', async () => {
    const pending = await guide();
    expect(pending.querySelector('.guide-foot .hint').textContent).toContain('reabrir este guia');
    const ok = await guide({ aiStatus: async () => aiStatus('claude-sub', { 'claude-sub': provider({ connected: true, hasKey: true }) }), asrStatus: async () => ({ state: 'ready' }), permissionStatus: async () => ({ microphone: 'granted' }) });
    expect(ok.querySelector('.guide-foot .hint')).toBeNull();
  });

  const style = [...readFileSync('src/renderer/index.html', 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
});

describe('Como usar o Rice: passos com lista de status e rodapé (mesmo padrão das IAs e da Agenda)', () => {
  const stepOf = async (n: number, over: Record<string, unknown> = {}) => {
    g.window.rice = fakeRice(over);
    const box = g.document.createElement('div');
    await g.window.RiceGuide.render(box, { onClose: () => {} });
    return box.querySelectorAll('.step')[n - 1] as any;
  };
  const rows = (s: any) => [...s.querySelectorAll('.stat-row')].map((r: any) => [r.querySelector('.state-dot').className.replace('state-dot ', ''), r.querySelector('.stat-name').textContent, r.querySelector('.stat-state').textContent]);

  it('Permissões: Microfone e Áudio do sistema com ponto e estado; rodapé com status geral à esquerda e o botão à direita', async () => {
    const s = await stepOf(4, { permissionStatus: async () => ({ microphone: 'granted' }) });
    expect(rows(s)).toEqual([['tone-ok', 'Microfone', 'Permitido'], ['tone-warn', 'Áudio do sistema', 'Pedido na primeira gravação']]);
    const foot = s.querySelector('.ai-foot');
    expect(s.querySelector('.step-body').lastElementChild).toBe(foot);
    expect(foot.querySelector('.ai-status').textContent).toBe('Microfone permitido');
    expect([...foot.querySelectorAll('.ai-actions button')].map((b: any) => [b.textContent, b.className])).toEqual([['Abrir Ajustes de Privacidade', 'btn ghost']]);
    expect(s.querySelector('.step-body > button')).toBeNull(); // nada de botão solto
    expect((await stepOf(4, { permissionStatus: async () => ({ microphone: 'denied' }) })).querySelector('.stat-row .state-dot').className).toContain('tone-bad');
    const pending = await stepOf(4, { permissionStatus: async () => ({ microphone: 'not-determined' }) });
    expect(rows(pending)[0]).toEqual(['tone-warn', 'Microfone', 'Pendente']);
    expect(pending.querySelector('.ai-status').textContent).toBe('Falta permitir o microfone');
  });

  it('Pasta: linha de status com o caminho e rodapé com as duas ações à direita', async () => {
    const s = await stepOf(2);
    expect(rows(s)[0]!.slice(0, 2)).toEqual(['tone-ok', 'Pasta']);
    expect([...s.querySelectorAll('.ai-foot .ai-actions button')].map((b: any) => b.textContent)).toEqual(['Abrir no Finder', 'Trocar pasta…']);
    expect(s.querySelector('.ai-foot .ai-status').textContent).toBe('Pasta definida');
  });

  it('Modelo: uma linha de status (Pronto / Baixando N% / Falhou) e o motivo no rodapé quando falha', async () => {
    expect(rows(await stepOf(5, { asrStatus: async () => ({ state: 'ready' }) }))).toEqual([['tone-ok', 'Modelo local', 'Pronto']]);
    expect(rows(await stepOf(5, { asrStatus: async () => ({ state: 'loading', downloadPercent: 42 }) }))[0]).toEqual(['tone-warn', 'Modelo local', 'Baixando 42%']);
    const failed = await stepOf(5, { asrStatus: async () => ({ state: 'failed', error: 'sem rede' }) });
    expect(rows(failed)[0]).toEqual(['tone-bad', 'Modelo local', 'Falhou']);
    expect(failed.querySelector('.ai-foot .ai-status').textContent).toBe('Falhou: sem rede');
  });
});

describe('Como usar o Rice: passo opcional "Ferramentas e MCPs no chat"', () => {
  const tools = async (over: Record<string, unknown> = {}, ctx: Record<string, unknown> = {}) => {
    g.window.rice = fakeRice({ setChatTools: vi.fn(async () => ({ ok: true })), aiToolsStatus: async () => ({ on: false, available: true }), ...over });
    const box = g.document.createElement('div');
    await g.window.RiceGuide.render(box, { onClose: () => {}, ...ctx });
    return { box, step: box.querySelector('[data-step="tools"]') as any };
  };

  it('desligado: "Opcional", 3 passos (2 comandos copiáveis, o 3º liga a opção), nota de risco com ícone info e rodapé com status + interruptor', async () => {
    const { step } = await tools();
    expect(step.querySelector('h3').textContent).toBe('Ferramentas e MCPs no chat (avançado)');
    expect(step.querySelector('.step-state').textContent).toBe('Opcional');
    expect(step.classList.contains('done')).toBe(false);
    expect(step.querySelectorAll('.ai-step')).toHaveLength(3);
    expect([...step.querySelectorAll('.cmd-line code')].map((c: any) => c.textContent)).toEqual(['claude mcp list', 'claude mcp add <nome> <comando-ou-url>']);
    expect(step.querySelector('.ai-note-line svg.icon-info')).not.toBeNull();
    expect(step.querySelector('.ai-note-line').textContent).toContain('instruções maliciosas');
    const foot = step.querySelector('.ai-foot');
    expect(foot.querySelector('.ai-status').textContent).toBe('Desligado');
    expect(foot.querySelector('input.switch').checked).toBe(false);
    expect(step.textContent).not.toMatch(/mcp\.\w+\.com|run\.app/); // nada de serviço específico
  });

  it('ligado com N MCPs: "Ligado · N MCPs" no estado e no rodapé; sem MCP: "Ligado · nenhum MCP"', async () => {
    const on = await tools({ getSettings: async () => ({ root: '/R', rootDisplay: '~/R', chatTools: true }), aiToolsStatus: async () => ({ on: true, available: true, servers: 3 }) });
    expect(on.step.querySelector('.step-state').textContent).toBe('Ligado · 3 MCPs');
    expect(on.step.classList.contains('done')).toBe(true);
    expect(on.step.querySelector('.ai-foot .ai-status').textContent).toBe('Ligado · 3 MCPs');
    const none = await tools({ getSettings: async () => ({ root: '/R', rootDisplay: '~/R', chatTools: true }), aiToolsStatus: async () => ({ on: true, available: true, servers: 0, hint: 'Nenhum MCP configurado' }) });
    expect(none.step.querySelector('.step-state').textContent).toBe('Ligado · nenhum MCP');
    expect(none.step.textContent).toContain('Nenhum MCP configurado');
  });

  it('o interruptor usa a MESMA confirmação "Ativar mesmo assim": recusar mantém desligado; aceitar liga', async () => {
    const confirm = vi.fn(async () => false);
    const { step } = await tools({}, { confirm });
    const input = step.querySelector('input.switch');
    input.checked = true;
    input.dispatchEvent(new g.window.Event('change'));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect((confirm.mock.calls as any)[0][1]).toBe('Ativar mesmo assim');
    expect((confirm.mock.calls as any)[0][0]).toHaveLength(3);
    await vi.waitFor(() => expect(input.checked).toBe(false));
    expect(g.window.rice.setChatTools).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true as never);
    input.checked = true;
    input.dispatchEvent(new g.window.Event('change'));
    await vi.waitFor(() => expect(g.window.rice.setChatTools).toHaveBeenCalledWith(true));
  });
});

it('passo "Ideias ao vivo e War room": o que é, quando usar, como ligar, custo e cuidado; botão "Nova war room"', async () => {
  const onNewWarRoom = vi.fn();
  g.window.rice = fakeRice();
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {}, onNewWarRoom });
  const step = box.querySelector('[data-step="warroom"]') as any;
  expect(step.querySelector('h3').textContent).toBe('Ideias ao vivo e War room');
  expect(step.querySelector('.step-state').textContent).toBe('Opcional');
  expect(step.querySelectorAll('.guide-points li')).toHaveLength(4); // quando, como ligar, tipos de ideias e custo
  expect(step.textContent).toContain('tokens');
  expect(step.querySelector('.ai-note-line').textContent).toContain('instruções maliciosas');
  [...step.querySelectorAll('button')].find((b: any) => b.textContent === 'Nova war room').click();
  expect(onNewWarRoom).toHaveBeenCalled();
});

describe('aviso do Gemini descontinuado (uma vez só)', () => {
  it('status com notice: nota discreta no topo da lista e o main é avisado para apagá-lo; sem notice não aparece', async () => {
    const dismissAiNotice = vi.fn(async () => ({ ok: true }));
    const withNotice = await guide({ aiStatus: async () => ({ ...aiStatus('claude-sub', {}), notice: 'gemini-discontinued' }), dismissAiNotice });
    const note = withNotice.querySelector('.ai-migrated') as any;
    expect(note.textContent).toBe('O login do Gemini pelo terminal foi descontinuado pelo Google em junho de 2026. Use uma chave de API do Google AI Studio.');
    expect(note.querySelector('svg.icon-info')).not.toBeNull();
    expect(note.getAttribute('role')).toBe('status');
    expect(dismissAiNotice).toHaveBeenCalledTimes(1);
    const again = await guide({ aiStatus: async () => ({ ...aiStatus('claude-sub', {}), notice: null }), dismissAiNotice });
    expect(again.querySelector('.ai-migrated')).toBeNull(); // o main já apagou: não aparece de novo
    expect(dismissAiNotice).toHaveBeenCalledTimes(1);
  });
  it('em inglês', async () => {
    g.window.RiceI18n.setLanguage('en');
    try {
      const box = await guide({ aiStatus: async () => ({ ...aiStatus('claude-sub', {}), notice: 'gemini-discontinued' }), dismissAiNotice: vi.fn() });
      expect(box.querySelector('.ai-migrated').textContent).toBe('Google discontinued the Gemini terminal sign-in in June 2026. Use a Google AI Studio API key.');
    } finally {
      g.window.RiceI18n.setLanguage('pt-BR');
    }
  });
});
