import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const READMES = ['README.md', 'README.pt-BR.md'] as [string, string];
const read = (f: string) => readFileSync(f, 'utf8');

describe('documentação', () => {
  it.each(READMES)('%s: todo link de imagem ou arquivo local existe', (file) => {
    const links = [...read(file).matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1] as string).filter((l) => !/^(https?:|#|mailto:)/.test(l));
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) expect(existsSync(join(dirname(file), link)), `${file} → ${link}`).toBe(true);
  });

  it('os dois READMEs têm as mesmas seções e as mesmas imagens (por nome de arquivo)', () => {
    const count = (f: string, re: RegExp) => [...read(f).matchAll(re)].length;
    expect(count(READMES[0], /^## /gm)).toBe(count(READMES[1], /^## /gm));
    expect(count(READMES[0], /^### /gm)).toBe(count(READMES[1], /^### /gm));
    const imgs = (f: string) => [...read(f).matchAll(/!\[[^\]]*\]\(docs\/images\/[^/]+\/([^)]+)\)/g)].map((m) => m[1] as string);
    expect(imgs(READMES[1])).toEqual(imgs(READMES[0]));
  });

  it('cada imagem existe nos dois idiomas e tem menos de 300 KB', () => {
    for (const dir of ['en', 'pt-BR']) {
      for (const m of read('README.md').matchAll(/docs\/images\/en\/([^)]+)/g)) {
        const path = join('docs/images', dir, m[1] as string);
        expect(existsSync(path), path).toBe(true);
        expect(readFileSync(path).length, path).toBeLessThan(300 * 1024);
      }
    }
  });

  it('LICENSE é MIT e o package.json concorda', () => {
    expect(read('LICENSE')).toMatch(/^MIT License/);
    expect(JSON.parse(read('package.json')).license).toBe('MIT');
  });
});
