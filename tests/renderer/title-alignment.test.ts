// @vitest-environment happy-dom
// Alinhamento à esquerda: o título estático e o primeiro bloco da página começam na mesma borda do conteúdo (±1px).
// Mede a soma de margem + padding + borda entre o elemento e a coluna da página (happy-dom não faz layout, então usa o CSS computado).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bootRenderer } from '../helpers/boot-renderer';
import { rendered } from '../helpers/tokens';

const g = globalThis as any;
const doc = g.document;
const px = (v: string) => parseFloat(v) || 0;

const css = [...rendered('src/renderer/index.html').matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
beforeAll(() => {
  const style = doc.createElement('style');
  style.textContent = `${css}\n:root { --title-size: 20px; }`; // happy-dom não resolve clamp(…cqi)
  doc.head.append(style);
});

/** Distância (x) do texto até a borda esquerda da coluna `.page`: soma margem, padding e borda de cada caixa no caminho. */
function textLeft(node: any): number {
  let x = 0;
  for (let cur = node; cur && !cur.classList?.contains('page'); cur = cur.parentElement) {
    const s = g.getComputedStyle(cur);
    x += px(s.marginLeft) + px(s.paddingLeft) + px(s.borderLeftWidth);
  }
  return x;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const mountPage = () => {
  const detail = doc.createElement('div');
  detail.id = 'detail';
  const box = doc.createElement('div');
  box.className = 'page';
  detail.append(box);
  doc.body.append(detail);
  return { detail, box };
};

describe('título e primeira aba/bloco na mesma borda esquerda', () => {
  it('Templates: título estático e a primeira aba (Notas) começam no mesmo x', async () => {
    doc.body.innerHTML = '';
    for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'template-preview', 'template-picker', 'templates']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
    g.window.rice = {
      listTemplates: vi.fn(async () => ({ templates: [], defaultId: null, warnings: [] })),
    };
    const { box } = mountPage();
    await g.window.RiceTemplates.render(box, { confirm: vi.fn(), onError: vi.fn(), tab: 'notes' });
    await flush();
    const title = box.querySelector('h1.page-title.static') as any;
    const firstTab = box.querySelector('.mt-tab') as any;
    expect(title.textContent).toBe('Templates');
    expect(Math.abs(textLeft(title) - textLeft(firstTab))).toBeLessThanOrEqual(1);
    expect(textLeft(title)).toBe(0);
  });

  it('Templates: "Novo template de notas" é botão ghost de 32px com ícone plus, centrado no título (linha 1 do grid)', async () => {
    doc.body.innerHTML = '';
    const { box } = mountPage();
    await g.window.RiceTemplates.render(box, { confirm: vi.fn(), onError: vi.fn(), tab: 'notes' });
    await flush();
    const add = box.querySelector('.tpl-new') as any;
    expect(add.className).toBe('btn ghost tpl-new');
    expect(add.querySelector('svg.icon-plus')).not.toBeNull();
    expect(add.textContent).toBe('Novo template de notas');
    expect(g.getComputedStyle(add).height).toBe('32px');
    expect(box.querySelector('.tpl-head-grid').contains(add)).toBe(true);
  });

  it('Configurações: título estático e o bloco da página começam no mesmo x; o título fica a 24px das seções', async () => {
    doc.body.innerHTML = '';
    bootRenderer({
      getSettings: async () => ({ root: '/R', rootDisplay: '~/Rice', onboardingDone: true, transcriptionLanguage: 'pt', uiLanguage: 'pt-BR', keepAudio: true }),
      aiStatus: async () => ({ active: 'claude-sub', models: {}, providers: {} }),
    }, []);
    await flush();
    g.document.getElementById('settings-link').click();
    await vi.waitFor(() => expect(doc.querySelector('.settings-page .set-layout')).not.toBeNull());
    const page = doc.querySelector('.settings-page') as any;
    const title = page.querySelector('h1.page-title.static') as any;
    const layout = page.querySelector('.set-layout') as any;
    expect(Math.abs(textLeft(title) - textLeft(layout))).toBeLessThanOrEqual(1);
    expect(g.getComputedStyle(title).marginBottom).toBe('24px');
  });
});

it('botão "Novo template…": ícone + e texto NA MESMA linha (inline-flex), sem quebrar', () => {
  const css = rendered('src/renderer/index.html');
  expect(css).toMatch(/\.tpl-new \{ display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; \}/);
});
