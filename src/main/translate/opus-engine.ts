import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureModel, type ModelSpec } from '../asr/model-download';
import { isLocalMode, LocalModeError } from '../privacy/local-mode';
import { t } from '../i18n';
import { assetUrl, modelBytes, routeKey, type Manifest, type ModelEntry } from './manifest';
import { TRANSLATE_LANGS, type DownloadProgress, type OfflinePack, type OfflineState, type OfflineStatus, type OfflineTranslateOptions, type OfflineTranslator, type TranslateLang } from './offline';
import { TranslateSidecar } from './sidecar';

const DONE_FILE = '.complete';
/** Medido no M4: o modelo base (~80 MB) ocupa ~180 MB de RSS e o tc-big (~230 MB) ~400 MB; 1,9x o arquivo cobre os dois. */
const RAM_FACTOR = 1.9;

export type OpusEngineOptions = {
  manifest: Manifest;
  /** Pasta onde cada modelo vira uma subpasta (`<root>/<modelo>/`). */
  root: string;
  /** Binário `rice-translate`. */
  binary: string;
  sidecarArgs?: readonly string[];
  idleMs?: number;
  /** Troca o download (testes); o padrão é `ensureModel` (SHA-256, `.part`, Modo 100% local). */
  fetchModel?: (spec: ModelSpec, dir: string, options: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal }) => Promise<string>;
};

export class OpusOfflineTranslator implements OfflineTranslator {
  private readonly models = new Map<string, ModelEntry>();
  private readonly installed = new Set<string>();
  private readonly loaded = new Map<string, number>(); // modelo → bytes na RAM, na ordem de uso
  private readonly sidecar: TranslateSidecar;
  private downloading: { controller: AbortController; progress: DownloadProgress } | null = null;
  private state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private error: string | undefined;

  constructor(private readonly options: OpusEngineOptions) {
    for (const m of options.manifest.models) this.models.set(m.id, m);
    this.scanDisk();
    this.sidecar = new TranslateSidecar({ binary: options.binary, args: options.sidecarArgs, idleMs: options.idleMs });
  }

  private dir(id: string): string {
    return join(this.options.root, id);
  }

  private scanDisk(): void {
    this.installed.clear();
    if (!existsSync(this.options.root)) return;
    for (const name of readdirSync(this.options.root)) {
      if (this.models.has(name) && existsSync(join(this.dir(name), DONE_FILE))) this.installed.add(name);
    }
  }

  private packModels(lang: TranslateLang): ModelEntry[] {
    return (this.options.manifest.packs[lang] ?? []).map((id) => this.models.get(id)).filter((m): m is ModelEntry => m !== undefined);
  }

  /** O inglês é só o pivô: não tem modelo próprio (`packs.en` vazio) e vale como instalado quando qualquer outro idioma está. */
  private packInstalled(lang: TranslateLang): boolean {
    const models = this.options.manifest.packs[lang] ?? [];
    if (models.length === 0) return lang === 'en' && this.installed.size > 0;
    return models.every((id) => this.installed.has(id));
  }

  status(): OfflineStatus {
    const packs: OfflinePack[] = TRANSLATE_LANGS.map((lang) => {
      const models = this.packModels(lang);
      const missing = models.filter((m) => !this.installed.has(m.id));
      return {
        lang,
        downloadBytes: missing.reduce((n, m) => n + modelBytes(m), 0),
        diskBytes: models.reduce((n, m) => n + modelBytes(m), 0),
        installed: this.packInstalled(lang),
      };
    });
    const ramBytes = [...this.loaded.values()].reduce((n, b) => n + b, 0);
    let state: OfflineState;
    if (this.downloading) state = 'downloading';
    else if (this.state === 'error') state = 'error';
    else if (this.state === 'loading') state = 'loading';
    else if (this.state === 'ready' && this.sidecar.running) state = 'ready';
    else state = this.installed.size > 0 ? 'installed' : 'not-installed';
    return {
      state,
      packs,
      ramBytes: this.sidecar.running ? ramBytes : 0,
      ...(this.downloading ? { progress: this.downloading.progress } : {}),
      ...(this.state === 'error' && this.error ? { error: this.error } : {}),
    };
  }

  async load(): Promise<void> {
    if (this.downloading) throw new Error('offline-translator-downloading');
    if (this.installed.size === 0) throw new Error('offline-translator-not-installed');
    if (this.state === 'ready' && this.sidecar.running) return;
    this.state = 'loading';
    try {
      await this.sidecar.ensureRunning();
      this.state = 'ready';
      this.error = undefined;
    } catch (err) {
      this.state = 'error';
      this.error = t('translate.offline.failed');
      throw err;
    }
  }

  async translate(text: string, options: OfflineTranslateOptions): Promise<string> {
    const { from, to, signal } = options;
    if (from === to) return text;
    if (signal?.aborted) throw abortError();
    const steps = this.options.manifest.routes[routeKey(from, to)];
    if (!steps || !steps.every((s) => this.installed.has(s.model))) throw new Error('offline-translator-missing-pack');
    if (this.state !== 'ready') await this.load();
    let out = text;
    try {
      for (const step of steps) {
        out = await this.sidecar.translate(this.dir(step.model), out, step.tag ?? '', signal);
        this.markLoaded(step.model);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.loaded.clear();
        this.state = 'idle';
      }
      throw err;
    }
    return out;
  }

  private markLoaded(id: string): void {
    const model = this.models.get(id);
    if (!model) return;
    this.loaded.delete(id);
    this.loaded.set(id, Math.round(modelBytes(model) * RAM_FACTOR));
    while (this.loaded.size > 2) this.loaded.delete(this.loaded.keys().next().value as string);
  }

  async unload(): Promise<void> {
    await this.sidecar.stop();
    this.loaded.clear();
    if (this.state !== 'error') this.state = 'idle';
  }

  async download(langs: readonly TranslateLang[], onProgress?: (p: DownloadProgress) => void): Promise<void> {
    if (this.downloading) throw new Error('offline-translator-downloading');
    if (isLocalMode()) throw new LocalModeError(t('local.mode.blocked-feature', { feature: t('translate.offline.title') }));
    const wanted = new Map<string, ModelEntry>();
    for (const lang of new Set<TranslateLang>(langs)) for (const m of this.packModels(lang)) if (!this.installed.has(m.id)) wanted.set(m.id, m);
    if (wanted.size === 0) return;
    const totalBytes = [...wanted.values()].reduce((n, m) => n + modelBytes(m), 0);
    const controller = new AbortController();
    const state = { controller, progress: { receivedBytes: 0, totalBytes } };
    this.downloading = state;
    const fetchModel = this.options.fetchModel ?? ensureModel;
    let done = 0;
    try {
      for (const model of wanted.values()) {
        const dir = this.dir(model.id);
        await mkdir(dir, { recursive: true });
        for (const file of model.files) {
          const spec: ModelSpec = { name: file.name, url: assetUrl(this.options.manifest, model.id, file.name), sha256: file.sha256, bytes: file.bytes };
          await fetchModel(spec, dir, {
            signal: controller.signal,
            onProgress: (p) => {
              state.progress = { receivedBytes: done + p.receivedBytes, totalBytes };
              onProgress?.(state.progress);
            },
          });
          done += file.bytes;
          state.progress = { receivedBytes: done, totalBytes };
        }
        await writeFile(join(dir, DONE_FILE), `${JSON.stringify({ id: model.id, files: model.files.map((f) => f.sha256) })}\n`);
        this.installed.add(model.id);
      }
      onProgress?.({ receivedBytes: totalBytes, totalBytes });
    } catch (err) {
      if (controller.signal.aborted) throw abortError();
      throw err;
    } finally {
      this.downloading = null;
    }
  }

  cancelDownload(): void {
    this.downloading?.controller.abort();
  }

  async delete(langs: readonly TranslateLang[]): Promise<void> {
    await this.unload();
    const removing = new Set<TranslateLang>(langs);
    const keep = new Set<string>();
    for (const lang of TRANSLATE_LANGS) if (!removing.has(lang) && this.packInstalled(lang)) for (const id of this.options.manifest.packs[lang] ?? []) keep.add(id);
    for (const lang of removing) {
      for (const id of this.options.manifest.packs[lang] ?? []) {
        if (keep.has(id)) continue;
        await rm(this.dir(id), { recursive: true, force: true });
        this.installed.delete(id);
      }
    }
    if (this.state === 'error') this.state = 'idle';
  }

  /** Para os testes e para a tela de créditos: lê o que está marcado como completo no disco. */
  async installedModels(): Promise<string[]> {
    const out: string[] = [];
    for (const id of this.installed) {
      try {
        await readFile(join(this.dir(id), DONE_FILE), 'utf8');
        out.push(id);
      } catch {
        /* sumiu */
      }
    }
    return out;
  }
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
