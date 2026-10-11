import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { ensureModel, type DownloadProgress } from '../../src/main/asr/model-download';
import { makeTmpDir } from '../helpers/tmp';

const content = Buffer.from('modelo-falso-'.repeat(10_000));
const sha = createHash('sha256').update(content).digest('hex');
let server: Server;
let requests: string[] = [];

afterEach(() => new Promise<void>((r) => server?.close(() => r())));

async function startHub(advertisedSha: string | null = sha, getStatus = 200, truncateBody = false): Promise<string> {
  requests = [];
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url === '/model.bin') {
      const headers: Record<string, string> = { location: '/blob', 'x-linked-size': String(content.length) };
      if (advertisedSha) headers['x-linked-etag'] = `"${advertisedSha}"`;
      return res.writeHead(302, headers).end();
    }
    if (req.url === '/blob') {
      if (getStatus !== 200) return res.writeHead(getStatus).end('not found');
      if (truncateBody) {
        res.writeHead(200, { 'content-length': String(content.length) });
        res.write(content.subarray(0, Math.floor(content.length / 2)));
        return res.socket?.destroy();
      }
      return res.writeHead(200, { 'content-length': String(content.length) }).end(content);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/model.bin`;
}

test('baixa, verifica SHA-256 e grava o sidecar', async () => {
  const url = await startHub();
  const dir = await makeTmpDir();
  const progress: DownloadProgress[] = [];
  const path = await ensureModel({ name: 'model.bin', url }, dir, { onProgress: (p) => progress.push(p) });
  expect(path).toBe(join(dir, 'model.bin'));
  expect(await readFile(path)).toEqual(content);
  expect((await readFile(`${path}.sha256`, 'utf8')).trim()).toBe(`${sha} ${content.length}`);
  expect(progress.at(-1)).toEqual({ receivedBytes: content.length, totalBytes: content.length });
  expect((await readdir(dir)).sort()).toEqual(['model.bin', 'model.bin.sha256']);
});

test('segunda chamada não acessa a rede (funciona offline)', async () => {
  const url = await startHub();
  const dir = await makeTmpDir();
  await ensureModel({ name: 'model.bin', url }, dir);
  server.close();
  const before = requests.length;
  await expect(ensureModel({ name: 'model.bin', url: 'http://127.0.0.1:1/offline' }, dir)).resolves.toBe(join(dir, 'model.bin'));
  expect(requests.length).toBe(before);
});

test('SHA divergente rejeita e não deixa arquivo nem .part', async () => {
  const url = await startHub('0'.repeat(64));
  const dir = await makeTmpDir();
  await expect(ensureModel({ name: 'model.bin', url }, dir)).rejects.toThrow('SHA-256');
  expect(await readdir(dir)).toEqual([]);
});

test('sem SHA anunciado rejeita antes de baixar', async () => {
  const url = await startHub(null);
  const dir = await makeTmpDir();
  await expect(ensureModel({ name: 'model.bin', url }, dir)).rejects.toThrow('SHA-256');
  expect(requests).toEqual(['HEAD /model.bin']);
});

test('sem rede e sem modelo local rejeita com mensagem clara', async () => {
  const dir = await makeTmpDir();
  await expect(ensureModel({ name: 'model.bin', url: 'http://127.0.0.1:1/x' }, dir)).rejects.toThrow('baixar o modelo');
});

test('socket interrompido remove o arquivo parcial', async () => {
  const url = await startHub(sha, 200, true);
  const dir = await makeTmpDir();
  await expect(ensureModel({ name: 'model.bin', url }, dir)).rejects.toThrow();
  expect(await readdir(dir)).toEqual([]);
});

test('abort após progresso rejeita com AbortError e remove o parcial', async () => {
  const url = await startHub();
  const dir = await makeTmpDir();
  const controller = new AbortController();
  await expect(ensureModel({ name: 'model.bin', url }, dir, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(await readdir(dir)).toEqual([]);
});

test('sidecar novo com tamanho incorreto baixa novamente', async () => {
  const url = await startHub();
  const dir = await makeTmpDir();
  const path = join(dir, 'model.bin');
  await writeFile(path, 'wrong-size');
  await writeFile(`${path}.sha256`, `${sha} ${content.length + 1}\n`);
  await ensureModel({ name: 'model.bin', url }, dir);
  expect(requests).toContain('GET /model.bin');
  expect(await readFile(path)).toEqual(content);
});

test('sidecar antigo com hash correto migra offline', async () => {
  const url = await startHub();
  const dir = await makeTmpDir();
  const path = join(dir, 'model.bin');
  await writeFile(path, content);
  await writeFile(`${path}.sha256`, `${sha}\n`);
  server.close();
  const before = requests.length;
  await expect(ensureModel({ name: 'model.bin', url: 'http://127.0.0.1:1/offline' }, dir)).resolves.toBe(path);
  expect(requests.length).toBe(before);
  expect((await readFile(`${path}.sha256`, 'utf8')).trim()).toBe(`${sha} ${content.length}`);
});

test('GET 404 rejeita com status HTTP', async () => {
  const url = await startHub(sha, 404);
  const dir = await makeTmpDir();
  await expect(ensureModel({ name: 'model.bin', url }, dir)).rejects.toThrow('HTTP 404');
  expect(await readdir(dir)).toEqual([]);
});

test('o modelo padrão é o q5_0; RICE_WHISPER_MODEL escolhe outra variante e valores inválidos caem no padrão', async () => {
  const { whisperModelFor } = await import('../../src/main/asr/model-download');
  expect(whisperModelFor(undefined).name).toBe('ggml-large-v3-turbo-q5_0.bin');
  expect(whisperModelFor('f16').name).toBe('ggml-large-v3-turbo.bin');
  expect(whisperModelFor('q8_0').url).toMatch(/ggml-large-v3-turbo-q8_0\.bin$/);
  expect(whisperModelFor('toString').name).toBe('ggml-large-v3-turbo-q5_0.bin');
});

test('SHA-256 fixo no spec (releases do GitHub, sem hash nos cabeçalhos): baixa sem HEAD e confere', async () => {
  const url = await startHub(null);
  const dir = await makeTmpDir();
  const path = await ensureModel({ name: 'model.bin', url, sha256: sha, bytes: content.length }, dir);
  expect(await readFile(path)).toEqual(content);
  expect(requests.some((r) => r.startsWith('HEAD'))).toBe(false);
});

test('SHA-256 fixo diferente do arquivo recebido: rejeita e não deixa o modelo no disco', async () => {
  const url = await startHub(null);
  const dir = await makeTmpDir();
  await expect(ensureModel({ name: 'model.bin', url, sha256: 'a'.repeat(64) }, dir)).rejects.toThrow(/SHA-256 do modelo não confere/);
  expect(await readdir(dir)).toEqual([]);
});

test('modelos padrão (whisper q5_0 e o de vozes) têm SHA-256 fixo no código, em minúsculas e com 64 dígitos', async () => {
  const { WHISPER_MODELS, SPEAKER_MODEL, whisperModelFor } = await import('../../src/main/asr/model-download');
  for (const spec of [WHISPER_MODELS.q5_0, SPEAKER_MODEL]) {
    expect(spec.sha256, spec.name).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.bytes, spec.name).toBeGreaterThan(1_000_000);
    expect(spec.url.startsWith('https://'), spec.name).toBe(true);
  }
  expect(whisperModelFor(undefined)).toBe(WHISPER_MODELS.q5_0);
});
