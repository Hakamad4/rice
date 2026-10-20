import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig, readIdeas, writeIdeas } from '../../src/main/warroom/store';

describe('warroom store: gravações seguidas do mesmo arquivo', () => {
  it('várias writeConfig ao mesmo tempo não falham e a última fica no disco', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rice-test-'));
    try {
      const base = await readConfig(dir);
      const writes = Array.from({ length: 20 }, (_, i) => writeConfig(dir, { ...base, ideasCycles: i }));
      await expect(Promise.all(writes)).resolves.toBeDefined();
      expect((await readConfig(dir)).ideasCycles).toBe(19);
      expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writeIdeas em paralelo guarda a última lista', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rice-test-'));
    try {
      const lists = Array.from({ length: 10 }, (_, i) => [{ id: `i${i}`, at: '2026-10-18T00:00:00Z', kind: 'idea' as const, text: `ideia ${i}` }]);
      await Promise.all(lists.map((l) => writeIdeas(dir, l)));
      expect((await readIdeas(dir)).map((i) => i.id)).toEqual(['i9']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
