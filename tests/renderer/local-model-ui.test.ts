// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const SERVER = { server: 'auto', serverName: 'Ollama', autoModel: { id: 'qwen3:8b', label: 'Qwen3 8B' }, url: 'http://127.0.0.1:11434', configuredUrl: '', kind: 'ollama', numCtx: 16384, models: [{ id: 'qwen3:8b', size: 5_200_000_000 }, { id: 'llama3.2:3b', size: 2_000_000_000 }] };

function status(over: Record<string, unknown> = {}, local: Record<string, unknown> | null = SERVER) {
  const none = { connected: false, hasKey: false, detail: 'x' };
  return {
    active: 'claude-sub',
    models: {},
    fullyLocal: false,
    providers: {
      'claude-sub': { ...none, connected: true, detail: 'Conectado' },
      'chatgpt-sub': none, 'openai-api': none, 'claude-api': none, 'gemini-api': none, 'opencode-sub': none, 'agy-sub': none,
      'local-model': local ? { ...none, connected: true, installed: true, detail: 'Ollama · 2 modelos', local } : { ...none, installed: false, detail: 'Nenhum servidor local encontrado.', local: { url: '', configuredUrl: '', server: 'auto', kind: null, models: [], numCtx: 16384 } },
    },
    ...over,
  };
}
function boot(extra: Record<string, unknown> = {}) {
  return bootRenderer({
    setAiLocal: vi.fn(async () => ({ ok: true, local: {} })),
    setAiModel: vi.fn(async () => ({ ok: true })),
    setAiProvider: vi.fn(async () => ({ ok: true })),
    testAi: vi.fn(async () => ({ ok: true, message: 'ok' })),
    copyText: vi.fn(async () => true),
    setLocalMode: vi.fn(async (on: boolean) => ({ ok: true, fullyLocal: on })),
    ...extra,
  }, []);
}
const renderList = (st: unknown) => {
  const box = g.document.createElement('div');
  g.document.body.append(box);
  box.append(g.window.RiceAiProviders.render({ status: st, onChange: vi.fn() }));
  return box;
};
const localCard = (box: any) => box.querySelector('.ai-card[data-vendor=local]') as any;

it('o card "Modelo local" vem logo abaixo do Antigravity, com o ícone de chip e o estado', () => {
  boot();
  const box = renderList(status());
  const cards = [...box.querySelectorAll('.ai-card')];
  expect(cards.map((c: any) => c.dataset.vendor).slice(-2)).toEqual(['agy', 'local']);
  expect(localCard(box).querySelector('.provider-logo').className).toContain('logo-local');
  expect(localCard(box).querySelector('strong').textContent).toBe('Modelo local');
  expect(localCard(box).querySelector('.ai-card-state').textContent).toBe('Conectado');
});

it('conectado: endereço editável, servidor encontrado, modelos com o tamanho, contexto 8k/16k/32k e as notas de privacidade', () => {
  boot();
  const card = localCard(renderList(status()));
  expect(card.querySelector('input.ai-key').placeholder).toBe('http://127.0.0.1:11434');
  expect(card.textContent).toContain('Encontrado: Ollama em http://127.0.0.1:11434');
  expect(card.textContent).toContain('Só do próprio computador (127.0.0.1, localhost ou ::1)');
  expect(card.textContent).toContain('Tudo roda neste Mac: nada é enviado para a internet.');
  expect(card.textContent).toContain('O modelo local não acessa a internet: busca na web, ferramentas e MCPs ficam indisponíveis.');
  expect(card.textContent).toContain('Quanto texto o modelo lê de uma vez');
  const buttons = [...card.querySelectorAll('.menu-select-btn')] as any[];
  expect(buttons.map((b) => b.textContent.trim())).toEqual(['Automático (detecta)', 'Automático: Qwen3 8B', '16k']);
  buttons[1].click();
  expect([...g.document.querySelectorAll('[role=option]')].map((o: any) => o.textContent.trim())).toEqual(['Automático: Qwen3 8B', 'qwen3:8b · 5.2 GB', 'llama3.2:3b · 2.0 GB']);
});

it('sem Ollama ou sem modelo: os passos curtos com o botão de copiar (qwen3:8b, qwen3:4b, llama3.2:3b e o link do Ollama)', () => {
  const t = boot();
  const card = localCard(renderList(status({}, null)));
  const commands = [...card.querySelectorAll('.cmd-line code')].map((c: any) => c.textContent);
  expect(commands).toEqual(['https://ollama.com', 'ollama pull qwen3:8b', 'ollama pull qwen3:4b', 'ollama pull llama3.2:3b']);
  expect(card.querySelectorAll('.cmd-copy')).toHaveLength(4);
  expect(card.textContent).toContain('Nenhum servidor local encontrado');
  expect(card.textContent).toContain('Rice nunca instala nada'.replace('Rice nunca instala nada', 'nada é instalado por conta do Rice'));
  card.querySelectorAll('.cmd-copy')[1].click();
  expect(t.rice.copyText).toHaveBeenCalledWith('ollama pull qwen3:8b');
});

it('salvar o endereço manda ao main (que recusa host não local) e mostra a mensagem de recusa', async () => {
  const t = boot({ setAiLocal: vi.fn(async (i: { url: string }) => (i.url.includes('openai') ? { ok: false, message: 'O Modelo local só aceita endereços do próprio computador' } : { ok: true, local: {} })) });
  const card = localCard(renderList(status()));
  const input = card.querySelector('input.ai-key');
  input.value = 'https://api.openai.com';
  [...card.querySelectorAll('button')].find((b: any) => b.textContent === 'Salvar').click();
  await vi.waitFor(() => expect(card.querySelector('.ai-status-text').textContent).toContain('só aceita endereços do próprio computador'));
  expect(t.rice.setAiLocal).toHaveBeenCalledWith({ url: 'https://api.openai.com', server: 'auto', numCtx: 16384 });
  input.value = '127.0.0.1:1234';
  [...card.querySelectorAll('button')].find((b: any) => b.textContent === 'Salvar').click();
  await vi.waitFor(() => expect(t.rice.setAiLocal).toHaveBeenLastCalledWith({ url: '127.0.0.1:1234', server: 'auto', numCtx: 16384 }));
});

it('Modo 100% local ligado: os outros provedores ficam sem "Usar este"/Testar, com o motivo; o Modelo local segue normal', () => {
  boot();
  const box = renderList(status({ fullyLocal: true, active: 'local-model' }));
  const claude = box.querySelector('.ai-card[data-vendor=claude]') as any;
  expect(claude.textContent).toContain('Modo 100% local: só o provedor Modelo local pode ser usado');
  const use = [...claude.querySelectorAll('button')].find((b: any) => b.textContent === 'Usar este') as any;
  expect(use.disabled).toBe(true);
  expect(use.title).toMatch(/só o provedor Modelo local/);
  const local = localCard(box);
  expect(local.textContent).not.toContain('Modo 100% local: só o provedor');
});

async function openSettings(extra: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  const t = boot({
    getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, checkUpdates: true, ...settings }),
    aiStatus: async () => status({ active: 'local-model' }),
    shortcutStatus: async () => ({ accelerator: null, state: 'none', defaultAccelerator: 'Alt+Command+R' }),
    updateStatus: async () => ({ enabled: true, available: false, fromClone: true }),
    ...extra,
  });
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.set-nav-item')).not.toBeNull());
  [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => b.textContent === 'Privacidade').click();
  return t;
}

it('Privacidade: "Modo 100% local" desligado por padrão, com a explicação em linguagem simples', async () => {
  await openSettings();
  const sw = g.document.getElementById('local-mode');
  expect(sw.checked).toBe(false);
  expect(g.document.querySelector('#set-privacy').textContent).toContain('suas reuniões, transcrições e notas ficam inteiras neste Mac'.replace('suas', 'as suas'));
  expect(g.document.querySelector('#set-privacy').textContent).toContain('o Calendário do macOS continua');
});

it('ligar chama o main; sem o provedor local o main recusa e a tela oferece ir para Inteligência artificial', async () => {
  const t = await openSettings({ setLocalMode: vi.fn(async () => ({ ok: false, needsProvider: true, message: 'Para ligar o Modo 100% local, escolha antes o provedor Modelo local em Configurações › Inteligência artificial.' })) });
  const sw = g.document.getElementById('local-mode');
  sw.checked = true;
  sw.dispatchEvent(new g.window.Event('change'));
  await vi.waitFor(() => expect(t.rice.setLocalMode).toHaveBeenCalledWith(true));
  await vi.waitFor(() => expect(g.document.querySelector('#set-privacy .warn').hidden).toBe(false));
  expect(sw.checked).toBe(false);
  const go = [...g.document.querySelectorAll('#set-privacy button')].find((b: any) => b.textContent === 'Ir para Inteligência artificial') as any;
  expect(go.hidden).toBe(false);
  go.click();
  expect(g.document.querySelector('#set-ai').hidden).toBe(false);
});

it('ligado: o selo "100% local" aparece na barra lateral e some ao desligar (evento do main)', async () => {
  const t = boot({ getSettings: async () => ({ root: '/R', rootDisplay: '~/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, fullyLocal: true }) });
  const badge = g.document.getElementById('local-badge');
  await vi.waitFor(() => expect(badge.hidden).toBe(false));
  expect(badge.textContent).toBe('100% local');
  expect(badge.title).toBe('Modo 100% local: nada sai deste Mac');
  t.handlers['privacy:changed']!({ fullyLocal: false });
  expect(badge.hidden).toBe(true);
});

it('com o modo ligado os controles de rede ficam desabilitados, com o motivo, sem sumir (atualizações, ferramentas)', async () => {
  await openSettings({}, { fullyLocal: true });
  const nav = (name: string) => [...g.document.querySelectorAll('.set-nav-item')].find((b: any) => b.textContent === name).click();
  nav('Atualizações');
  const updates = g.document.getElementById('check-updates');
  expect(updates.disabled).toBe(true);
  expect(updates.title).toBe('Modo 100% local: a verificação de atualizações está desligada.');
  nav('Ferramentas e MCPs');
  expect(g.document.getElementById('chat-tools').disabled).toBe(true);
  await vi.waitFor(() => expect(g.document.querySelector('#set-tools').textContent).toContain('Modo 100% local: ferramentas e MCPs estão desligados.'));
});

it('agenda do Google bloqueada: o botão Conectar fica desabilitado com o motivo', () => {
  boot();
  const nodes = g.window.RiceCalendarConnect.render({ google: { connected: false, blocked: 'Modo 100% local: a agenda do Google está desligada (o Calendário do macOS continua).' }, eventKit: { access: 'granted' }, onChange: vi.fn() });
  const box = g.document.createElement('div');
  box.append(...nodes);
  const connect = [...box.querySelectorAll('button')].find((b: any) => /Conectar/.test(b.textContent) && b.className.includes('primary')) as any;
  expect(connect.disabled).toBe(true);
  expect(connect.title).toContain('Modo 100% local');
});


const pick = (card: any, label: string) => {
  [...card.querySelectorAll('.menu-select-btn')][0].click();
  [...g.document.querySelectorAll('[role=option]')].find((o: any) => o.textContent.trim() === label).click();
};

it('seletor "Servidor": Automático, Ollama, LM Studio, llama.cpp, MLX, Jan e Outro compatível com OpenAI', () => {
  boot();
  const card = localCard(renderList(status()));
  expect(card.querySelector('.ai-field-label').textContent).toBe('Servidor');
  [...card.querySelectorAll('.menu-select-btn')][0].click();
  expect([...g.document.querySelectorAll('[role=option]')].map((o: any) => o.textContent.trim())).toEqual(['Automático (detecta)', 'Ollama', 'LM Studio', 'llama.cpp (llama-server)', 'MLX (mlx_lm.server)', 'Jan', 'Outro (compatível com OpenAI)']);
  expect(card.textContent).toContain('Aceita qualquer servidor local, não só o Ollama.');
  expect(card.textContent).toContain('Ollama :11434, LM Studio :1234, llama.cpp :9931, MLX :8080 e Jan :1337');
});

it('escolher o servidor manda ao main (com o endereço limpo, para valer a porta padrão dele)', async () => {
  const t = boot();
  const card = localCard(renderList(status()));
  pick(card, 'LM Studio');
  await vi.waitFor(() => expect(t.rice.setAiLocal).toHaveBeenCalledWith({ server: 'lmstudio', url: '', numCtx: 16384 }));
});

it('cada servidor tem os seus passos curtos e o comando certo para copiar; o endereço mostra a porta padrão', () => {
  boot();
  const cases: Array<[string, string[], string]> = [
    ['lmstudio', ['https://lmstudio.ai', 'lms server start'], 'http://127.0.0.1:1234'],
    ['llamacpp', ['brew install llama.cpp', 'llama-server -m modelo.gguf --port 9931'], 'http://127.0.0.1:9931'],
    ['mlx', ['pip install mlx-lm', 'mlx_lm.server --model mlx-community/Qwen3-8B-4bit'], 'http://127.0.0.1:8080'],
    ['jan', ['https://jan.ai'], 'http://127.0.0.1:1337'],
    ['ollama', ['https://ollama.com', 'ollama pull qwen3:8b', 'ollama pull qwen3:4b', 'ollama pull llama3.2:3b'], 'http://127.0.0.1:11434'],
  ];
  for (const [server, commands, placeholder] of cases) {
    const card = localCard(renderList(status({}, { ...SERVER, server, serverName: undefined, kind: null, models: [] })));
    expect([...card.querySelectorAll('.cmd-line code')].map((c: any) => c.textContent), server).toEqual(commands);
    expect(card.querySelector('input.ai-key').placeholder, server).toBe(placeholder);
    expect(card.querySelectorAll('.ai-step').length, server).toBeGreaterThanOrEqual(2);
    expect(card.querySelectorAll('.ai-step').length, server).toBeLessThanOrEqual(4);
  }
  const other = localCard(renderList(status({}, { ...SERVER, server: 'other', kind: null, models: [] })));
  expect(other.querySelectorAll('.cmd-line')).toHaveLength(0);
  expect(other.textContent).toContain('Qualquer servidor com /v1/chat/completions em localhost serve');
  expect(other.querySelector('input.ai-key').placeholder).toBe('http://127.0.0.1:PORT');
});

it('detectado: "Encontrado: LM Studio em …"', () => {
  boot();
  const card = localCard(renderList(status({}, { ...SERVER, serverName: 'LM Studio', url: 'http://127.0.0.1:1234' })));
  expect(card.textContent).toContain('Encontrado: LM Studio em http://127.0.0.1:1234');
});

it('"Nome do modelo" opcional para servidores que não listam modelos: digitar manda ao main', async () => {
  const t = boot();
  const card = localCard(renderList(status({}, { ...SERVER, server: 'llamacpp', kind: 'openai', models: [] })));
  const name = [...card.querySelectorAll('input.ai-key')].find((i: any) => i.getAttribute('aria-label') === 'Nome do modelo (opcional)') as any;
  expect(name).toBeDefined();
  expect(card.textContent).toContain('Para servidores que não listam modelos.');
  name.value = 'meu-modelo.gguf';
  name.dispatchEvent(new g.window.Event('change'));
  await vi.waitFor(() => expect(t.rice.setAiModel).toHaveBeenCalledWith('local-model', 'meu-modelo.gguf'));
});
