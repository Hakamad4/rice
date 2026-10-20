import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { titleBarOverlay } from '../../src/main/platform/system';
import { tokenDark, tokenValue } from '../helpers/tokens';

const PAGES = ['index.html', 'alert.html', 'nub.html'];
const read = (f: string) => readFileSync(`src/renderer/${f}`, 'utf8');
const tokensCss = readFileSync('design/tokens.css', 'utf8');

/** Marcas de terceiros (logos dos provedores de IA): identidade deles, fora da escala do Rice (DESIGN.md, "Ícones"). */
const BRAND_LINE = /\.logo-(claude|gemini|opencode)\b/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

describe('design/tokens.css é a única fonte de cor', () => {
  for (const page of PAGES) {
    test(`${page}: sem cor hex/rgb/hsl escrita direto (só var(--token)); exceção: marcas de provedores`, () => {
      const offenders = read(page)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => COLOR_LITERAL.test(line) && !BRAND_LINE.test(line))
        .map(({ line, n }) => `${page}:${n}: ${line.trim().slice(0, 110)}`);
      expect(offenders).toEqual([]);
    });

    test(`${page}: importa design/tokens.css`, () => {
      expect(read(page)).toContain('<link rel="stylesheet" href="../../design/tokens.css">');
    });
  }

  test('scripts do renderer (fora dos dicionários de texto): sem cor escrita direto', () => {
    const offenders: string[] = [];
    for (const f of readdirSync('src/renderer').filter((x) => x.endsWith('.js'))) {
      read(f).split('\n').forEach((line, i) => {
        if (COLOR_LITERAL.test(line.replace(/\/\/.*$/, ''))) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('as marcas de provedores continuam só nas linhas .logo-*', () => {
    const lines = read('index.html').split('\n').filter((l) => COLOR_LITERAL.test(l.replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(BRAND_LINE);
  });
});

describe('variáveis', () => {
  test('toda var(--x) usada nas páginas e nos scripts existe (tokens.css ou declarada na própria página)', () => {
    const files = [...PAGES.map((p) => `src/renderer/${p}`), ...readdirSync('src/renderer').filter((x) => x.endsWith('.js')).map((x) => `src/renderer/${x}`)];
    const sources = [tokensCss, ...files.map((f) => readFileSync(f, 'utf8'))].join('\n');
    const declared = new Set([...sources.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/var\((--[a-z0-9-]+)\)/g)) used.add(m[1]!); // com valor reserva (var(--x, 92px)) pode não existir
    const undefinedVars = [...used].filter((v) => !declared.has(v));
    expect(undefinedVars).toEqual([]);
  });

  test('a escala compacta --gap-* e o --bad não voltaram (fundidos em --space-* e --danger)', () => {
    for (const page of PAGES) expect(read(page)).not.toMatch(/--gap-\d|var\(--bad\)/);
    expect(tokensCss).not.toMatch(/--gap-\d|--bad:/);
  });

  test('tokens.json e tokens.css têm os mesmos valores', () => {
    const json = JSON.parse(readFileSync('design/tokens.json', 'utf8')) as { tokens: Record<string, Record<string, { css: string; value: string; dark?: string }>> };
    const light = tokensCss.split('@media')[0]!;
    const darkBlock = tokensCss.split(':root[data-theme="dark"] {')[1]!.split('}')[0]!;
    for (const group of Object.values(json.tokens)) {
      for (const t of Object.values(group)) {
        expect(light, t.css).toContain(`${t.css}: ${t.value};`);
        if (t.dark !== undefined) expect(darkBlock, t.css).toContain(`${t.css}: ${t.dark};`);
      }
    }
  });

  test('o app só tem um erro (--danger) e ele tem valor no escuro', () => {
    expect(tokenValue('--danger')).toBe('#d6453f');
    expect(tokenDark('--danger')).toBe('#ff7a73');
  });

  test('chave ligada mantém o verde do sistema (--switch-on), separado de --ok', () => {
    expect([tokenValue('--switch-on'), tokenDark('--switch-on')]).toEqual(['#34C759', '#30D158']);
    expect(tokenValue('--ok')).toBe('#2e9e5b');
  });
});

describe('janela do Windows', () => {
  test('a faixa dos botões usa o mesmo fundo do app (--bg, claro e escuro)', () => {
    expect(titleBarOverlay(false).color).toBe(tokenValue('--bg'));
    expect(titleBarOverlay(true).color).toBe(tokenDark('--bg'));
  });
});

describe('contraste do texto (WCAG AA)', () => {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c: number[]) => 0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
  /** '#rrggbb' ou 'rgba(r,g,b,a)' sobre um fundo opaco → [r,g,b] */
  const flat = (css: string, under: number[]): number[] => {
    if (css.startsWith('#')) return [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
    const [r = 0, g = 0, b = 0, a = 1] = css.match(/[\d.]+/g)!.map(Number);
    return [r, g, b].map((c, i) => c * a + (under[i] ?? 0) * (1 - a));
  };
  const ratio = (fg: number[], bg: number[]) => { const [a, b] = [lum(fg), lum(bg)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const pairs = (text: string) => {
    const out: Array<[string, number]> = [];
    for (const dark of [false, true]) {
      for (const surface of ['--bg', '--sidebar']) {
        const bg = flat((dark ? tokenDark(surface) : undefined) ?? tokenValue(surface)!, [0, 0, 0]);
        const fg = flat((dark ? tokenDark(text) : undefined) ?? tokenValue(text)!, bg);
        out.push([`${text} sobre ${surface} (${dark ? 'escuro' : 'claro'})`, ratio(fg, bg)]);
      }
    }
    return out;
  };

  for (const text of ['--ink', '--muted', '--translation']) {
    for (const [name, r] of pairs(text)) test(`${name} >= 4,5:1`, () => expect(r).toBeGreaterThanOrEqual(4.5));
  }
});

describe('fonte mono', () => {
  test('cobre macOS e Windows (Consolas antes de monospace) e o app não repete a pilha à mão', () => {
    expect(tokenValue('--font-mono')).toMatch(/SF Mono.*SFMono-Regular.*Consolas, monospace$/);
    expect(read('index.html')).not.toMatch(/font-family:\s*ui-monospace/);
  });
});
