import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

const g = globalThis as any;

/** Sobe o renderer inteiro (index.html + os scripts na ordem em que o HTML os carrega) com uma API `rice` de mentira. */
export function bootRenderer(overrides: Record<string, unknown> = {}, meetings: any[] = []): { rice: any; handlers: Record<string, (p: any) => any> } {
  const handlers: Record<string, (p: any) => any> = {};
  const rice: any = {
    uiLanguage: 'pt-BR',
    getSettings: async () => ({ root: '/R', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true, rootDisplay: '~/Rice' }),
    listMeetings: async () => meetings,
    listFolders: async () => [],
    readMeeting: async (dir: string) => {
      const m = meetings.find((x) => x.dir === dir) ?? meetings[0];
      return { meta: { notesStatus: 'done', ...m }, transcript: '', annotations: '', notes: '', chat: [] };
    },
    listTemplates: async () => ({ templates: [], defaultId: null, warnings: [] }),
    sessionState: async () => ({ state: 'idle', dir: null }),
    recoveredCount: async () => 0,
    calendarEvents: async () => [],
    googleStatus: async () => ({ connected: true }),
    aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: { 'claude-sub': { connected: true, hasKey: true, detail: 'Conectado.' } } }),
    onDelta: () => {},
    on: (channel: string, fn: (p: any) => any) => (handlers[channel] = fn),
    ...overrides,
  };
  g.window.rice = rice;
  g.localStorage.clear();
  const html = readFileSync('src/renderer/index.html', 'utf8');
  g.document.documentElement.innerHTML = html.replace(/<script[^>]*><\/script>/g, '').replace(/^[\s\S]*?<html[^>]*>/, '');
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) new Function(readFileSync(`src/renderer/${m[1]}`, 'utf8'))();
  return { rice, handlers };
}

export const flush = () => vi.waitFor(() => undefined);
export const press = (el: any, key: string, init: Record<string, unknown> = {}) =>
  el.dispatchEvent(new g.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
export const type = (input: any, value: string) => {
  input.value = value;
  input.dispatchEvent(new g.window.Event('input', { bubbles: true }));
};
