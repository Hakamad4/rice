// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const tick = () => new Promise((r) => setTimeout(r, 60));
const current = () => g.document.querySelector('.set-nav-item[aria-current="true"]')?.textContent.trim();
const visibleSection = () => [...g.document.querySelectorAll('.set-content > .setting-section')].find((s: any) => !s.hidden)?.dataset.section;

it('Início sem nenhuma agenda: o botão do cartão "Conecte sua agenda" abre Configurações na seção Agenda', async () => {
  bootRenderer({ googleStatus: async () => ({ connected: false, hasClient: false }), eventKitStatus: async () => ({ access: 'denied' }), calendarEvents: async () => [] }, []);
  await vi.waitFor(() => expect(g.document.querySelector('.connect-card')).not.toBeNull());
  g.document.querySelector('.connect-card button').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page')).not.toBeNull());
  await tick();
  expect(visibleSection()).toBe('calendar');
  expect(current()).toBe('Agenda');
});

it('Início: o aviso de IA ("Configurar") abre Configurações na seção Inteligência artificial', async () => {
  bootRenderer({ aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }) }, []);
  await vi.waitFor(() => expect(g.document.querySelector('.ai-notice button')).not.toBeNull());
  g.document.querySelector('.ai-notice button').click();
  await vi.waitFor(() => expect(g.document.querySelector('.settings-page')).not.toBeNull());
  await tick();
  expect(visibleSection()).toBe('ai');
  expect(current()).toBe('Inteligência artificial');
});
