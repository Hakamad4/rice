import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest } from '../../src/main/translate/manifest';
import { OpusOfflineTranslator } from '../../src/main/translate/opus-engine';
import { offlineReady } from '../../src/main/translate/offline';
import { setLocalMode } from '../../src/main/privacy/local-mode';

const FAKE = resolve(__dirname, '../fixtures/fake-rice-translate.mjs');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const BODY = (id: string) => `conteudo-de-${id}`;
const file = (id: string, name = 'model.bin') => ({ name, sha256: sha(`${BODY(id)}/${name}`), bytes: Buffer.byteLength(`${BODY(id)}/${name}`) });

/** pt<->en e es<->en em modelos próprios; en->es multilíngue compartilhado com en->pt (o tag escolhe o destino). */
const manifest: Manifest = {
  version: 1,
  baseUrl: 'http://127.0.0.1:0',
  models: ['pt-en', 'en-romance', 'es-en'].map((id) => ({ id, files: [file(id), file(id, 'source.spm')] })),
  routes: {
    'pt>en': [{ model: 'pt-en' }],
    'en>pt': [{ model: 'en-romance', tag: '>>por<<' }],
    'en>es': [{ model: 'en-romance', tag: '>>spa<<' }],
    'es>en': [{ model: 'es-en' }],
    'pt>es': [{ model: 'pt-en' }, { model: 'en-romance', tag: '>>spa<<' }],
  },
  packs: { en: [], pt: ['pt-en', 'en-romance'], es: ['es-en', 'en-romance'], fr: ['absent'], de: ['absent'], it: ['absent'] },
};

let root: string;
let engine: OpusOfflineTranslator;
const fetchOk = async (spec: { name: string; sha256?: string }, dir: string, o: { onProgress?: (p: { receivedBytes: number; totalBytes: number }) => void }) => {
  const id = basename(dir);
  const body = `${BODY(id)}/${spec.name}`;
  o.onProgress?.({ receivedBytes: Buffer.byteLength(body), totalBytes: Buffer.byteLength(body) });
  await writeFile(join(dir, spec.name), body);
  return join(dir, spec.name);
};
const make = (fetchModel = fetchOk) => new OpusOfflineTranslator({ manifest, root, binary: process.execPath, sidecarArgs: [FAKE], idleMs: 60_000, fetchModel });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rice-opus-'));
  setLocalMode(false);
  engine = make();
});
afterEach(async () => {
  await engine.unload();
  setLocalMode(false);
  rmSync(root, { recursive: true, force: true });
});

describe('OpusOfflineTranslator', () => {
  it('começa sem nada instalado, com o tamanho de cada pacote conhecido antes de baixar', () => {
    const s = engine.status();
    expect(s.state).toBe('not-installed');
    expect(s.ramBytes).toBe(0);
    const pt = s.packs.find((p) => p.lang === 'pt')!;
    expect(pt.installed).toBe(false);
    expect(pt.downloadBytes).toBe(pt.diskBytes);
    expect(pt.downloadBytes).toBeGreaterThan(0);
    // o inglês é só o pivô: sem modelo próprio, nada a baixar
    expect(s.packs.find((p) => p.lang === 'en')).toMatchObject({ diskBytes: 0, downloadBytes: 0, installed: false });
  });

  it('baixa por idioma, soma o progresso e marca instalado; o que já está em disco é pulado', async () => {
    const seen: number[] = [];
    await engine.download(['pt'], (p) => seen.push(p.receivedBytes));
    expect(seen.at(-1)).toBe(engine.status().packs.find((p) => p.lang === 'pt')!.diskBytes);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    const s = engine.status();
    expect(s.state).toBe('installed');
    expect(s.packs.filter((p) => p.installed).map((p) => p.lang).sort()).toEqual(['en', 'pt']); // o inglês (pivô) vale como instalado com qualquer idioma
    // es compartilha en-romance: só falta es-en
    const es = s.packs.find((p) => p.lang === 'es')!;
    expect(es.installed).toBe(false);
    expect(es.downloadBytes).toBe(file('es-en').bytes + file('es-en', 'source.spm').bytes);
    expect(offlineReady(s, 'pt', 'en')).toBe(true);
  });

  it('traduz pelo inglês quando o par não tem rota direta, na ordem dos passos', async () => {
    await engine.download(['pt', 'es']);
    expect(await engine.translate('olá', { from: 'pt', to: 'en' })).toBe('pt-en(olá)');
    expect(await engine.translate('olá', { from: 'pt', to: 'es' })).toBe('>>spa<<en-romance(pt-en(olá))');
    expect(await engine.translate('igual', { from: 'pt', to: 'pt' })).toBe('igual');
    expect(engine.status().state).toBe('ready');
    expect(engine.status().ramBytes).toBeGreaterThan(0);
  });

  it('sem o pacote, rejeita sem subir o processo (RAM zero)', async () => {
    await expect(engine.translate('olá', { from: 'pt', to: 'en' })).rejects.toThrow('offline-translator-missing-pack');
    await expect(engine.load()).rejects.toThrow('offline-translator-not-installed');
    expect(engine.status().state).toBe('not-installed');
  });

  it('unload solta a RAM, mantém os pacotes e o próximo pedido volta a funcionar', async () => {
    await engine.download(['pt']);
    await engine.translate('a', { from: 'pt', to: 'en' });
    await engine.unload();
    expect(engine.status()).toMatchObject({ state: 'installed', ramBytes: 0 });
    expect(await engine.translate('b', { from: 'pt', to: 'en' })).toBe('pt-en(b)');
  });

  it('cancelar o download rejeita com AbortError e não deixa o modelo parcial como instalado', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (spec: { name: string }, dir: string, o: { signal?: AbortSignal }) => {
      await gate;
      if (o.signal?.aborted) throw new Error('aborted');
      return fetchOk(spec as never, dir, {});
    };
    engine = make(slow as never);
    const p = engine.download(['pt']);
    expect(engine.status().state).toBe('downloading');
    engine.cancelDownload();
    release();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.status().state).toBe('not-installed');
    expect(engine.status().packs.some((x) => x.installed)).toBe(false);
  });

  it('apagar um idioma mantém os modelos que outro idioma instalado ainda usa', async () => {
    await engine.download(['pt', 'es']);
    await engine.delete(['pt']);
    expect(existsSync(join(root, 'pt-en'))).toBe(false);
    expect(existsSync(join(root, 'en-romance'))).toBe(true); // o es ainda precisa
    expect(engine.status().packs.find((p) => p.lang === 'es')!.installed).toBe(true);
    await engine.delete(['es']);
    expect(existsSync(join(root, 'en-romance'))).toBe(false);
    expect(engine.status().state).toBe('not-installed');
  });

  it('um modelo reinstalado de uma sessão anterior é reconhecido no disco ao criar o motor', async () => {
    await engine.download(['pt']);
    const again = make();
    expect(again.status().packs.find((p) => p.lang === 'pt')!.installed).toBe(true);
    await again.unload();
  });

  it('Modo 100% local bloqueia o download (a rede do motor é só o download)', async () => {
    setLocalMode(true);
    await expect(engine.download(['pt'])).rejects.toMatchObject({ name: 'LocalModeError' });
    expect(engine.status().state).toBe('not-installed');
    // com o pacote já em disco, traduzir segue funcionando no Modo 100% local
    setLocalMode(false);
    await engine.download(['pt']);
    setLocalMode(true);
    expect(await engine.translate('x', { from: 'pt', to: 'en' })).toBe('pt-en(x)');
  });

  it('binário que não sobe vira estado de erro com mensagem amigável', async () => {
    await engine.download(['pt']);
    const broken = new OpusOfflineTranslator({ manifest, root, binary: '/nao/existe', fetchModel: fetchOk });
    await expect(broken.load()).rejects.toThrow();
    expect(broken.status().state).toBe('error');
    expect(broken.status().error).toBeTruthy();
  });
});

describe('download real (ensureModel) contra um servidor local', () => {
  let server: Server;
  let base = '';
  let corrupt = false;
  beforeEach(async () => {
    server = createServer((req, res) => {
      const m = /^\/([^.]+)\.(.+)$/.exec(req.url ?? '');
      const body = m ? `${BODY(m[1]!)}/${m[2]}` : '';
      res.writeHead(200, { 'content-length': String(Buffer.byteLength(body)) });
      res.end(corrupt ? body.toUpperCase() : body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(() => server.close());

  it('confere o SHA-256 de cada arquivo e instala', async () => {
    corrupt = false;
    const real = new OpusOfflineTranslator({ manifest: { ...manifest, baseUrl: base }, root, binary: process.execPath, sidecarArgs: [FAKE] });
    await real.download(['es']);
    expect(real.status().packs.find((p) => p.lang === 'es')!.installed).toBe(true);
    expect(await real.translate('hola', { from: 'es', to: 'en' })).toBe('es-en(hola)');
    await real.unload();
  });

  it('arquivo adulterado falha pelo hash e nada fica instalado', async () => {
    corrupt = true;
    const real = new OpusOfflineTranslator({ manifest: { ...manifest, baseUrl: base }, root, binary: process.execPath, sidecarArgs: [FAKE] });
    await expect(real.download(['es'])).rejects.toThrow(/SHA-256/);
    expect(real.status().packs.some((p) => p.installed)).toBe(false);
    expect(existsSync(join(root, 'es-en', '.complete'))).toBe(false);
  });
});
