// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';

const g = globalThis as any;
const meetings = [{ dir: '/R/a', title: 'Planejamento', startedAt: new Date().toISOString(), state: 'done' }];
const tick = () => new Promise((r) => setTimeout(r, 40));
const items = [
  { file: 'briefing.md', name: 'briefing.md', size: 2048, type: 'text/markdown', kind: 'text', addedAt: new Date().toISOString(), hasText: true },
  { file: 'foto.png', name: 'foto.png', size: 900_000, type: 'image/png', kind: 'image', addedAt: new Date().toISOString() },
];

async function setup(list = items, supported = false) {
  const attachFiles = vi.fn(async (_dir: string, files: any[]) => files.map(() => ({ ok: true })));
  const attachData = vi.fn(async (_d: string, name: string) => ({ ok: true, item: { name, file: name } }));
  const attachPick = vi.fn(async () => []);
  const attachRemove = vi.fn(async () => ({ ok: true }));
  const { handlers } = bootRenderer({
    saveAnnotations: async () => ({ ok: true }),
    attachList: async () => ({ items: list, images: { supported, provider: 'claude-sub' } }),
    attachThumb: async () => 'data:image/png;base64,AAAA',
    attachFiles, attachData, attachPick, attachRemove,
    hasFilePath: (f: any) => Boolean(f.path),
  }, meetings);
  await tick();
  g.document.querySelector('.meeting').click();
  await tick();
  await tick();
  return { attachFiles, attachData, attachPick, attachRemove, handlers };
}
const block = () => g.document.querySelector('.attach-block') as any;

it('bloco Anexos na aba Notas, abaixo das Anotações: cartões, miniatura local e aviso de imagens nos CLIs', async () => {
  await setup();
  const text = block().textContent;
  expect(text).toContain('briefing.md');
  expect(text).toContain('2 KB');
  expect(block().querySelectorAll('.attach-card')).toHaveLength(2);
  expect(block().querySelector('.attach-thumb img').src).toContain('data:image/png');
  expect(text).toContain('as imagens ficam só no Mac');
  const headings = [...g.document.querySelectorAll('.mt-body h2')].map((h: any) => h.textContent.toLowerCase());
  expect(headings.indexOf('anexos')).toBeGreaterThan(headings.indexOf('anotações'));
});

it('em API as imagens seguem: sem aviso; vazio mostra a dica; botão Anexar chama o diálogo nativo', async () => {
  const { attachPick } = await setup([], true);
  expect(block().textContent).toContain('Arraste arquivos');
  expect(block().textContent).not.toContain('não são enviadas');
  [...block().querySelectorAll('button')].find((b: any) => b.textContent.includes('Anexar arquivo')).click();
  await tick();
  expect(attachPick).toHaveBeenCalledWith('/R/a');
});

it('arrastar arquivos para a página manda os caminhos ao main; colar imagem nas anotações manda os bytes', async () => {
  const { attachFiles, attachData } = await setup([]);
  const file = Object.assign(new g.window.File(['x'], 'plano.txt'), { path: '/Users/x/plano.txt' });
  const drop = new g.window.Event('drop', { bubbles: true, cancelable: true });
  Object.assign(drop, { dataTransfer: { types: ['Files'], files: [file] } });
  g.document.dispatchEvent(drop);
  await tick();
  expect(attachFiles).toHaveBeenCalledWith('/R/a', [file]); // o caminho só é resolvido no preload
  const img = new g.window.File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
  const paste = new g.window.Event('paste', { bubbles: true, cancelable: true });
  Object.assign(paste, { clipboardData: { files: [img] } });
  g.document.querySelector('.anot-empty, .anot-read').click(); // a caixa de edição nasce ao clicar nas anotações
  g.document.querySelector('.mt-body textarea').dispatchEvent(paste);
  await tick();
  expect(paste.defaultPrevented).toBe(true);
  expect(attachData).toHaveBeenCalledWith('/R/a', expect.stringMatching(/^Imagem colada .*\.png$/), expect.anything());
  expect(g.document.querySelector('.mt-body textarea').value).toMatch(/\[Imagem anexada: Imagem colada .*\.png\]/); // referência discreta nas anotações
});

it('anexo adicionado gravando aparece na transcrição como marcador com ícone de linha', async () => {
  bootRenderer({ readMeeting: async () => ({ meta: { ...meetings[0], notesStatus: 'done' }, transcript: '**[10:00:01] Outros:** oi\n*[Anexo: tabela.csv]*\n', annotations: '', notes: '', chat: [] }), attachList: async () => ({ items: [], images: { supported: true, provider: '' } }) }, meetings);
  await tick();
  g.document.querySelector('.meeting').click();
  await tick();
  [...g.document.querySelectorAll('.mt-tab')].find((b: any) => b.textContent.startsWith('Transcrição')).click();
  const row = g.document.querySelector('.t-attach');
  expect(row.textContent).toBe('Anexo: tabela.csv');
  expect(row.querySelector('svg.icon-paperclip')).not.toBeNull();
});
