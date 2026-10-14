import { readdir } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { OnlineSpeakerClusterer } from '../../src/main/asr/speaker-cluster';
import { ClusteringIdentifier } from '../../src/main/asr/speaker-identifier';
import type { SpeakerEmbedder } from '../../src/main/asr/speaker-embedder';
import { makeTmpDir } from '../helpers/tmp';

const seconds = (n: number, who = 0) => Buffer.from(new Int16Array(16_000 * n).fill(who + 1).buffer);
/** Embedder falso: a "voz" é o valor das amostras (1, 2, 3...). */
class FakeEmbedder implements SpeakerEmbedder {
  calls = 0;
  closed = false;
  fail = false;
  async embed(pcm: Buffer) {
    this.calls++;
    if (this.fail) throw new Error('boom');
    const who = pcm.readInt16LE(0) - 1;
    return [0, 1, 2, 3].map((i) => (i === who ? 1 : 0.01));
  }
  async close() { this.closed = true; }
}

test('trechos de quem fala viram Pessoa 1, 2... e voltam ao mesmo número', async () => {
  const id = new ClusteringIdentifier(new FakeEmbedder(), new OnlineSpeakerClusterer());
  const out = [];
  for (const who of [0, 1, 0, 2, 1]) out.push(await id.identify(seconds(3, who)));
  expect(out).toEqual([1, 2, 1, 3, 2]);
});

test('trecho curto demais não gasta embedding: herda o último', async () => {
  const embedder = new FakeEmbedder();
  const id = new ClusteringIdentifier(embedder, new OnlineSpeakerClusterer());
  await id.identify(seconds(3, 1));
  expect(await id.identify(seconds(0.2, 0))).toBe(1);
  expect(embedder.calls).toBe(1);
});

test('falha do embedder vira null; depois de 3 falhas seguidas desiste sem insistir', async () => {
  const embedder = new FakeEmbedder();
  const id = new ClusteringIdentifier(embedder, new OnlineSpeakerClusterer());
  embedder.fail = true;
  expect([await id.identify(seconds(2)), await id.identify(seconds(2)), await id.identify(seconds(2))]).toEqual([null, null, null]);
  embedder.fail = false;
  expect(await id.identify(seconds(2))).toBeNull();
  expect(embedder.calls).toBe(3);
});

test('close fecha o embedder e NÃO grava nada: ao retomar, os grupos recomeçam do zero', async () => {
  const dir = await makeTmpDir();
  const embedder = new FakeEmbedder();
  const a = new ClusteringIdentifier(embedder, new OnlineSpeakerClusterer());
  await a.identify(seconds(3, 0));
  await a.identify(seconds(3, 1));
  await a.close();
  expect(embedder.closed).toBe(true);
  expect(await readdir(dir)).toEqual([]);
  const resumed = new ClusteringIdentifier(new FakeEmbedder(), new OnlineSpeakerClusterer());
  expect(await resumed.identify(seconds(3, 1))).toBe(1); // sem memória da sessão anterior
});
