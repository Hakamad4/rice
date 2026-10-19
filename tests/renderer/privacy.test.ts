// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;

async function open(ai: Record<string, unknown>, lang: 'pt-BR' | 'en' = 'pt-BR') {
  bootRenderer({
    uiLanguage: lang,
    getSettings: async () => ({ root: '/Users/x/Rice', rootDisplay: '~/Rice', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: lang, keepAudio: true, vocabulary: '' }),
    setKeepAudio: vi.fn(),
    aiStatus: async () => ({ models: {}, providers: {}, ...ai }),
  }, []);
  g.document.getElementById('settings-link').click();
  await vi.waitFor(() => expect(g.document.querySelector('.priv-today')).not.toBeNull());
  return g.document.querySelector('.settings-page .priv-list') as any;
}
const titles = (box: any) => [...box.querySelectorAll('.priv-title')].map((n: any) => n.textContent);

it('seção "Privacidade e segurança" no esqueleto de seção, com ícones de linha e as afirmações verificáveis (pt)', async () => {
  const box = await open({ active: 'claude-sub' });
  const section = box.closest('.setting-section');
  expect(section.firstElementChild.tagName).toBe('H2');
  expect(section.querySelector('h2').textContent).toBe('Privacidade e segurança');
  expect(titles(box)).toEqual(['Fica só no seu Mac', 'O que sai, e para onde', 'O áudio nunca sai do seu Mac', 'Google Agenda, só se você conectar', 'Downloads', 'Sem servidores do Rice, sem telemetria', 'A voz nunca é salva', 'Recibo de cada reunião', 'Anexos', 'Capturas de tela, só se você ligar']);
  expect([...box.querySelectorAll('.priv-ico svg')].map((s: any) => s.getAttribute('class'))).toEqual(['icon icon-lock', 'icon icon-arrow-up-right', 'icon icon-mic', 'icon icon-globe', 'icon icon-download', 'icon icon-shield', 'icon icon-mic', 'icon icon-file-text', 'icon icon-paperclip', 'icon icon-image']);
  expect(box.textContent).toContain('Só texto: a transcrição e as suas perguntas');
  expect(box.textContent).toContain('Hoje: Claude (Anthropic).');
  expect(box.querySelector('.priv-note')).toBeNull();
  expect(section.textContent).toContain('não tem servidores nem telemetria');
});

it('o provedor ativo é nomeado dinamicamente', async () => {
  for (const [active, name] of [['chatgpt-sub', 'ChatGPT (OpenAI)'], ['gemini-api', 'Gemini pela API (Google)'], ['opencode-sub', 'OpenCode, no provedor que você escolheu nele']] as const) {
    const box = await open({ active });
    expect(box.querySelector('.priv-today').textContent).toBe(`Hoje: ${name}.`);
  }
});

it('modelo gratuito do OpenCode: aviso de que pode usar as transcrições; modelo pago ou outro provedor: sem aviso', async () => {
  const free = await open({ active: 'opencode-sub', models: { 'opencode-sub': 'opencode/big-pickle' } });
  expect(free.querySelector('.priv-note').textContent).toBe('O modelo gratuito pode usar suas transcrições para melhorar modelos. Prefira sua assinatura para reuniões sensíveis.');
  const paid = await open({ active: 'opencode-sub', models: { 'opencode-sub': 'anthropic/claude-sonnet-4-5' } });
  expect(paid.querySelector('.priv-note')).toBeNull();
  const other = await open({ active: 'claude-sub', models: { 'opencode-sub': 'opencode/big-pickle' } }); // o gratuito salvo mas o ativo é outro
  expect(other.querySelector('.priv-note')).toBeNull();
});

it('em inglês', async () => {
  const box = await open({ active: 'claude-sub' }, 'en');
  expect(box.closest('.setting-section').querySelector('h2').textContent).toBe('Privacy and security');
  expect(titles(box)).toContain('Audio never leaves your Mac');
  expect(box.querySelector('.priv-today').textContent).toBe('Today: Claude (Anthropic).');
});

it('sem frases de exagero e sem HTML: o texto só entra por textContent', () => {
  for (const f of ['pt-BR', 'en']) {
    const text = readFileSync(`src/renderer/locales/${f}.js`, 'utf8');
    const keys = [...text.matchAll(/'(privacy\.[^']+|settings\.privacy[^']*|guide\.privacy2)': '((?:[^'\\]|\\.)*)'/g)].map((m) => m[2]!);
    expect(keys.length).toBeGreaterThan(20);
    for (const v of keys) {
      expect(v, v).not.toMatch(/100\s?%|segurança alta|totalmente seguro|à prova|military|bulletproof|completely secure|high security|100% safe/i);
      expect(v, v).not.toMatch(/<[a-z]/i);
    }
  }
  expect(readFileSync('src/renderer/privacy.js', 'utf8')).not.toMatch(/innerHTML|insertAdjacentHTML/);
});

it('tutorial: passo curto de Privacidade que remete a Configurações', async () => {
  bootRenderer({ getSettings: async () => ({ root: '/R', onboardingDone: true }), aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }), asrStatus: async () => ({ state: 'ready' }), permissionStatus: async () => ({ microphone: 'granted' }), listAiModels: async () => ({ ok: true, models: [] }) }, []);
  const box = g.document.createElement('div');
  await g.window.RiceGuide.render(box, { onClose: () => {} });
  const step = [...box.querySelectorAll('.step')].find((s: any) => s.querySelector('h3').textContent === 'Privacidade') as any;
  expect(step.textContent).toContain('O áudio nunca sai do seu Mac');
  expect(step.textContent).toContain('Configurações > Privacidade e segurança');
  expect(step.classList.contains('info')).toBe(true);
});

it('cartões em 1 coluna (ícone + título na linha, descrição embaixo) e 2 colunas só com o conteúdo ≥ 760px, sem max-width nas descrições; o cartão "O que sai" ocupa as 2 colunas', async () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.priv-item \{[^}]*padding:12px; border-radius:10px; background:var\(--hover\)/);
  expect(css).toMatch(/@container setcontent \(min-width: 760px\) \{ \.priv-list \{ grid-template-columns:1fr 1fr; \} \.priv-item\.wide \{ grid-column:1 \/ -1; \} \}/); // 1 coluna por padrão
  expect(css).toMatch(/\.priv-body \{ display:contents; \} \.priv-title \{ grid-column:2; grid-row:1;/);
  expect(css).toMatch(/\.priv-text, \.priv-today, \.priv-note \{ grid-column:1 \/ -1;/);
  expect(css).not.toMatch(/\.priv-text[^}]*max-width/);
  const box = await open({ active: 'claude-sub' });
  expect(box.querySelectorAll('.priv-item.wide')).toHaveLength(4); // "Fica só no seu Mac", "O que sai", "Anexos" e "Capturas de tela" ocupam a linha toda; os outros quatro formam 2 linhas de 2
  expect([...box.querySelectorAll('.priv-item.wide .priv-title')].map((n: any) => n.textContent)).toEqual(['Fica só no seu Mac', 'O que sai, e para onde', 'Anexos', 'Capturas de tela, só se você ligar']);
});
