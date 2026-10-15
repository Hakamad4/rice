import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const GLYPHS = /[⌘⌥⇧⌃]/;

/** Linhas `'chave': 'texto'` dos dicionários (pt-BR e en). */
function entries(file: string): Array<[string, string]> {
  return readFileSync(`src/renderer/locales/${file}.js`, 'utf8').split('\n').flatMap((line): Array<[string, string]> => {
    const m = /^\s*'([^']+)':\s*(.*)$/.exec(line);
    return m ? [[m[1]!, m[2]!]] : [];
  });
}

describe('atalhos no Windows: nenhum texto da tela mostra ⌘ ⌥ ⇧ ⌃', () => {
  for (const file of ['pt-BR', 'en']) {
    it(`${file}: todo texto com símbolos do Mac tem uma variante @win sem eles`, () => {
      const all = entries(file);
      const keys = new Set(all.map(([k]) => k));
      const missing = all.filter(([k, v]) => !k.includes('@') && GLYPHS.test(v) && !keys.has(`${k}@win`)).map(([k]) => k);
      expect(missing).toEqual([]);
      const leaking = all.filter(([k, v]) => k.endsWith('@win') && GLYPHS.test(v)).map(([k]) => k);
      expect(leaking).toEqual([]);
    });
  }

  it('as dicas montadas no código usam RiceKeys (⌘ no Mac, Ctrl no Windows); nenhuma tecla do Mac fixa em textContent/title', () => {
    for (const file of ['home', 'renderer', 'screenshots', 'shortcut-field', 'chat-panel', 'settings']) {
      let text = '';
      try {
        text = readFileSync(`src/renderer/${file}.js`, 'utf8');
      } catch {
        continue;
      }
      const bad = text.split('\n').filter((l) => GLYPHS.test(l) && /(textContent|title|placeholder)\s*[:=]\s*['"`][^'"`]*[⌘⌥⇧⌃]/.test(l));
      expect(bad, file).toEqual([]);
    }
  });
});
