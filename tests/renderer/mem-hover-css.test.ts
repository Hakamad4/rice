import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/renderer/index.html', 'utf8');
const rule = (sel: string): string => new RegExp(`${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

// o hover do "O que lembrar" tem respiro (padding) e a margem negativa igual mantém o texto no lugar (como as abas Pessoas/Empresas)
it.each([
  ['.mem-toggle', [4, 8]],
  ['.mem-src', [2, 6]],
  ['.mem-who', [2, 6]],
] as const)('%s: padding %j compensado por margem negativa igual, raio 6px e fundo no hover', (sel, [v, h]) => {
  const body = rule(sel);
  expect(body).toContain(`padding:${v}px ${h}px`);
  expect(body).toContain(`margin:-${v}px -${h}px`);
  expect(body).toContain('border-radius:6px');
  expect(css).toMatch(new RegExp(`${sel.replace(/[.]/g, '\\.')}:hover:not\\(:disabled\\) \\{[^}]*background:var\\(--active\\)`));
});
