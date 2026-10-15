import { describe, expect, it } from 'vitest';
import { notificationOptions } from '../../src/main/app/notification-options';

const base = { title: 'Gravar “Planejamento”?', actionText: 'Gravar', secondaryText: 'Não perguntar para Zoom', clickHint: 'Clique para gravar.' };

describe('notificationOptions', () => {
  it('Mac: botões de ação (principal e silenciar o app), sem corpo', () => {
    expect(notificationOptions({ ...base, windows: false })).toEqual({ title: base.title, actions: [{ type: 'button', text: 'Gravar' }, { type: 'button', text: 'Não perguntar para Zoom' }] });
    expect(notificationOptions({ ...base, windows: false, secondaryText: undefined }).actions).toHaveLength(1);
  });

  it('Windows: o Electron não tem botões de ação no toast, então vira título + "Clique para…" e o clique faz a ação principal', () => {
    const o = notificationOptions({ ...base, windows: true });
    expect(o).toEqual({ title: base.title, body: 'Clique para gravar.' });
    expect(o.actions).toBeUndefined();
  });
});
