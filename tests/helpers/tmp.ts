import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rice-test-'));
  created.push(dir);
  return dir;
}
