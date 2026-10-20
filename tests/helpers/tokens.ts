import { readFileSync } from 'node:fs';

type Tok = { css: string; value: string };
const json = JSON.parse(readFileSync('design/tokens.json', 'utf8')) as { tokens: Record<string, Record<string, Tok>> };
const NUMERIC = ['space', 'font', 'radius', 'shadow', 'motion', 'z', 'control', 'icon', 'opacity'];
const values = new Map<string, string>();
for (const group of NUMERIC) for (const t of Object.values(json.tokens[group] ?? {})) values.set(t.css, t.value);

/**
 * Lê uma página do renderer com os tokens NUMÉRICOS (espaço, fonte, raio, sombra, duração, camada, altura, ícone, opacidade) já trocados pelos valores
 * de design/tokens.json: os testes de CSS conferem medidas reais (8px, raio 6px…) sem depender do nome da variável. Cores continuam como var(--…).
 */
export function rendered(path: string): string {
  let text = readFileSync(path, 'utf8');
  for (let i = 0; i < 3; i++) text = text.replace(/var\((--[a-z0-9-]+)\)/g, (m, name) => values.get(name) ?? m);
  text = text.replace(/calc\(-1 \* (\d+(?:\.\d+)?px)\)/g, '-$1'); // margem negativa de compensação: -Npx
  // o DOM de teste não busca arquivo: o <link> vira um <style> com o próprio design/tokens.css (cores e variáveis continuam definidas)
  return text.replace(/<link rel="stylesheet" href="[^"]*tokens\.css">/g, () => `<style>${readFileSync('design/tokens.css', 'utf8')}</style>`);
}

/** Valor de um token (ex.: tokenValue('--space-2') → '8px'). */
export function tokenValue(name: string): string | undefined {
  for (const group of Object.values(json.tokens)) for (const t of Object.values(group)) if (t.css === name) return t.value;
  return undefined;
}

/** Valor escuro de um token de cor (ex.: tokenDark('--field-bg') → 'rgba(255,255,255,.06)'). */
export function tokenDark(name: string): string | undefined {
  for (const group of Object.values(json.tokens)) for (const t of Object.values(group)) if (t.css === name) return (t as Tok & { dark?: string }).dark;
  return undefined;
}
