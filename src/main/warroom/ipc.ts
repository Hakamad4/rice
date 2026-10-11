import type { AiProvider, AiRunner } from '../ai/types';
import { t, type UiLanguage } from '../i18n';
import { checkWorkFolder } from './folder';
import { DEFAULT_IDEA_TEMPLATE_ID, type IdeaTemplate } from './idea-templates';
import { resolveSource } from './source';
import { buildPrompt, buildScript, detectHarnesses, harnessArgs, writeHandoffScript, type HarnessId } from './handoff';
import { DEFAULT_MAX_CYCLES, WarRoomEngine, type Support } from './engine';
import { addIdeaToAnnotations, INTERVALS, MORE_CYCLES, readConfig, readIdeas, writeConfig, writeIdeas, type WarRoomConfig } from './store';

export type WarRoomHost = {
  handle: (channel: string, fn: (e: unknown, ...args: any[]) => unknown) => void;
  send: (channel: string, payload: unknown) => void;
  checkedDir: (dir: unknown) => Promise<string>;
  runner: AiRunner;
  /** Modelo leve do provedor ativo (ideias ao vivo); a investigação e o chat ficam no principal. */
  lightRunner: () => AiRunner;
  provider: () => Promise<AiProvider>;
  language: (dir: string) => Promise<UiLanguage>;
  transcript: (dir: string) => Promise<string>;
  /** Falas ainda não finalizadas da reunião (parciais atuais de cada fonte). */
  partials?: (dir: string) => string[];
  isRecording: (dir: string) => boolean;
  pickFolder: () => Promise<string | null>;
  saveAnnotations: (dir: string, text: string) => Promise<void>;
  /** Pasta do app (userData): lá ficam os scripts temporários do "Continuar no terminal". */
  userData: string;
  /** Abre um arquivo com o app padrão (o .command abre no Terminal); devolve texto de erro ou ''. */
  openPath: (path: string) => Promise<string>;
  /** Limite de ciclos configurado (0 = sem limite). */
  maxCycles?: () => Promise<number>;
  /** CLIs instalados (injetável nos testes). */
  harnesses?: () => ReturnType<typeof detectHarnesses>;
  /** Templates de ideias (embutidos + do usuário, no idioma do app) e o último escolhido (padrão das reuniões novas). */
  ideaTemplates?: () => Promise<{ templates: IdeaTemplate[]; lastId?: string }>;
  rememberIdeaTemplate?: (id: string) => Promise<void>;
  /** Abre uma URL https no navegador e revela um arquivo no Finder. */
  openExternal: (url: string) => Promise<void>;
  reveal: (path: string) => void;
};

export type SourceInfo = { available: boolean; reason?: string };

/** Fontes por provedor: só as assinaturas do Claude e do Codex têm ferramentas com allowlist estrita; os demais ficam indisponíveis. */
export function supportFor(provider: AiProvider): Record<'web' | 'mcp' | 'folder', SourceInfo> {
  if (provider === 'claude-sub') return { web: { available: true }, mcp: { available: true }, folder: { available: true } };
  // Codex: sem pasta (o sandbox não limita a leitura e o shell ficaria ligado)
  if (provider === 'chatgpt-sub') return { web: { available: true }, mcp: { available: true }, folder: { available: false, reason: t('warroom.err.folder-codex') } };
  const reason = t(provider === 'opencode-sub' || provider === 'agy-sub' ? 'chat-tools.unavailable-cli' : 'chat-tools.unavailable-api');
  return { web: { available: false, reason }, mcp: { available: false, reason }, folder: { available: false, reason } };
}

const PROVIDER_NAME: Partial<Record<AiProvider, string>> = {
  'claude-sub': 'Claude',
  'claude-api': 'Claude (API)',
  'chatgpt-sub': 'ChatGPT',
  'openai-api': 'ChatGPT (API)',
  'gemini-api': 'Gemini (API)',
  'opencode-sub': 'OpenCode',
  'agy-sub': 'Antigravity',
};
const SOURCE_KEYS = { web: 'warroom.src.web', mcp: 'warroom.src.mcp', folder: 'warroom.src.folder' } as const;

/** Nota única da aba Investigação sobre as fontes indisponíveis (null: todas disponíveis). Só ela fala do motivo; as linhas mostram a descrição normal. */
export function sourcesNote(provider: AiProvider, s: Record<'web' | 'mcp' | 'folder', SourceInfo>): string | null {
  const name = PROVIDER_NAME[provider] ?? provider;
  const off = (['web', 'mcp', 'folder'] as const).filter((k) => !s[k].available);
  if (off.length === 0) return null;
  if (off.length === 3) return t('warroom.src.note.none', { provider: name });
  return t('warroom.src.note.partial', { provider: name, source: off.map((k) => t(SOURCE_KEYS[k])).join(', '), reason: s[off[0]!]!.reason ?? '' });
}

export function createWarRoom(host: WarRoomHost) {
  const emit = (dir: string) => host.send('warroom:update', { dir });
  const support = async (): Promise<Support> => {
    const s = supportFor(await host.provider());
    return { web: s.web.available, mcp: s.mcp.available, folder: s.folder.available };
  };
  const effectiveIdeaTemplate = async (id: string | undefined): Promise<IdeaTemplate | undefined> => {
    if (!host.ideaTemplates) return undefined;
    const { templates, lastId } = await host.ideaTemplates();
    return templates.find((x) => x.id === (id ?? lastId)) ?? templates.find((x) => x.id === DEFAULT_IDEA_TEMPLATE_ID);
  };
  const engine = new WarRoomEngine({ runner: () => host.runner, lightRunner: host.lightRunner, transcript: host.transcript, ...(host.partials ? { partials: host.partials } : {}), language: host.language, support, emit, maxCycles: host.maxCycles, ...(host.ideaTemplates ? { ideaTemplate: async (id) => (await effectiveIdeaTemplate(id))! } : {}) });

  const view = async (dir: string) => {
    const cfg = await readConfig(dir);
    const provider = await host.provider();
    const support = supportFor(provider);
    const base = host.maxCycles ? await host.maxCycles() : DEFAULT_MAX_CYCLES;
    return {
      dir,
      cfg,
      ideas: (await readIdeas(dir)).filter((i) => !i.dismissed),
      state: engine.state(dir),
      /** Ciclos feitos por trilha e o teto atual (base + liberado para esta reunião; 0 = sem limite). */
      cycles: { ideas: cfg.ideasCycles, investigation: cfg.investigationCycles },
      limit: base > 0 ? base + cfg.extraCycles : 0,
      moreStep: MORE_CYCLES,
      recording: host.isRecording(dir),
      support,
      provider,
      note: sourcesNote(provider, support),
      ideaTemplates: host.ideaTemplates ? (await host.ideaTemplates()).templates : [],
      ideaTemplateId: (await effectiveIdeaTemplate(cfg.ideas.templateId))?.id ?? DEFAULT_IDEA_TEMPLATE_ID,
    };
  };
  const change = async (dir: string, fn: (cfg: WarRoomConfig) => WarRoomConfig | Promise<WarRoomConfig>) => {
    await writeConfig(dir, await fn(await readConfig(dir)));
    if (host.isRecording(dir)) await engine.start(dir); // intervalo ou fontes mudaram: reagenda
    emit(dir);
  };

  const { handle } = host;
  handle('warroom:get', async (_e, rawDir: unknown) => view(await host.checkedDir(rawDir)));
  handle('warroom:set', async (_e, rawDir: unknown, patch: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
    const sup = supportFor(await host.provider());
    let templateId: string | undefined;
    if (typeof p.ideaTemplate === 'string' && host.ideaTemplates && (await host.ideaTemplates()).templates.some((x) => x.id === p.ideaTemplate)) {
      templateId = p.ideaTemplate;
      await host.rememberIdeaTemplate?.(templateId); // o último escolhido vira o padrão das reuniões novas
    }
    await change(dir, (cfg) => ({
      ...cfg,
      ...(p.kind === 'warroom' || p.kind === 'meeting' ? { kind: p.kind } : {}),
      ideas: {
        on: typeof p.ideasOn === 'boolean' ? p.ideasOn : cfg.ideas.on,
        ...((templateId ?? cfg.ideas.templateId) ? { templateId: templateId ?? cfg.ideas.templateId } : {}),
        intervalMin: (INTERVALS as readonly number[]).includes(Number(p.intervalMin)) ? Number(p.intervalMin) : cfg.ideas.intervalMin,
      },
      investigation: {
        intervalMin: (INTERVALS as readonly number[]).includes(Number(p.investigationMin)) ? Number(p.investigationMin) : cfg.investigation.intervalMin,
        paused: typeof p.investigationPaused === 'boolean' ? p.investigationPaused : cfg.investigation.paused,
      },
      extraCycles: p.moreCycles === true ? cfg.extraCycles + MORE_CYCLES : cfg.extraCycles,
      sources: {
        web: typeof p.web === 'boolean' ? p.web && sup.web.available : cfg.sources.web,
        mcp: typeof p.mcp === 'boolean' ? p.mcp && sup.mcp.available : cfg.sources.mcp,
        folder: p.clearFolder === true ? null : cfg.sources.folder,
      },
    }));
    return { ok: true as const };
  });
  handle('warroom:pick-folder', async (_e, rawDir: unknown) => {
    const dir = await host.checkedDir(rawDir);
    if (!supportFor(await host.provider()).folder.available) return { ok: false as const, message: t('chat-tools.unavailable-api') };
    const picked = await host.pickFolder();
    if (!picked) return { ok: true as const, canceled: true as const };
    const checked = await checkWorkFolder(picked);
    if (!checked.ok) return checked;
    await change(dir, (cfg) => ({ ...cfg, sources: { ...cfg.sources, folder: checked.folder } }));
    return { ok: true as const };
  });
  handle('warroom:idea', async (_e, rawDir: unknown, id: unknown, action: unknown, annotations: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const ideas = await readIdeas(dir);
    const idea = ideas.find((i) => i.id === id);
    if (!idea) return { ok: false as const };
    if (action === 'pin') {
      idea.pinned = true;
      const merged = addIdeaToAnnotations(String(annotations ?? ''), idea.text, t('warroom.ideas.heading', undefined, await host.language(dir)));
      await host.saveAnnotations(dir, merged);
      await writeIdeas(dir, ideas);
      emit(dir);
      return { ok: true as const, annotations: merged };
    }
    if (action === 'dismiss') {
      idea.dismissed = true;
      await writeIdeas(dir, ideas);
      emit(dir);
      return { ok: true as const };
    }
    return { ok: false as const };
  });
  handle('warroom:fact', async (_e, rawDir: unknown, id: unknown, action: unknown) => {
    const dir = await host.checkedDir(rawDir);
    if (action !== 'pin' && action !== 'unpin' && action !== 'dismiss' && action !== 'undo') return { ok: false as const };
    await change(dir, (cfg) => ({
      ...cfg,
      facts: cfg.facts.map((f) => {
        if (f.id !== id) return f;
        const { pinned: _p, dismissed: _d, ...rest } = f;
        if (action === 'pin') return { ...rest, pinned: true };
        if (action === 'unpin') return rest;
        if (action === 'dismiss') return { ...rest, dismissed: true };
        return f.pinned ? { ...rest, pinned: true } : rest; // desfazer o descarte
      }),
    }));
    return { ok: true as const };
  });
  // Fonte do achado: URL https abre no navegador; arquivo (caminho ou caminho:linha) só DENTRO da pasta de trabalho, revelado no Finder (nunca executado)
  handle('warroom:open-source', async (_e, rawDir: unknown, factId: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const cfg = await readConfig(dir);
    const fact = cfg.facts.find((f) => f.id === factId);
    if (!fact) return { ok: false as const };
    const target = await resolveSource(fact.source, cfg.sources.folder);
    if (!target) return { ok: false as const, message: t('warroom.err.source') };
    if (target.kind === 'url') await host.openExternal(target.url);
    else host.reveal(target.path);
    return { ok: true as const };
  });
  // "Continuar no terminal": outro harness (CLI do usuário) segue a investigação lendo transcricao.md; o Rice continua gravando
  const harnesses = () => (host.harnesses ? host.harnesses() : detectHarnesses());
  handle('warroom:harnesses', () => harnesses().map(({ id, label }) => ({ id, label })));
  handle('warroom:handoff', async (_e, rawDir: unknown, target: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const harness = target === 'copy' ? null : harnesses().find((h) => h.id === (target as HarnessId));
    if (target !== 'copy' && !harness) return { ok: false as const, message: t('warroom.handoff.err.missing') };
    const cfg = await readConfig(dir);
    // a pasta vem antes de tudo: a já escolhida na reunião ou o seletor (mesmas proibições: ~, /, .ssh…)
    const picked = cfg.sources.folder ?? (await host.pickFolder());
    if (!picked) return { ok: true as const, canceled: true as const };
    const checked = await checkWorkFolder(picked);
    if (!checked.ok) return checked;
    const prompt = buildPrompt({ dir, folder: checked.folder, facts: cfg.facts, language: await host.language(dir) });
    if (!harness) return { ok: true as const, prompt };
    const path = await writeHandoffScript(host.userData, buildScript({ folder: checked.folder, bin: harness.bin, args: harnessArgs(harness.id, prompt) }));
    const error = await host.openPath(path);
    if (error) return { ok: false as const, message: error };
    return { ok: true as const, label: harness.label };
  });
  handle('warroom:stop', async (_e, rawDir: unknown) => {
    engine.abort(await host.checkedDir(rawDir));
    return { ok: true as const };
  });
  handle('warroom:run-now', async (_e, rawDir: unknown, track: unknown) => {
    const dir = await host.checkedDir(rawDir);
    if (!host.isRecording(dir)) return { ok: false as const, message: t('warroom.only-recording') };
    return { ok: true as const, result: await engine.tick(dir, { manual: true, ...(track === 'ideas' || track === 'investigation' ? { track } : {}) }) };
  });

  return {
    engine,
    /** Ligado ao estado da sessão: ciclos só correm enquanto grava. */
    /** Rede de segurança: com a gravação em andamento, garante que a reunião ativa está agendada se as ideias/War room estão ligadas. */
    ensure(dir: string | null): void {
      if (dir && host.isRecording(dir) && !engine.isScheduled(dir)) void engine.start(dir);
    },
    onSessionState(state: string, dir: string | null): void {
      if (!dir) return;
      if (state === 'recording') void engine.start(dir);
      else engine.stop(dir);
    },
  };
}
