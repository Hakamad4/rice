// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const css = rendered('src/renderer/index.html');
const MEETINGS = [{ dir: '/R/a', title: 'Kickoff', startedAt: new Date().toISOString(), state: 'done', notesStatus: 'done' }];

function boot() {
  return bootRenderer({
    consentNotice: vi.fn(async () => ({ show: true, text: 'Aviso' })),
    consentMarkCopied: vi.fn(async () => ({ ok: true })),
    copyText: vi.fn(async () => true),
    copyNotes: vi.fn(async () => ({ ok: true })),
  }, MEETINGS);
}

it('os avisos moram numa pilha fixa na coluna principal; o de consentimento não é mais fixo por conta própria', async () => {
  const t = boot();
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  await g.window.RiceConsent.offer('/R/a');
  const stack = g.document.getElementById('toast-stack');
  expect(stack.parentElement).toBe(g.document.body);
  expect(stack.querySelector('.consent-toast')).not.toBeNull();
  expect(g.document.body.querySelector(':scope > .consent-toast')).toBeNull();
  expect(t.rice.consentNotice).toHaveBeenCalled();
  const rule = /\.consent-toast \{([^}]*)\}/.exec(css)![1]!;
  expect(rule).not.toMatch(/position:\s*fixed/);
});

it('dois avisos ao mesmo tempo (consentimento + "Notas copiadas") se empilham na mesma pilha, sem um cobrir o outro', async () => {
  boot();
  await vi.waitFor(() => expect(g.document.querySelector('.meeting')).not.toBeNull());
  await g.window.RiceConsent.offer('/R/a');
  const copy = g.window.RiceShare.items({ dir: '/R/a', hasNotes: true, isDraft: false }).find((i: any) => /Copiar notas|Copy notes/.test(i.label));
  await copy.onSelect();
  const stack = g.document.getElementById('toast-stack');
  await vi.waitFor(() => expect(stack.children.length).toBe(2));
  expect([...stack.children].map((c: any) => c.className.split(' ')[0]).sort()).toEqual(['consent-toast', 'toast']);
  expect(stack.querySelector('.toast.show')).not.toBeNull();
  expect(/#toast-stack \{[^}]*flex-direction:\s*column-reverse[^}]*gap:\s*8px/.exec(css)).not.toBeNull(); // empilha com respiro
  g.window.RiceConsent.hide();
  expect(stack.querySelector('.consent-toast')).toBeNull();
  expect(stack.querySelector('.toast')).not.toBeNull();
});

it('posição: entre a barra lateral e o painel do chat, acima do rodapé, na largura do conteúdo', () => {
  const stackRule = /\n  #toast-stack \{([^}]*)\}/.exec(css)![1]!;
  expect(stackRule).toMatch(/position:\s*fixed/);
  expect(stackRule).toMatch(/left:\s*var\(--toast-left\)/);
  expect(stackRule).toMatch(/right:\s*var\(--toast-right\)/);
  expect(stackRule).toMatch(/bottom:\s*20px/);
  expect(stackRule).toMatch(/align-items:\s*center/);
  expect(css).toMatch(/#toast-stack > \* \{[^}]*max-width:\s*min\(648px, 100%\)/);
  expect(css).toMatch(/:root \{ --toast-left:var\(--side-w\); --toast-right:0px; \}/);
  expect(css).toMatch(/body\.side-collapsed \{ --toast-left:0px; \}/);
  expect(css).toMatch(/body\.chat-open \{ --toast-right:var\(--chat-w\); \}/);
  // sidebar recolhida sozinha pelo chat (janela média): sem barra lateral, o aviso começa na borda
  expect(css).toMatch(/@media \(max-width: 1000px\) \{ body\.chat-open:not\(\.side-open\) \{ --toast-left:0px; \} \}/);
  // 420 px: chat por cima; o aviso ocupa a largura útil e sobe para não cobrir o campo
  expect(css).toMatch(/@media \(max-width: 760px\) \{ body\.chat-open \{ --toast-left:0px; --toast-right:0px; \} body\.chat-open #toast-stack \{ bottom:100px; \} \}/);
  expect(stackRule).toMatch(/padding:\s*0 16px/); // margens laterais
});

it('o painel do chat nunca é invadido: com o chat aberto a coluna do aviso termina onde o painel começa', () => {
  // as variáveis seguem as MESMAS larguras do grid do corpo
  const grid = /body\.chat-open \{ grid-template-columns:var\(--side-w\) minmax\(0,1fr\) var\(--chat-w\); \}/.test(css);
  expect(grid).toBe(true);
  expect(css).toMatch(/body\.chat-open \{ --toast-right:var\(--chat-w\); \}/);
});
