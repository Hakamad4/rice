import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, type AiRunner } from '../../src/main/ai/types';
import type { OfflineStatus, OfflineTranslator } from '../../src/main/translate/offline';
import { createStubOfflineTranslator } from '../../src/main/translate/offline';
import { AI_COOLDOWN_MS, MAX_BATCH, MAX_QUEUE, parseBatch, TranslateService, type AiAvailability, type TranslateNotice, type TranslateResult } from '../../src/main/translate/service';
import { readTranslations } from '../../src/main/translate/store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rice-tr-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const seg = (n: number, text = `fala ${n}`) => ({ id: `s${n}`, source: 'Outros' as const, startMs: n * 1000, endMs: n * 1000 + 500, text });
const settle = () => new Promise((r) => setTimeout(r, 15));

function fakeRunner(reply: (prompt: string) => string | Error): { runner: AiRunner; prompts: string[]; egress: unknown[] } {
  const prompts: string[] = [];
  const egress: unknown[] = [];
  return {
    prompts,
    egress,
    runner: {
      // eslint-disable-next-line require-yield
      async *run(o) {
        prompts.push(o.prompt);
        egress.push(o.egress);
        const r = reply(o.prompt);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

function offlineWith(state: OfflineStatus['state'], translate = async (t: string) => `OFF:${t}`, installed: string[] = ['pt', 'en', 'es']) {
  const unload = vi.fn(async () => {});
  const o: OfflineTranslator = { ...createStubOfflineTranslator(), status: () => ({ state, ramBytes: 0, packs: (['pt', 'en', 'es', 'fr', 'de', 'it'] as const).map((lang) => ({ lang, downloadBytes: 1, diskBytes: 1, installed: installed.includes(lang) })) }), translate, unload };
  return { o, unload };
}

function make(opts: { ai?: AiAvailability; offline?: OfflineTranslator; offlineEnabled?: boolean; localMode?: boolean; now?: () => number }) {
  const results: TranslateResult[] = [];
  const notices: TranslateNotice[] = [];
  const svc = new TranslateService({
    ai: async () => opts.ai ?? null,
    offline: opts.offline ?? createStubOfflineTranslator(),
    ...(opts.offlineEnabled === undefined ? {} : { offlineEnabled: opts.offlineEnabled }),
    startedAt: async () => new Date('2026-10-19T10:00:00'),
    onResult: (r) => results.push(r),
    onNotice: (_d, n) => notices.push(n),
    localMode: () => opts.localMode ?? false,
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { svc, results, notices };
}

describe('TranslateService', () => {
  it('desligado: ignora trechos e nada é chamado', async () => {
    const f = fakeRunner(() => 'x');
    const { svc, results } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false } });
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(f.prompts).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  it('traduz trecho final pela IA, marca o egress como translate e persiste', async () => {
    const f = fakeRunner(() => ' "hello" ');
    const { svc, results } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false } });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1, 'olá'));
    await settle();
    expect(results[0]).toMatchObject({ text: 'hello', via: 'ai', lang: 'en' });
    expect(results[0]!.key).toBe('**[10:00:01] Outros:** olá');
    expect(f.egress[0]).toEqual({ kind: 'translate', dir });
    expect(await readTranslations(dir, 'en')).toEqual([{ key: results[0]!.key, lang: 'en', text: 'hello', via: 'ai' }]);
  });

  it('contexto curto: só os últimos trechos anteriores, nunca mais que o limite', async () => {
    const f = fakeRunner(() => 'ok');
    const { svc } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false } });
    svc.start(dir, 'en');
    for (let i = 1; i <= 5; i++) {
      await svc.onSegment(dir, seg(i));
      await settle();
    }
    const last = f.prompts[4]!;
    expect(last).toContain('- fala 2');
    expect(last).toContain('- fala 4');
    expect(last).not.toContain('- fala 1');
  });

  it('fila acumulada vira lote numerado e volta na ordem', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const runner: AiRunner = {
      // eslint-disable-next-line require-yield
      async *run(o) {
        calls.push(o.prompt);
        if (calls.length === 1) await gate;
        const n = (o.prompt.match(/^\d+\. /gm) ?? []).length;
        return n ? Array.from({ length: n }, (_, i) => `${i + 1}. T${i + 1}`).join('\n') : 'T0';
      },
    };
    const { svc, results } = make({ ai: { runner, provider: 'claude-sub', local: false } });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1));
    await svc.onSegment(dir, seg(2));
    await svc.onSegment(dir, seg(3));
    release();
    await settle();
    expect(calls).toHaveLength(2);
    expect(results.map((r) => r.text)).toEqual(['T0', 'T1', 'T2']);
    expect(results.map((r) => r.key.slice(0, 12))).toEqual(['**[10:00:01]', '**[10:00:02]', '**[10:00:03]']);
  });

  it('lote mal formatado: refaz um a um', async () => {
    let first = true;
    const runner: AiRunner = {
      // eslint-disable-next-line require-yield
      async *run(o) {
        if (/^\d+\. /m.test(o.prompt) && first) {
          first = false;
          return 'sem numeros';
        }
        return `S:${o.prompt.split('\n').pop()}`;
      },
    };
    const { svc, results } = make({ ai: { runner, provider: 'claude-sub', local: false } });
    svc.start(dir, 'en');
    // trava o primeiro para acumular
    const gate = new Promise((r) => setTimeout(r, 5));
    await svc.onSegment(dir, seg(1));
    await svc.onSegment(dir, seg(2));
    await gate;
    await settle();
    expect(results.length).toBe(2);
  });

  it('fila limitada descarta os mais antigos', async () => {
    const runner: AiRunner = {
      // eslint-disable-next-line require-yield
      async *run() {
        await new Promise((r) => setTimeout(r, 50));
        return 'x';
      },
    };
    const { svc, results } = make({ ai: { runner, provider: 'claude-api', local: false } });
    svc.start(dir, 'en');
    for (let i = 0; i < MAX_QUEUE + 10; i++) await svc.onSegment(dir, seg(i));
    expect(MAX_BATCH).toBeGreaterThan(1);
    expect(results.length).toBeLessThan(MAX_QUEUE + 10);
  });

  it('idioma baixado: traduz offline e nem chama a IA', async () => {
    const f = fakeRunner(() => 'IA');
    const { o } = offlineWith('installed');
    const { svc, results } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false }, offline: o });
    svc.start(dir, 'en', 'pt');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(results[0]).toMatchObject({ text: 'OFF:fala 1', via: 'offline' });
    expect(f.prompts).toHaveLength(0);
  });

  it('motor offline falhou: a IA assume', async () => {
    const f = fakeRunner(() => 'IA');
    const { o } = offlineWith('installed', async () => {
      throw new Error('sidecar');
    });
    const { svc, results } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false }, offline: o });
    svc.start(dir, 'en', 'pt');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(results[0]).toMatchObject({ text: 'IA', via: 'ai' });
  });

  it('par sem pacote: a IA falhou, avisa uma vez e a quarentena da IA continua', async () => {
    let t = 0;
    const f = fakeRunner(() => new AiError('network', 'sem rede'));
    const { o } = offlineWith('installed', undefined, ['pt', 'en']);
    const { svc, results, notices } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false }, offline: o, now: () => t });
    svc.start(dir, 'es', 'pt'); // falta o pacote es
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(results).toHaveLength(0);
    expect(notices).toEqual(['ai-failed']);
    await svc.onSegment(dir, seg(2));
    await settle();
    expect(f.prompts).toHaveLength(1); // quarentena: não chamou a IA de novo
    t += AI_COOLDOWN_MS + 1;
    await svc.onSegment(dir, seg(3));
    await settle();
    expect(f.prompts).toHaveLength(2);
  });

  it('IA falhou e sem modelo offline: aviso uma vez, nunca lança', async () => {
    const f = fakeRunner(() => new AiError('auth', 'chave'));
    const { svc, results, notices } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false } });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1));
    await svc.onSegment(dir, seg(2));
    await settle();
    expect(results).toHaveLength(0);
    expect(notices).toEqual(['ai-failed']);
  });

  it('sem IA configurada e sem offline: aviso de download', async () => {
    const { svc, notices } = make({});
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(notices).toEqual(['offline-needed']);
  });

  it('offline sem o pacote do idioma de destino: não traduz e avisa', async () => {
    const { o } = offlineWith('installed', undefined, ['pt', 'en']); // falta o es
    const { svc, results, notices } = make({ offline: o });
    svc.start(dir, 'es', 'pt');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(results).toHaveLength(0);
    expect(notices).toEqual(['offline-needed']);
  });

  it('o offline recebe o idioma de origem (from) da reunião', async () => {
    const seen: unknown[] = [];
    const { o } = offlineWith('ready');
    const spy = { ...o, translate: async (t: string, opts: unknown) => (seen.push(opts), `OFF:${t}`) };
    const { svc } = make({ offline: spy });
    svc.start(dir, 'es', 'pt');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(seen[0]).toMatchObject({ from: 'pt', to: 'es' });
  });

  it('sem IA configurada com offline baixado: usa o offline', async () => {
    const { o } = offlineWith('ready');
    const { svc, results } = make({ offline: o });
    svc.start(dir, 'pt', 'en');
    await svc.onSegment(dir, seg(1, 'hello'));
    await settle();
    expect(results[0]).toMatchObject({ text: 'OFF:hello', via: 'offline' });
  });

  it('Modo 100% local: IA de nuvem nunca é chamada; vai para o offline', async () => {
    const f = fakeRunner(() => 'nuvem');
    const { o } = offlineWith('installed');
    const { svc, results } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false }, offline: o, localMode: true });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(f.prompts).toHaveLength(0);
    expect(results[0]!.via).toBe('offline');
  });

  it('Modo 100% local sem motor: aviso próprio e nada sai', async () => {
    const f = fakeRunner(() => 'nuvem');
    const { svc, notices } = make({ ai: { runner: f.runner, provider: 'openai-api', local: false }, localMode: true });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(f.prompts).toHaveLength(0);
    expect(notices).toEqual(['local-mode-no-engine']);
  });

  it('Modo 100% local com IA local: usa a IA local', async () => {
    const f = fakeRunner(() => 'local ok');
    const { svc, results } = make({ ai: { runner: f.runner, provider: 'local-model', local: true }, localMode: true });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(results[0]).toMatchObject({ text: 'local ok', via: 'ai' });
  });

  it('desligar descarrega o offline (custo zero) e trocar o idioma esvazia a fila', async () => {
    const { o, unload } = offlineWith('ready');
    const { svc } = make({ offline: o });
    svc.start(dir, 'en');
    svc.start(dir, 'es');
    expect(svc.language(dir)).toBe('es');
    svc.stop(dir);
    expect(svc.isOn(dir)).toBe(false);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it('trecho vazio é ignorado', async () => {
    const f = fakeRunner(() => 'x');
    const { svc } = make({ ai: { runner: f.runner, provider: 'claude-api', local: false } });
    svc.start(dir, 'en');
    await svc.onSegment(dir, seg(1, '   '));
    await settle();
    expect(f.prompts).toHaveLength(0);
  });
});

describe('parseBatch', () => {
  it('lê linhas numeradas e junta continuações', () => {
    expect(parseBatch('1. um\n2. dois\n  mais', 2)).toEqual(['um', 'dois mais']);
  });
  it('rejeita contagem errada ou lixo', () => {
    expect(parseBatch('1. um', 2)).toBeNull();
    expect(parseBatch('olá\n1. um', 1)).toBeNull();
    expect(parseBatch('2. um', 1)).toBeNull();
  });
});

describe('store', () => {
  it('ignora linhas ruins e a última tradução vence', async () => {
    const { appendTranslation } = await import('../../src/main/translate/store');
    const { writeFile, appendFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'traducao.jsonl'), 'lixo\n{"key":"a","lang":"xx","text":"t"}\n');
    await appendTranslation(dir, { key: 'a', lang: 'en', text: 'one', via: 'ai' });
    await appendTranslation(dir, { key: 'a', lang: 'en', text: 'two', via: 'offline' });
    await appendFile(join(dir, 'traducao.jsonl'), '{"key":"b","lang":"es","text":"x"}\n');
    expect(await readTranslations(dir, 'en')).toEqual([{ key: 'a', lang: 'en', text: 'two', via: 'offline' }]);
    expect((await readTranslations(dir)).length).toBe(2);
    expect(await readTranslations(join(dir, 'nao-existe'))).toEqual([]);
  });

  describe('chave OFFLINE_TRANSLATION desligada', () => {
    const cloud = (f: ReturnType<typeof fakeRunner>): AiAvailability => ({ runner: f.runner, provider: 'claude-api', local: false });

    it('IA responde normalmente', async () => {
      const f = fakeRunner(() => 'ola');
      const { svc, results, notices } = make({ ai: cloud(f), offlineEnabled: false });
      svc.start(dir, 'en', 'pt');
      await svc.onSegment(dir, seg(1));
      await settle();
      expect(results.map((r) => r.via)).toEqual(['ai']);
      expect(notices).toEqual([]);
    });

    it('IA falhou ou sem IA: nunca usa o offline (mesmo instalado) e avisa sem oferecer download', async () => {
      const { o } = offlineWith('installed');
      const translate = vi.spyOn(o, 'translate');
      const f = fakeRunner(() => new AiError('network', 'off'));
      const a = make({ ai: cloud(f), offline: o, offlineEnabled: false });
      a.svc.start(dir, 'en', 'pt');
      await a.svc.onSegment(dir, seg(1));
      await a.svc.onSegment(dir, seg(2));
      await settle();
      expect(a.results).toHaveLength(0);
      expect(a.notices).toEqual(['ai-unavailable']);
      const b = make({ offline: o, offlineEnabled: false });
      b.svc.start(dir, 'en', 'pt');
      await b.svc.onSegment(dir, seg(3));
      await settle();
      expect(b.notices).toEqual(['ai-unavailable']);
      expect(translate).not.toHaveBeenCalled();
    });

    it('Modo 100% local com IA na nuvem: indisponível, a IA nem é chamada', async () => {
      const f = fakeRunner(() => 'x');
      const { svc, results, notices } = make({ ai: cloud(f), offlineEnabled: false, localMode: true });
      svc.start(dir, 'en', 'pt');
      await svc.onSegment(dir, seg(1));
      await settle();
      expect(f.prompts).toHaveLength(0);
      expect(results).toHaveLength(0);
      expect(notices).toEqual(['local-mode-ai-only']);
    });

    it('Modo 100% local com IA local: traduz', async () => {
      const f = fakeRunner(() => 'ola');
      const { svc, results } = make({ ai: { runner: f.runner, provider: 'local-model', local: true }, offlineEnabled: false, localMode: true });
      svc.start(dir, 'en', 'pt');
      await svc.onSegment(dir, seg(1));
      await settle();
      expect(results.map((r) => r.via)).toEqual(['ai']);
    });
  });

  it('chave ligada (padrão do serviço): sem IA e sem modelo oferece o download (offline-needed)', async () => {
    const { svc, notices } = make({ offlineEnabled: true });
    svc.start(dir, 'en', 'pt');
    await svc.onSegment(dir, seg(1));
    await settle();
    expect(notices).toEqual(['offline-needed']);
  });
});
