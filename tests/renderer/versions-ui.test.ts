// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';

const g = globalThis as any;
beforeAll(() => {
  for (const f of ['icons', 'i18n', 'locales/pt-BR', 'locales/en', 'action-menu', 'versions']) new Function(readFileSync(`src/renderer/${f}.js`, 'utf8'))();
});

const now = new Date();
now.setHours(12, 0, 0, 0); // meio-dia de hoje: "agora − 30 min" perto da meia-noite caía em "ontem"
const at = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const versions = [
  { file: 'a.md', templateId: 'geral', templateName: 'Reunião geral', createdAt: at(30) },
  { file: 'b.md', templateId: 'x', templateName: '', createdAt: at(24 * 60 + 30) },
];

it('chip "Versões (N)" com ícone de relógio; o menu lista a atual (✓) e as versões com "hoje HH:MM"', () => {
  const onView = vi.fn();
  const chip = g.window.RiceVersions.chip({ versions, currentTitle: 'Brainstorm', viewing: null, onView, onCurrent: vi.fn() });
  g.document.body.append(chip);
  expect(chip.textContent).toBe('Versões (2)');
  expect(chip.querySelector('svg.icon-history')).not.toBeNull();
  chip.click();
  const items = [...g.document.querySelectorAll('.action-item')] as any[];
  expect(items[0].textContent).toContain('Brainstorm · atual');
  expect(items[0].getAttribute('aria-checked') ?? items[0].textContent).toBeTruthy();
  expect(items[1].textContent).toMatch(/^Reunião geral · hoje \d/);
  expect(items[2].textContent).toMatch(/^Versão anterior · ontem \d/);
  items[1].click();
  expect(onView).toHaveBeenCalledWith(expect.objectContaining({ file: 'a.md' }));
  g.window.RiceActionMenu.close();
});

it('faixa de leitura: "Versão de … · nome" com Voltar para a atual e Restaurar esta', async () => {
  const onBack = vi.fn();
  const onRestore = vi.fn(async () => {});
  const strip = g.window.RiceVersions.strip({ version: versions[0], onBack, onRestore });
  expect(strip.textContent).toMatch(/^Versão de hoje \d{1,2}:\d{2} · Reunião geral/);
  const [back, restore] = [...strip.querySelectorAll('button')] as any[];
  expect([back.textContent, restore.textContent]).toEqual(['Voltar para a atual', 'Restaurar esta']);
  back.click();
  expect(onBack).toHaveBeenCalled();
  restore.click();
  await vi.waitFor(() => expect(onRestore).toHaveBeenCalled());
});

it('em inglês', () => {
  g.window.RiceI18n.setLanguage('en');
  try {
    const chip = g.window.RiceVersions.chip({ versions, currentTitle: 'Brainstorm', viewing: null, onView: vi.fn(), onCurrent: vi.fn() });
    expect(chip.textContent).toBe('Versions (2)');
    const strip = g.window.RiceVersions.strip({ version: versions[0], onBack: vi.fn(), onRestore: vi.fn() });
    expect(strip.textContent).toMatch(/^Version from today /);
    expect(strip.textContent).toContain('Restore this one');
  } finally {
    g.window.RiceI18n.setLanguage('pt-BR');
  }
});
