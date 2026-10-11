// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Planejamento', startedAt: new Date().toISOString(), state: 'done' }];
const tick = () => new Promise((r) => setTimeout(r, 30));

async function setup(ask: (id: number) => Promise<any>) {
  let deltaFn: (id: number, text: string) => void = () => {};
  const cancel = vi.fn();
  bootRenderer({ ask: (id: number) => ask(id), cancel, onDelta: (fn: any) => (deltaFn = fn) }, meetings);
  await tick();
  g.document.querySelector('.meeting').click();
  await tick();
  g.document.getElementById('question').value = 'Qual foi a decisão?';
  g.document.getElementById('ask').requestSubmit();
  await tick();
  return { delta: (id: number, t: string) => deltaFn(id, t), cancel };
}

it('mostra "Pensando…" na hora, vira o primeiro trecho do stream e o botão vira parar', async () => {
  let resolve: (v: any) => void = () => {};
  const { delta, cancel } = await setup(() => new Promise((r) => (resolve = r)));
  const answer = () => g.document.querySelector('#messages .msg.rice .md');
  expect(answer().querySelector('.thinking').textContent).toBe('Pensando…');
  const send = g.document.getElementById('send');
  expect(send.dataset.stop).toBe('1');
  expect(send.disabled).toBe(false);
  delta(1, 'Decidimos');
  expect(answer().querySelector('.thinking')).toBeNull();
  expect(answer().textContent).toBe('Decidimos');
  send.click();
  expect(cancel).toHaveBeenCalled();
  resolve({ ok: false, message: 'cancelado' });
  await tick();
  expect(send.dataset.stop).toBe('');
  expect(answer().textContent).toContain('Resposta interrompida.');
});

it('erro substitui o indicador pela mensagem', async () => {
  await setup(async () => ({ ok: false, message: 'Sem conexão' }));
  const answer = g.document.querySelector('#messages .msg.rice .md');
  expect(answer.querySelector('.thinking')).toBeNull();
  expect(answer.textContent).toBe('Sem conexão');
});
