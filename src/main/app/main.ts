import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, session as electronSession, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, screen, shell, systemPreferences, Tray } from 'electron';
import { CalendarFeed } from '../calendar/calendar-feed';
import { fromEventKit } from '../calendar/google-events';
import { GoogleAuth } from '../calendar/google-auth';
import { buildChatPrompt, chatSystemPrompt } from '../claude/prompts';
import { modelCatalog } from '../ai/catalog';
import { cachedAgyModels } from '../ai/agy-cli';
import { createActiveRunner, createLightRunner, lightModelFor, isModelFor, resolveAiSettings, type AiSettings, type RunnerDeps } from '../ai/factory';
import { clearSecret, loadSecret, migrateLegacyToken, saveSecret, validateKey, type TokenCrypto } from '../ai/secrets';
import { aiStatus, invalidateAiStatus, listModels, testProvider } from '../ai/service';
import { AiError, hasKeyField, isProvider, type AiRunner } from '../ai/types';
import { isTranscriptionLanguage, type MeetingMeta, type NoteTemplateInput, type TranscriptionLanguage } from '../../shared/types';
import { canDeleteMeeting, deleteMeetingDir } from './delete-meeting';
import { AsrService } from '../session/asr-service';
import { AudioCapture } from '../session/audio-capture';
import { DetectorClient } from '../session/detector-client';
import { MeetingSession, type SessionState } from '../session/meeting-session';
import { listVersions, readVersion, restoreVersion } from '../store/notes-versions';
import { generateNotes, regenerateNotes, type LanguageResolver, type TemplateResolver } from '../session/notes';
import { logError, logWarn } from '../log';
import { tightenAppData } from '../store/permissions';
import { probeClaudeMcpServers } from '../claude/runner';
import { registerAttachments } from '../attachments/ipc';
import { attachmentImages, attachmentsContext } from '../attachments/store';
import { createWarRoom } from '../warroom/ipc';
import { planGeminiMigration } from '../ai/migrate';
import { deleteIdeaTemplate, listIdeaTemplates, localizeIdeaTemplate, restoreBuiltinIdeaTemplate, saveIdeaTemplate } from '../warroom/idea-templates';
import { contextFacts, readConfig as readWarRoomConfig, writeConfig as writeWarRoomConfig } from '../warroom/store';
import { discardEmptyDraft, findEmptyDraft, reuseDraft } from '../store/drafts';
import { normalizeMaxCycles } from '../warroom/engine';
import { checkWorkFolder } from '../warroom/folder';
import { runChat } from '../ai/chat-run';
import { guardedIpc, lockdownWebContents } from './hardening';
import { decideMeetingEnd } from '../session/stop-policy';
import { endKey, shouldOfferRecording, shouldPromptEnd, shouldPromptStart, titleFor } from '../session/prompt-policy';
import { recoverInterrupted } from '../session/recovery';
import { damagedEntry, readMetaIfUsable, repairMeta } from '../store/meta-repair';
import { recoverMeeting } from '../session/recover-meeting';
import { alertPosition, AlertScheduler, ALERT_HEIGHT, ALERT_WIDTH, isHttpsUrl } from './meeting-alert';
import { type AlertPlan } from '../calendar/google-events';
import { LevelThrottle, NubController, NUB_BAR_WIDTH, NUB_HEIGHT, type Point } from './nub';
import { findAppIcon, findTrayIcons, findWinIcon } from './app-icon';
import { isMac, isWindows, remindersSupported, systemCalendarSupported } from '../platform';
import { systemPanelUrl, titleBarOverlay } from '../platform/system';
import { fromSystemLocale, locale, setLanguage, t, type UiLanguage } from '../i18n';
import { copyNotes, draftEmail, exportInfo, exportPdf, openMail, type ShareDeps } from '../share/actions';
import { uniquePath } from '../share/pdf';
import { createNubIpc, lastTranscriptLines } from './nub-ipc';
import { parseStartInput } from './start-input';
import { SearchIndex } from '../search/index';
import { handleSearch } from '../search/handler';
import { askAcrossMeetings } from '../search/global-chat';
import { readGlobalConversation, startNewGlobalConversation } from '../store/global-chat';
import { createFolder, deleteFolder, folderExists, folderPaths, moveFolder, readFolders, renameFolder, reorderFolders, setMeetingFolder } from '../store/folders';
import { localizeTemplate } from '../templates/builtin';
import { deleteTemplate, getTemplate, listTemplates, resolveTemplate, restoreBuiltinTemplate, saveTemplate } from '../templates/store';
import { agyBinary, claudeBinary, codexBinary, opencodeBinary, isInsideRoot, tildify, riceAudioBinary, riceDetectorBinary } from './paths';
import {
  appendChat,
  createMeeting,
  listMeetingDirs,
  readChat,
  readMeetingText,
  readMeta,
  renameMeeting,
  updateMeta,
  setSpeakerName,
} from '../store/meeting-files';
import { modelsDir } from '../asr/config';
import { ensureModel, SPEAKER_MODEL } from '../asr/model-download';
import { OnlineSpeakerClusterer } from '../asr/speaker-cluster';
import { OnnxSpeakerEmbedder } from '../asr/speaker-embedder';
import { ClusteringIdentifier, loadClusterState, saveClusterState, type SpeakerIdentifier } from '../asr/speaker-identifier';
import { mergeVocabulary, parseVocabulary, whisperVocabularyPrompt } from '../asr/vocabulary';
import { applySpeakerNames, cleanSpeakerName } from '../../shared/speakers';
import { suggestSpeakerNames } from '../session/speaker-names';
import { chatTranscript } from '../session/chat-context';
import { configureLongNotes, type NotesProgress } from '../session/long-notes';
import type { AlertActionKind } from '../session/alerts';
import { saveAnnotations } from '../store/annotations';

type Settings = { /** Última pasta onde um PDF foi salvo (padrão: Downloads). */ exportDir?: string; ai?: unknown; transcriptionLanguage?: TranscriptionLanguage; uiLanguage?: UiLanguage; root: string; keepAudio?: boolean; calendarAsked?: boolean; onboardingDone?: boolean; nubPosition?: Point; defaultTemplateId?: string; vocabulary?: string; vocabularyAttendees?: boolean; /** Acima disso (em caracteres) as notas usam extração por partes; padrão 60000. */ notesDirectMaxChars?: number; /** Beta: separa "Outros" em Pessoa 1, 2… (modelo de voz local de 27 MB, baixado na primeira vez). */ identifySpeakers?: boolean; /** Opt-in "por sua conta e risco": ferramentas MCP só no chat (desligado por padrão). */ chatTools?: boolean; /** Último template de ideias escolhido (padrão das reuniões novas). */ lastIdeaTemplate?: string; /** Avisos de uma vez só na tela de IA (ex.: o Gemini por assinatura foi descontinuado). */ aiNotices?: { geminiSub?: boolean }; /** Limite de ciclos de cada trilha da War room por reunião (0 = sem limite; padrão 120). */ warroomMaxCycles?: number; /** Minutos sem fala até o "ainda gravando?" (padrão 15; 0 desliga). */ inactivityMinutes?: number; /** Apps para os quais o usuário disse "não perguntar mais". */ mutedApps?: string[]; /** Mostrar os lembretes de hoje no Início (padrão: ligado, se o macOS permitir). */ showReminders?: boolean };

const tokenCrypto: TokenCrypto = {
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(data),
};
const googleAuth = new GoogleAuth({
  dir: app.getPath('userData'),
  crypto: tokenCrypto,
  fetch: (url, init) => fetch(url, init),
  openExternal: (url) => shell.openExternal(url),
});
const calendarFeed = new CalendarFeed(googleAuth, (url, init) => fetch(url, init));
const getSecret: RunnerDeps['getSecret'] = (provider) =>
  safeStorage.isEncryptionAvailable() ? loadSecret(app.getPath('userData'), provider, tokenCrypto) : Promise.resolve(null);
const aiDeps = (): RunnerDeps => ({
  getSecret,
  binaries: { claude: claudeBinary(), codex: codexBinary(), opencode: opencodeBinary(), agy: agyBinary() },
  workDir: app.getPath('userData'),
  ...(process.env.RICE_TEST_MCP_CONFIG ? { testMcpConfig: process.env.RICE_TEST_MCP_CONFIG } : {}),
});
let lightRunner: AiRunner | null = null; // modelo leve do provedor ativo: etapas simples (extrações, sugestões, ideias)
const supportsWarRoom = (p: string) => p === 'claude-sub' || p === 'chatgpt-sub';
let aiMigrated = false;
/** Gemini por assinatura foi descontinuado: troca o provedor salvo uma vez e deixa um aviso para a tela de IA (`aiNotices.geminiSub`). */
async function migrateAiProvider(): Promise<void> {
  if (aiMigrated) return;
  aiMigrated = true;
  const settings = await loadSettings();
  const plan = planGeminiMigration(settings.ai, Boolean(await getSecret('gemini-api')));
  if (plan) await saveSettings({ ...settings, ai: plan.ai, aiNotices: { ...(settings.aiNotices ?? {}), geminiSub: true } });
}
const currentAiSettings = async (): Promise<AiSettings> => {
  await migrateAiProvider();
  return resolveAiSettings((await loadSettings()).ai);
};
async function updateAiSettings(change: (ai: AiSettings) => AiSettings): Promise<AiSettings> {
  const settings = await loadSettings();
  const ai = change(resolveAiSettings(settings.ai));
  await saveSettings({ ...settings, ai });
  return ai;
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json');

let cachedSettings: Settings = { root: join(homedir(), 'Rice'), keepAudio: true };

async function loadSettings(): Promise<Settings> {
  try {
    cachedSettings = { keepAudio: true, ...(JSON.parse(await readFile(settingsPath(), 'utf8')) as Settings) };
  } catch {
    cachedSettings = { root: join(homedir(), 'Rice'), keepAudio: true };
  }
  return cachedSettings;
}

/** Template da reunião; sem `templateId` (ou se ele sumiu) vale o padrão das configurações, depois "Reunião geral". */
const resolveMeetingTemplate: TemplateResolver = async (templateId) => {
  const { root, defaultTemplateId } = await loadSettings();
  const wanted = templateId ? await getTemplate(root, templateId) : null;
  return wanted ?? (await resolveTemplate(root, defaultTemplateId));
};

// tudo o que o app cria (reuniões, áudio, transcrições, configurações, segredos, cópias) nasce só para o usuário: 0700/0600
process.umask(0o077);

/** Páginas locais do app; é a única origem que o IPC e a navegação aceitam (ver hardening.ts). */
const RENDERER_DIR = join(__dirname, '..', 'src', 'renderer');
const { handle, on } = guardedIpc(ipcMain, RENDERER_DIR);
/** Ferramentas de desenvolvimento só com `RICE_DEBUG=1`. */
const DEV_TOOLS = process.env.RICE_DEBUG === '1';

/** Idioma do app: o escolhido nas configurações ou, na primeira vez, o do sistema. */
let uiLanguageNow: UiLanguage = 'pt-BR';
// os preloads leem o idioma de forma síncrona, antes da primeira renderização
on('i18n:language', (event) => {
  event.returnValue = uiLanguageNow;
});

/**
 * Semáforos acompanham o zoom da página (⌘+/⌘−): a faixa do topo tem 48px CSS, então o centro dela fica em 24·zoom px
 * de tela; os semáforos (≈12px) são reposicionados para esse centro. Sem zoom: y 18, como no trafficLightPosition.
 */
on('ui:titlebar-zoom', (event, raw: unknown) => {
  const zoom = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0.25 && raw <= 5 ? raw : 1;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== window) return;
  if (isWindows()) win.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors, zoom)); // botões do Windows na altura da faixa
  else if (isMac()) win.setWindowButtonPosition({ x: 16, y: Math.max(4, Math.round(24 * zoom - 6)) });
});

async function currentUiLanguage(): Promise<UiLanguage> {
  return (await loadSettings()).uiLanguage ?? fromSystemLocale(app.getLocale());
}

/** Idioma das notas e do chat de uma reunião: `meta.language`, senão o padrão das configurações. */
/** Beta "Identificar participantes": baixa o modelo (uma vez) e sobe o processo de voz; qualquer falha grava sem identificar. */
async function createSpeakerIdentifier(dir: string): Promise<SpeakerIdentifier | null> {
  if (!(await loadSettings()).identifySpeakers) return null;
  try {
    const model = await ensureModel(SPEAKER_MODEL, modelsDir(), { onProgress: (p) => send('asr:download-progress', p) });
    const embedder = await OnnxSpeakerEmbedder.create(model);
    return new ClusteringIdentifier(embedder, new OnlineSpeakerClusterer({}, await loadClusterState(dir)), (state) => saveClusterState(dir, state));
  } catch (err) {
    send('session:session-warning', { message: t('speakers.unavailable', { error: (err as Error).message }) });
    return null;
  }
}

/** Progresso da geração de notas por reunião (para a UI que abre no meio). */
const notesProgress = new Map<string, NotesProgress>();

/** Termos da reunião: os do usuário (Configurações) e, se ligado, os participantes do evento da agenda. */
async function meetingTerms(meta: MeetingMeta): Promise<string[]> {
  const settings = await loadSettings();
  return mergeVocabulary(parseVocabulary(settings.vocabulary), settings.vocabularyAttendees === false ? [] : meta.participants ?? []);
}

/** Ao começar a gravar: guarda no meta os participantes do evento (o evento sai da agenda depois) e devolve o prompt do whisper. */
async function whisperVocabularyFor(dir: string): Promise<string> {
  let meta = await readMeta(dir);
  const names = meta.calendarEventId ? calendarFeed.events().find((e) => e.id === meta.calendarEventId)?.attendeeNames : undefined;
  if (names?.length && !meta.participants) meta = await updateMeta(dir, (m) => ({ ...m, participants: names.slice(0, 50) }));
  return whisperVocabularyPrompt(await meetingTerms(meta));
}

const notesLanguageOf: LanguageResolver = async (meta) => {
  const settings = await loadSettings();
  const language = meta.language ?? settings.transcriptionLanguage ?? 'pt';
  const headings = language === 'en' ? 'en' : language === 'pt' ? 'pt-BR' : await currentUiLanguage();
  return { language, headings };
};

async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
  cachedSettings = settings;
}

/** O rice-audio herda as permissões do app: o próprio Electron precisa pedir o microfone. */
async function ensureMicAccess(): Promise<void> {
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return;
  // Windows: não há diálogo do app; o acesso é do usuário em Configurações > Privacidade > Microfone (só 'denied' bloqueia)
  if (isWindows()) {
    if (status === 'denied') throw new Error(t('err.mic-permission'));
    return;
  }
  const granted = await systemPreferences.askForMediaAccess('microphone');
  if (!granted) {
    throw new Error(t('err.mic-permission'));
  }
}

const appIconPath = findAppIcon(__dirname);
let window: BrowserWindow | null = null;
let nubWindow: BrowserWindow | null = null;
let nub: NubController | null = null;
let tray: Tray | null = null;
let session: MeetingSession | null = null;
let detector: DetectorClient | null = null;
let quitting = false;
let recoveredCount = 0;
let asrStatus: { state: 'idle' | 'loading' | 'ready' | 'failed'; error?: string; downloadPercent?: number } = { state: 'idle' };
const chats = new Map<number, AbortController>();
const searchIndex = new SearchIndex();

const END_PROMPT_TIMEOUT_MS = 60_000;
const pendingPrompts = new Set<string>();
/** Apps de reunião usando o microfone agora (fim de um deles com outro ativo não encerra a gravação). */
const activeMeetingApps = new Set<string>();
/** Quando cada app de reunião gerou o último convite (evita insistir). */
const lastPromptAt = new Map<string, number>();
// Referências fortes: o GC pode descartar a Notification e perder o clique.
const liveNotifications = new Set<Notification>();

/** Mostra uma notificação; `onAction` roda no clique (corpo ou botão). Resolve quando ela some. */
function notify(opts: { title: string; actionText: string; onAction: () => void; secondaryText?: string; onSecondary?: () => void; onClose?: () => void }): { close: () => void } {
  const actions = [{ type: 'button' as const, text: opts.actionText }, ...(opts.secondaryText ? [{ type: 'button' as const, text: opts.secondaryText }] : [])];
  const n = new Notification({ title: opts.title, actions });
  liveNotifications.add(n);
  let done = false;
  const finish = (act: boolean) => {
    if (done) return;
    done = true;
    liveNotifications.delete(n);
    if (act) opts.onAction();
    opts.onClose?.();
  };
  n.on('click', () => finish(true));
  n.on('action', (_e, index: number) => {
    if (index === 1 && opts.onSecondary) {
      opts.onSecondary();
      finish(false);
    } else {
      finish(true);
    }
  });
  n.on('close', () => finish(false));
  n.show();
  return { close: () => n.close() };
}

/** Só abre links https (nunca file:, javascript: etc.). */
function openJoinUrl(url: string): boolean {
  if (!isHttpsUrl(url)) return false;
  void shell.openExternal(url);
  return true;
}

/** Aviso "vai começar": pilha de janelinhas no canto superior direito, uma por evento. */
const alertWindows = new Map<string, BrowserWindow>();
let alertScheduler: AlertScheduler | null = null;

function restackAlerts(): void {
  const area = screen.getPrimaryDisplay().workArea;
  [...alertWindows.values()].forEach((win, i) => {
    if (win.isDestroyed()) return;
    const pos = alertPosition(area, i);
    win.setPosition(Math.round(pos.x), Math.round(pos.y));
  });
}

function showAlert(plan: AlertPlan): { close: () => void } {
  if (BENCH) return { close: () => {} };
  const area = screen.getPrimaryDisplay().workArea;
  const pos = alertPosition(area, alertWindows.size);
  const win = new BrowserWindow({
    show: false, x: Math.round(pos.x), y: Math.round(pos.y), width: ALERT_WIDTH + 20, height: ALERT_HEIGHT + 20, resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, hiddenInMissionControl: true, frame: false, roundedCorners: false, hasShadow: false,
    type: 'panel', transparent: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false, preload: join(__dirname, 'alert-preload.cjs') },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.loadFile(join(__dirname, '..', 'src', 'renderer', 'alert.html'));
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  win.webContents.on('did-finish-load', () =>
    win.webContents.send('alert:data', { title: plan.event.title, time: `${hm(plan.event.start)} – ${hm(plan.event.end)}`, color: plan.event.color ?? null, hasLink: isHttpsUrl(plan.event.joinUrl) }),
  );
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => {
    alertWindows.delete(plan.key);
    restackAlerts();
  });
  alertWindows.set(plan.key, win);
  return { close: () => !win.isDestroyed() && win.destroy() };
}

function startFromCalendar(ev: { id: string; title: string; joinUrl?: string }, openLink: boolean): void {
  if (openLink && ev.joinUrl) openJoinUrl(ev.joinUrl);
  void (async () => {
    const { root } = await loadSettings();
    let dir: string | undefined;
    for (const d of await listMeetingDirs(root)) {
      const meta = await readMeta(d).catch(() => null);
      if (meta?.state === 'draft' && meta.calendarEventId === ev.id) dir = d;
    }
    startFromPrompt({ title: ev.title, trigger: 'calendar', calendarEventId: ev.id, ...(dir ? { dir } : {}) });
  })();
}

function startFromPrompt(input: { title: string; trigger: 'mic' | 'calendar'; app?: string; calendarEventId?: string; dir?: string }): void {
  if (session?.state !== 'idle') return;
  ensureMicAccess()
    .then(() => session?.start(input))
    .then((dir) => (dir ? rememberParticipants(dir, input.calendarEventId) : undefined))
    .catch((err: Error) => dialog.showErrorBox('Rice', err.message));
}

/** Último acesso ao Calendário do macOS informado pelo detector: granted, denied, notDetermined (ou unknown antes da primeira resposta). */
let calendarAccess = systemCalendarSupported() ? 'unknown' : 'unsupported'; // Windows: a agenda vem só do Google
/** Idem para os Lembretes do macOS (permissão própria, pedida só quando o usuário clica em Permitir). */
let remindersAccess = remindersSupported() ? 'unknown' : 'unsupported';

/** Lista do Início (e avisos): Calendário do macOS dos próximos 7 dias, com os de dia inteiro. */
async function refreshEventKit(): Promise<void> {
  if (!detector || calendarAccess !== 'granted') return;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 8 * 86_400_000);
  const events = await detector.listEvents(from, to);
  calendarFeed.setEventKit(events.map(fromEventKit));
}

function setupDetector(): void {
  const d = new DetectorClient(riceDetectorBinary());
  detector = d;
  d.on('error', () => {});
  d.on('calendar-access', (status: string) => {
    if (!systemCalendarSupported()) return; // o detector do Windows responde "unsupported"; o estado já está fixo
    calendarAccess = status;
    if (status === 'granted') void refreshEventKit();
    if (window && !window.isDestroyed()) window.webContents.send('calendar:changed', null); // o passo "Agenda" do guia relê o status
    if (status !== 'notDetermined' || cachedSettings.calendarAsked) return;
    void saveSettings({ ...cachedSettings, calendarAsked: true }).then(() => d.requestCalendarAccess());
  });
  d.on('reminders-access', (status: string) => {
    if (!remindersSupported()) return;
    remindersAccess = status;
    send('reminders:changed', null);
  });
  d.on('reminders-changed', () => send('reminders:changed', null));
  d.on('meeting-app-started', async ({ app: appName }: { app: string }) => {
    activeMeetingApps.add(appName);
    const key = appName;
    if (!session || !shouldPromptStart({ state: session.state, pending: pendingPrompts, key })) return;
    pendingPrompts.add(key);
    const event = await d.currentEvent().catch(() => null);
    if (session.state !== 'idle' || !shouldOfferRecording({ app: appName, muted: cachedSettings.mutedApps ?? [], calendarEvidence: event !== null, lastPromptAt: lastPromptAt.get(appName), now: Date.now() })) {
      pendingPrompts.delete(key);
      return;
    }
    lastPromptAt.set(appName, Date.now());
    const title = titleFor({ calendarTitle: event?.title, app: appName });
    notify({
      title: t('notify.record.title', { title }),
      actionText: t('notify.record.action'),
      onAction: () => startFromPrompt({ title, trigger: 'mic', app: appName, calendarEventId: event?.id }),
      secondaryText: t('notify.record.mute', { app: appName }),
      onSecondary: () => void saveSettings({ ...cachedSettings, mutedApps: [...new Set([...(cachedSettings.mutedApps ?? []), appName])] }),
      onClose: () => pendingPrompts.delete(key),
    });
  });
  d.on('calendar-changed', () => void refreshEventKit());
  d.on('upcoming', (ev: { id: string; title: string; start: string; end: string; url: string | null }) => {
    calendarFeed.addEventKit(fromEventKit(ev));
  });
  d.on('meeting-app-ended', async ({ app: appName }: { app: string }) => {
    activeMeetingApps.delete(appName);
    const s = session;
    const rec = s?.recording;
    if (!s || !rec || !s.currentDir) return;
    const meta = await readMeta(s.currentDir).catch(() => null);
    if (!shouldPromptEnd({ state: s.state, metaApp: meta?.app, app: appName, pending: pendingPrompts })) return;
    // R-33: gravação curta, sem fala dos outros ou outra chamada ativa = ignora; só para sozinho no fim do evento da agenda
    const event = meta?.calendarEventId ? calendarFeed.events().find((e) => e.id === meta.calendarEventId) : undefined;
    const decision = decideMeetingEnd({ recordedMs: rec.recordedMs, othersSpoke: rec.othersSpoke, calendarEnd: event ? new Date(event.end) : null, now: new Date(), otherCallActive: activeMeetingApps.size > 0 });
    if (decision === 'ignore') return;
    const key = endKey(appName);
    pendingPrompts.add(key);
    const dir = s.currentDir;
    let n: { close: () => void } | null = null;
    const stop = () => {
      clearTimeout(timer);
      if (s.state === 'recording') void s.stop().catch((err) => logError('stop failed', err));
    };
    const timer = setTimeout(() => {
      n?.close();
      if (decision === 'ask-then-stop' && s.state === 'recording' && s.currentDir === dir) {
        stop();
        s.alerts.set({ id: 'auto-stopped', level: 'info', message: t('alert.meeting-ended'), action: { kind: 'resume-recording', label: t('alert.action.resume') }, dismissible: true, dir });
        setTimeout(() => s.alerts.clear('auto-stopped'), 30_000).unref?.();
      }
    }, END_PROMPT_TIMEOUT_MS);
    n = notify({
      title: t('notify.end.title'),
      actionText: t('notify.end.action'),
      onAction: stop,
      onClose: () => pendingPrompts.delete(key),
    });
  });
  d.start();
}

/** `RICE_BENCH=1`: instância de medição, sem janelas visíveis, nub, alertas, bandeja nem ícone no Dock. */
const BENCH = process.env.RICE_BENCH === '1';
/** Plataforma que o renderer mostra. Só as instâncias de teste (RICE_BENCH) aceitam RICE_FAKE_PLATFORM, para os prints do layout do Windows no Mac. */
const PLATFORM_FOR_UI = BENCH && process.env.RICE_FAKE_PLATFORM === 'win32' ? 'win32' : process.platform;

function createWindow(): void {
  if (window) {
    if (!BENCH) window.show();
    return;
  }
  window = new BrowserWindow({
    show: !BENCH,
    width: 1200,
    height: 780,
    title: 'Rice',
    ...(isWindows()
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors) } // botões do Windows à direita, sobre a faixa de 48px
      : { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }),
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), additionalArguments: [`--rice-platform=${PLATFORM_FOR_UI}`], contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: DEV_TOOLS },
  });
  window.loadFile(join(__dirname, '..', 'src', 'renderer', 'index.html'));
  window.on('focus', updateNub);
  window.on('blur', updateNub);
  window.on('show', updateNub);
  window.on('hide', updateNub);
  window.on('minimize', updateNub);
  window.on('restore', updateNub);
  window.on('closed', () => {
    window = null;
    updateNub();
  });
  updateNub();
}

function updateNub(): void {
  const w = window && !window.isDestroyed() ? window : null;
  nub?.update({
    recording: session?.state === 'recording',
    mainFocused: Boolean(w?.isFocused()),
    mainVisible: Boolean(w?.isVisible() && !w.isMinimized()),
  });
}

function showMainWindow(): void {
  if (!window || window.isDestroyed()) {
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  if (BENCH) return;
  window.show();
  window.focus();
}

function createNub(): NubController {
  return new NubController({
    createWindow: () => {
      const win = new BrowserWindow({
        show: false, width: NUB_BAR_WIDTH, height: NUB_HEIGHT, resizable: false, acceptFirstMouse: true, minimizable: false, maximizable: false, fullscreenable: false,
        closable: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, hiddenInMissionControl: true, frame: false,
        roundedCorners: false, hasShadow: false, type: 'panel', transparent: true, backgroundColor: '#00000000',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false, preload: join(__dirname, 'nub-preload.cjs') },
      });
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.loadFile(join(__dirname, '..', 'src', 'renderer', 'nub.html'));
      win.webContents.on('did-finish-load', () => nub?.resendState());
      win.on('moved', () => nub?.persistPosition());
      win.on('closed', () => (nubWindow = null));
      nubWindow = win;
      return {
        showInactive: () => win.showInactive(),
        hide: () => win.hide(),
        isVisible: () => win.isVisible(),
        isDestroyed: () => win.isDestroyed(),
        getPosition: () => win.getPosition(),
        setPosition: (x, y) => win.setPosition(Math.round(x), Math.round(y)),
        send: (channel, payload) => win.webContents.send(channel, payload),
        destroy: () => win.destroy(),
        setBounds: (b) => win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }),
        setFocusable: (focusable) => win.setFocusable(focusable),
        focus: () => win.focus(),
        setIgnoreMouseEvents: (ignore) => win.setIgnoreMouseEvents(ignore),
      };
    },
    screen,
    mainBounds: () => (window && !window.isDestroyed() ? window.getBounds() : null),
    savedPosition: () => cachedSettings.nubPosition,
    savePosition: (position) => void saveSettings({ ...cachedSettings, nubPosition: position }).catch((err) => logError('nub position', err)),
  });
}

/** Menu do app (Editar, Janela…) no idioma escolhido; Configurações… (⌘,) abre a tela de configurações. */
function buildAppMenu(): void {
  const openSettings = () => {
    showMainWindow();
    window?.webContents.send('app:open-settings', null);
  };
  const appMenu: Electron.MenuItemConstructorOptions = isWindows()
    ? {
        // Windows: sem o menu do app do Mac (Sobre/Ocultar); Configurações e Sair ficam em "Rice", com atalhos Ctrl
        label: 'Rice',
        submenu: [
          { label: t('menu.settings'), accelerator: 'Control+,', click: openSettings },
          { type: 'separator' },
          { label: t('menu.quit'), role: 'quit' },
        ],
      }
    : {
        label: 'Rice',
        submenu: [
          { label: t('menu.about'), role: 'about' },
          { type: 'separator' },
          { label: t('menu.settings'), accelerator: 'Command+,', click: openSettings },
          { type: 'separator' },
          { label: t('menu.hide'), role: 'hide' },
          { label: t('menu.hide-others'), role: 'hideOthers' },
          { label: t('menu.show-all'), role: 'unhide' },
          { type: 'separator' },
          { label: t('menu.quit'), role: 'quit' },
        ],
      };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      {
        label: t('menu.edit'),
        submenu: [
          { label: t('menu.undo'), role: 'undo' },
          { label: t('menu.redo'), role: 'redo' },
          { type: 'separator' },
          { label: t('menu.cut'), role: 'cut' },
          { label: t('menu.copy'), role: 'copy' },
          { label: t('menu.paste'), role: 'paste' },
          { label: t('menu.select-all'), role: 'selectAll' },
        ],
      },
      {
        // Visualizar: tamanho real (⌘0) e zoom (⌘+ / ⌘−) — sem este menu não havia como desfazer o zoom
        label: t('menu.view'),
        submenu: [
          { label: t('menu.actual-size'), role: 'resetZoom' },
          { label: t('menu.zoom-in'), role: 'zoomIn' },
          { label: t('menu.zoom-in'), role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false, acceleratorWorksWhenHidden: true },
          { label: t('menu.zoom-out'), role: 'zoomOut' },
        ],
      },
      {
        label: t('menu.window'),
        submenu: [
          { label: t('menu.minimize'), role: 'minimize' },
          ...(isMac() ? [{ label: t('menu.zoom'), role: 'zoom' as const }] : []),
          { label: t('menu.close'), role: 'close' },
        ],
      },
    ]),
  );
}

/** Aplica o idioma do app em todo lugar: textos do main, menu, bandeja e janelas abertas (que re-renderizam). */
function applyUiLanguage(language: UiLanguage): void {
  uiLanguageNow = language;
  setLanguage(language);
  buildAppMenu();
  updateTray();
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('ui:language', language);
}

function updateTray(state: SessionState = session?.state ?? 'idle'): void {
  if (!tray) return;
  // o logo (imagem template) fica sempre; só o texto muda durante a gravação, sem emoji
  if (isMac()) tray.setTitle(state === 'recording' ? ' REC' : state === 'finishing' ? ' …' : '');
  else tray.setToolTip(state === 'recording' ? t('tray.tooltip-recording') : 'Rice'); // Windows: sem texto ao lado do ícone; o estado vai na dica
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: t('tray.record-now'),
        enabled: state === 'idle',
        click: () => {
          ensureMicAccess().then(() => session?.start({ title: t('meeting.default-title'), trigger: 'manual' })).catch((err: Error) => dialog.showErrorBox('Rice', err.message));
        },
      },
      { label: t('tray.stop'), enabled: state === 'recording', click: () => void session?.stop() },
      { type: 'separator' },
      { label: t('tray.open'), click: createWindow },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => app.quit() },
    ]),
  );
}

/** Logo monocromático para a barra de menus: o macOS pinta imagens "template" de claro ou escuro conforme a barra. */
function trayImage(): Electron.NativeImage {
  if (isWindows()) {
    // Windows: ícone colorido (a bandeja não pinta "template"), no tamanho de 16 DIP
    const ico = findWinIcon(__dirname);
    return ico ? nativeImage.createFromPath(ico) : nativeImage.createEmpty();
  }
  const files = findTrayIcons(__dirname);
  if (!files) return nativeImage.createEmpty();
  const image = nativeImage.createFromPath(files.x1);
  image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(files.x2).toPNG() });
  image.setTemplateImage(true);
  return image;
}

function createTray(): void {
  tray = new Tray(trayImage());
  tray.setToolTip('Rice');
  if (isWindows()) tray.on('click', createWindow); // no Windows o clique no ícone abre a janela (o menu fica no botão direito)
  updateTray('idle');
}

function send(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

async function runAlertAction(s: MeetingSession, kind: AlertActionKind, dir?: string, id?: string): Promise<void> {
  switch (kind) {
    case 'open-storage':
      return void (await shell.openExternal(systemPanelUrl('storage')));
    case 'open-mic-privacy':
      return void (await shell.openExternal(systemPanelUrl('microphone')));
    case 'open-audio-privacy':
      return void (await shell.openExternal(systemPanelUrl('audioCapture')));
    case 'stop-recording':
      return s.stop();
    case 'keep-recording':
      return s.keepRecording();
    case 'resume-recording':
      if (id) s.alerts.clear(id);
      if (dir && s.state === 'idle') {
        await ensureMicAccess();
        await s.start({ title: (await readMeta(dir)).title, trigger: 'manual', dir });
      }
      return;
    default:
      void dir; // as demais ações (notas...) entram com os itens que as usam
  }
}

function setupSession(runner: AiRunner): AsrService {
  const asr = new AsrService({
    onProgress: (p) => {
      asrStatus = { ...asrStatus, downloadPercent: p.totalBytes > 0 && p.receivedBytes < p.totalBytes ? Math.floor((p.receivedBytes / p.totalBytes) * 100) : undefined };
      send('asr:download-progress', p);
    },
    onStatus: (st) => {
      asrStatus = { ...st, downloadPercent: st.state === 'loading' ? asrStatus.downloadPercent : undefined };
      send('asr:status', st);
    },
  });
  const s = new MeetingSession({
    root: async () => (await loadSettings()).root,
    createCapture: () => new AudioCapture(riceAudioBinary()),
    createPipeline: (language, vocabulary, speakers) => asr.createPipeline(language, vocabulary, speakers),
    vocabulary: whisperVocabularyFor,
    speakers: createSpeakerIdentifier,
    defaultLanguage: async () => (await loadSettings()).transcriptionLanguage ?? 'pt',
    generateNotes: async (dir, options) => {
      if (!options?.resume) return generateNotes(dir, runner, resolveMeetingTemplate, notesLanguageOf, meetingTerms);
      // retomada: mesmo template da reunião; as notas anteriores vão para notas-anterior.md
      const template = await resolveMeetingTemplate((await readMeta(dir)).templateId);
      return regenerateNotes(dir, runner, template.id, resolveMeetingTemplate, { queueAfterCurrent: true, languageOf: notesLanguageOf, vocabularyOf: meetingTerms });
    },
    keepAudio: () => cachedSettings.keepAudio !== false,
    spoolDir: () => join(app.getPath('userData'), 'spool'),
    micPermission: () => systemPreferences.getMediaAccessStatus('microphone'),
    inactivityMs: () => (typeof cachedSettings.inactivityMinutes === 'number' ? cachedSettings.inactivityMinutes : 15) * 60_000,
  });
  session = s;
  s.alerts.on('change', (list) => send('session:alerts', list));
  // lembretes que merecem uma notificação do sistema (o app pode estar em segundo plano durante a reunião)
  s.on('attention', ({ kind, message }: { kind: 'idle' | 'long' | 'auto-stopped'; message: string }) => {
    notify({
      title: message,
      actionText: kind === 'auto-stopped' ? t('alert.action.resume') : t('alert.action.keep'),
      onAction: () => {
        if (kind === 'auto-stopped') {
          const a = s.alerts.list().find((x) => x.id === 'auto-stopped');
          if (a) void runAlertAction(s, 'resume-recording', a.dir, a.id).catch((err: Error) => dialog.showErrorBox('Rice', err.message));
        } else {
          s.keepRecording();
        }
      },
    });
  });
  for (const name of ['state', 'segment', 'partial', 'asr-status', 'asr-warning', 'capture-event', 'session-warning', 'notes'] as const) {
    s.on(name, (payload) => send(`session:${name}`, payload));
  }
  s.on('state', updateTray);
  s.on('state', updateNub);
  // falas ainda não finalizadas (parciais atuais de cada fonte): entram nos ciclos como "provisório"
  const livePartials = new Map<string, Map<string, { text: string; at: number }>>();
  s.on('partial', ({ dir: d, partial }: { dir: string; partial: { source: string; text: string } }) => {
    const bySource = livePartials.get(d) ?? new Map<string, { text: string; at: number }>();
    bySource.set(partial.source, { text: partial.text.trim(), at: Date.now() });
    livePartials.set(d, bySource);
  });
  s.on('segment', ({ dir: d, segment }: { dir: string; segment: { source: string } }) => livePartials.get(d)?.delete(segment.source));
  s.on('state', (st: string) => {
    if (st === 'idle') livePartials.clear();
  });
  // ideias ao vivo e War room: ciclos só enquanto grava, nunca nas notas automáticas
  const warRoom = createWarRoom({
    handle,
    send,
    checkedDir,
    runner,
    lightRunner: () => lightRunner ?? runner,
    maxCycles: async () => normalizeMaxCycles((await loadSettings()).warroomMaxCycles),
    provider: async () => (await currentAiSettings()).provider,
    language: async (d) => ((await notesLanguageOf(await readMeta(d))).headings === 'en' ? 'en' : 'pt-BR'),
    transcript: (d) => readMeetingText(d, 'transcript'),
    partials: (d) => [...(livePartials.get(d) ?? new Map<string, { text: string; at: number }>())].filter(([, p]) => p.text && Date.now() - p.at < 8000).map(([source, p]) => `${source}: ${p.text}`), // parcial parado há 8 s não conta (alucinação sem final)
    isRecording: (d) => s.state === 'recording' && s.currentDir === d,
    pickFolder: async () => {
      const options = { title: t('warroom.src.folder'), properties: ['openDirectory' as const] };
      const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    saveAnnotations: async (d, text) => {
      await saveAnnotations(d, text, new Date(), true);
    },
    ideaTemplates: async () => {
      const settings = await loadSettings();
      const language = await currentUiLanguage();
      return { templates: (await listIdeaTemplates(settings.root)).templates.map((x) => localizeIdeaTemplate(x, language)), ...(settings.lastIdeaTemplate ? { lastId: settings.lastIdeaTemplate } : {}) };
    },
    rememberIdeaTemplate: async (id) => {
      await saveSettings({ ...(await loadSettings()), lastIdeaTemplate: id });
    },
    userData: app.getPath('userData'),
    openPath: (path) => shell.openPath(path), // abre o .command no Terminal padrão (sem osascript)
    openExternal: (url) => shell.openExternal(url),
    reveal: (path) => shell.showItemInFolder(path),
  });
  registerAttachments({
    handle,
    send,
    checkedDir,
    isRecording: (d) => s.state === 'recording' && s.currentDir === d,
    imagesSupported: async () => {
      const provider = (await currentAiSettings()).provider;
      return { provider, supported: ['claude-api', 'openai-api', 'gemini-api'].includes(provider) };
    },
    pickFiles: async () => {
      const options = { title: t('attach.pick'), properties: ['openFile' as const, 'multiSelections' as const] };
      const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    trash: (p) => shell.trashItem(p),
    open: (p) => shell.openPath(p),
    reveal: (p) => shell.showItemInFolder(p),
    thumbnail: (p) => {
      const image = nativeImage.createFromPath(p);
      return image.isEmpty() ? null : image.resize({ width: 192, quality: 'good' }).toDataURL();
    },
    reindex: () => {}, // a busca relê sozinha: o index.json dos anexos conta na data de modificação
  });
  let warRoomDir: string | null = null;
  const warRoomBeat = setInterval(() => warRoom.ensure(s.currentDir), 15_000);
  warRoomBeat.unref();
  s.on('state', (state: string) => {
    if (s.currentDir) warRoomDir = s.currentDir;
    warRoom.onSessionState(state, warRoomDir);
  });
  const levels = new LevelThrottle((l) => nub?.sendLevel(l));
  s.on('frame', (frame) => levels.push(frame));
  // "Recuperar reunião": finaliza o áudio órfão, transcreve o que ficou sem texto e gera as notas
  handle('meetings:recover', async (_e, rawDir: string) => {
    try {
      const dir = await checkedDir(rawDir);
      if (s.state !== 'idle' && s.currentDir === dir) return { ok: false as const, message: t('err.meeting-recording') };
      const result = await recoverMeeting(dir, {
        createPipeline: (language) => asr.createPipeline(language),
        generateNotes: (d) => generateNotes(d, runner, resolveMeetingTemplate, notesLanguageOf, meetingTerms),
        language: async (d) => (await readMeta(d)).language ?? (await loadSettings()).transcriptionLanguage ?? 'pt',
        keepAudio: () => cachedSettings.keepAudio !== false,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  });
  handle('session:alerts', () => s.alerts.list());
  handle('session:alert-dismiss', (_e, id: unknown) => {
    const alert = s.alerts.list().find((a) => a.id === id);
    if (alert?.dismissible) s.alerts.clear(alert.id);
  });
  // botão de um aviso: só as ações conhecidas (o renderer manda o id, nunca um comando)
  handle('session:alert-action', async (_e, id: unknown, kind: unknown) => {
    const alert = s.alerts.list().find((a) => a.id === id);
    if (!alert) return;
    // só vale uma das ações que o próprio aviso oferece (o renderer manda o id e o tipo, nunca um comando)
    const offered = [alert.action?.kind, alert.secondary?.kind];
    const chosen = offered.includes(kind as AlertActionKind) ? (kind as AlertActionKind) : alert.action?.kind;
    if (chosen) await runAlertAction(s, chosen, alert.dir, alert.id);
  });
  handle('session:start', async (_e, input?: { title?: string; dir?: string }) => {
    try {
      const request = parseStartInput(input, (await loadSettings()).root);
      await ensureMicAccess();
      s.alerts.clear('permission:mic');
      return { ok: true as const, dir: await s.start(request) };
    } catch (err) {
      // R-06: sem permissão a gravação não começa em silêncio; o aviso traz o atalho para o painel certo
      if ((err as Error).message === t('err.mic-permission')) {
        s.alerts.set({ id: 'permission:mic', level: 'error', message: t('err.mic-permission'), action: { kind: 'open-mic-privacy', label: t('alert.action.privacy') } });
      }
      return { ok: false as const, message: (err as Error).message };
    }
  });
  const stopRecording = async () => {
    try {
      await s.stop();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  };
  handle('session:stop', stopRecording);
  // os IPCs do nub só valem se vierem da própria janelinha
  const fromNub = (e: Electron.IpcMainInvokeEvent) => nubWindow !== null && e.sender === nubWindow.webContents;
  handle('nub:open-main', (e) => {
    if (fromNub(e)) showMainWindow();
  });
  handle('nub:stop', (e) => (fromNub(e) ? stopRecording() : { ok: false as const, message: t('err.foreign-origin') }));
  const nubIpc = createNubIpc<Electron.IpcMainInvokeEvent>({
    fromNub,
    activeDir: () => (s.state === 'recording' ? s.currentDir : null),
    expand: () => nub?.expand() ?? false,
    collapse: () => nub?.collapse(),
    context: async (dir) => ({
      title: (await readMeta(dir)).title,
      lines: lastTranscriptLines(await readMeetingText(dir, 'transcript')),
    }),
    ask: (dir, question, signal, onDelta) => askAboutMeeting(runner, dir, question, signal, onDelta),
    sendToNub: (channel, payload) => nub?.sendExpanded(channel, payload),
    notifyMain: (turn) => {
      if (window && !window.isDestroyed()) window.webContents.send('chat:external', turn);
    },
  });
  handle('nub:expand', (e) => nubIpc.expand(e));
  handle('nub:collapse', (e) => nubIpc.collapse(e));
  handle('nub:ask', (e, question: unknown) => nubIpc.ask(e, question));
  handle('nub:cancel', (e) => nubIpc.cancel(e));
  s.on('segment', ({ segment }) => nub?.sendExpanded('nub:segment', segment));
  s.on('partial', ({ partial }) => nub?.sendExpanded('nub:partial', partial));
  handle('nub:drag-end', (e) => {
    if (fromNub(e)) nub?.persistPosition();
  });
  handle('session:recovered-count', () => recoveredCount);
  handle('session:state', () => ({ state: s.state, dir: s.currentDir }));
  handle('asr:retry', () => s.retryAsr());
  handle('notes:generate', async (_e, rawDir: string) => {
    try {
      await generateNotes(await checkedDir(rawDir), runner, resolveMeetingTemplate, notesLanguageOf);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });
  handle('notes:regenerate', async (_e, rawDir: string, templateId: string) => {
    try {
      const dir = await checkedDir(rawDir);
      const { root } = await loadSettings();
      const template = await getTemplate(root, String(templateId ?? ''));
      if (!template) throw new Error(t('err.template-not-found'));
      await regenerateNotes(dir, runner, template.id, resolveMeetingTemplate, { languageOf: notesLanguageOf, vocabularyOf: meetingTerms });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });
  handle('notes:versions', async (_e, rawDir: string) => listVersions(await checkedDir(rawDir)));
  handle('notes:version-read', async (_e, rawDir: string, file: string) => {
    try {
      const { version, content } = await readVersion(await checkedDir(rawDir), String(file ?? ''));
      return { ok: true as const, version, content };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  handle('notes:version-restore', async (_e, rawDir: string, file: string) => {
    try {
      const dir = await checkedDir(rawDir);
      const nameOf = async (id: string | undefined) => (await resolveMeetingTemplate(id)).title;
      await restoreVersion(dir, String(file ?? ''), nameOf);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  return asr;
}

/** Pergunta sobre a reunião: monta o prompt, transmite o texto aos poucos e grava a troca no chat.md. */
async function chatAnswer(runner: AiRunner, dir: string, question: string, signal: AbortSignal, onDelta: (text: string) => void): Promise<string> {
  const meta = await readMeta(dir);
  const { language } = await notesLanguageOf(meta);
  const prompt = buildChatPrompt(
    {
      title: meta.title,
      startedAt: meta.startedAt,
      transcript: await chatTranscript(dir, applySpeakerNames(await readMeetingText(dir, 'transcript'), meta.speakers), question, language),
      annotations: await readMeetingText(dir, 'annotations'),
      attachments: await attachmentsContext(dir),
      vocabulary: await meetingTerms(meta),
    },
    await readChat(dir),
    question,
    language,
  );
  // ferramentas/MCPs só aqui (chat) e só se o usuário ligou a opção; notas, e-mail e extrações nunca passam por este caminho
  // War room: o chat da reunião usa as fontes ligadas no painel e leva os fatos confirmados como contexto
  const war = await readWarRoomConfig(dir);
  const warOn = war.kind === 'warroom';
  const facts = warOn ? contextFacts(war) : [];
  const folder = warOn && war.sources.folder && (await currentAiSettings()).provider === 'claude-sub' && (await checkWorkFolder(war.sources.folder)).ok ? war.sources.folder : undefined;
  const system = facts.length ? `${chatSystemPrompt(language)}\n\n${t('warroom.facts.context', undefined, language === 'en' ? 'en' : 'pt-BR')}:\n${facts.map((f) => `- ${f.text}`).join('\n')}` : chatSystemPrompt(language);
  const warAccess = warOn && (war.sources.web || war.sources.mcp || folder) && supportsWarRoom(await currentAiSettings().then((a) => a.provider)) ? { mcp: war.sources.mcp, web: war.sources.web, ...(folder ? { folder } : {}) } : undefined;
  const apiProvider = ['claude-api', 'openai-api', 'gemini-api'].includes((await currentAiSettings()).provider);
  const images = apiProvider ? await attachmentImages(dir) : []; // imagens só vão para APIs que aceitam bloco de imagem; os CLIs as ignoram
  const answer = await runChat(runner, { system, prompt, signal, ...(images.length ? { images } : {}) }, { useTools: (await loadSettings()).chatTools === true, ...(warAccess ? { access: warAccess } : {}), language: language === 'en' ? 'en' : 'pt-BR', onDelta });
  await appendChat(dir, new Date(), question, answer);
  return answer;
}

async function askAboutMeeting(runner: AiRunner, dir: string, question: string, signal: AbortSignal, onDelta: (text: string) => void) {
  try {
    return { ok: true as const, answer: await chatAnswer(runner, dir, question, signal, onDelta) };
  } catch (err) {
    return { ok: false as const, kind: err instanceof AiError ? err.kind : 'other', message: (err as Error).message };
  }
}

async function checkedDir(dir: unknown): Promise<string> {
  const { root } = await loadSettings();
  const resolved = resolve(String(dir ?? ''));
  if (!isInsideRoot(root, resolved)) throw new Error(t('err.outside-root'));
  return resolved;
}


/** Guarda na reunião os e-mails dos participantes do evento da agenda (o evento sai do feed depois de passar). */
async function rememberParticipants(dir: string, eventId: string | undefined): Promise<void> {
  const emails = eventId ? calendarFeed.events().find((e) => e.id === eventId)?.attendeeEmails : undefined;
  if (!emails || emails.length === 0) return;
  await updateMeta(dir, (meta) => ({ ...meta, participantEmails: emails })).catch((err) => logError('participants', err));
}

/** Pasta de destino dos PDFs: a última escolhida (nas configurações) ou Downloads. RICE_EXPORT_DIR: instância de teste. */
async function exportDir(): Promise<string> {
  return process.env.RICE_EXPORT_DIR ?? (await loadSettings()).exportDir ?? app.getPath('downloads');
}
/** Último PDF gravado: é o único caminho que "Mostrar no Finder" aceita (o renderer nunca escolhe um caminho). */
let lastExport: string | null = null;

function shareDeps(runner: AiRunner): ShareDeps {
  return {
    checkedDir,
    readMeta,
    readText: readMeetingText,
    clipboard: { write: ({ text, html }) => clipboard.write([new ClipboardItem(html ? { 'text/plain': text, 'text/html': html } : { 'text/plain': text })]) },
    runner,
    languageOf: async (meta) => {
      const { language, headings } = await notesLanguageOf(meta);
      return { language, headings };
    },
    participants: async (meta) => meta.participantEmails ?? calendarFeed.events().find((e) => e.id === meta.calendarEventId)?.attendeeEmails ?? [],
    selfEmails: async () => [],
    openExternal: (url) => shell.openExternal(url),
    exportFolder: async () => ({ display: tildify(await exportDir()) }),
    exportTarget: async (name) => {
      const dir = await exportDir();
      await mkdir(dir, { recursive: true });
      const path = await uniquePath(dir, name, (p) => access(p).then(() => true, () => false));
      lastExport = path;
      return path;
    },
    writeFile: (path, data) => writeFile(path, data),
    createPdfWindow: () => {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false, devTools: false } });
      win.webContents.on('will-navigate', (e) => e.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      return { loadURL: (url) => win.loadURL(url), printToPDF: (options) => win.webContents.printToPDF(options), destroy: () => win.destroy() };
    },
  };
}

function registerIpc(runner: AiRunner): void {
  handle('settings:get', async () => {
    const settings = await loadSettings();
    return {
      ...settings,
      rootDisplay: tildify(settings.root),
      transcriptionLanguage: settings.transcriptionLanguage ?? 'pt',
      uiLanguage: await currentUiLanguage(),
      keepAudio: settings.keepAudio !== false,
      vocabulary: settings.vocabulary ?? '',
      vocabularyAttendees: settings.vocabularyAttendees !== false,
      identifySpeakers: settings.identifySpeakers === true,
      chatTools: settings.chatTools === true,
      warroomMaxCycles: normalizeMaxCycles(settings.warroomMaxCycles),
    };
  });
  handle('settings:set-warroom-max-cycles', async (_e, value: unknown) => {
    await saveSettings({ ...(await loadSettings()), warroomMaxCycles: normalizeMaxCycles(value) });
    return { ok: true as const };
  });
  handle('settings:set-ui-language', async (_e, language: unknown) => {
    if (language !== 'pt-BR' && language !== 'en') return { ok: false as const, message: t('err.language-invalid') };
    await saveSettings({ ...(await loadSettings()), uiLanguage: language });
    applyUiLanguage(language);
    return { ok: true as const };
  });
  // vale para as próximas gravações (o idioma de uma gravação em andamento não muda)
  handle('settings:set-transcription-language', async (_e, language: unknown) => {
    if (!isTranscriptionLanguage(language)) return { ok: false as const, message: t('err.language-invalid') };
    await saveSettings({ ...(await loadSettings()), transcriptionLanguage: language });
    return { ok: true as const };
  });
  handle('settings:set-vocabulary', async (_e, text: unknown, includeAttendees: unknown) => {
    const vocabulary = parseVocabulary(String(text ?? '')).join('\n');
    await saveSettings({ ...(await loadSettings()), vocabulary, vocabularyAttendees: includeAttendees !== false });
    return { ok: true as const };
  });
  handle('settings:set-identify-speakers', async (_e, on: unknown) => {
    await saveSettings({ ...(await loadSettings()), identifySpeakers: on === true });
    return { ok: true as const };
  });
  handle('settings:set-chat-tools', async (_e, on: unknown) => {
    await saveSettings({ ...(await loadSettings()), chatTools: on === true });
    return { ok: true as const };
  });
  // estado do recurso para o chip e a tela de Configurações: ligado? o provedor ativo suporta? há MCP configurado?
  handle('ai:tools-status', async () => {
    const on = (await loadSettings()).chatTools === true;
    const provider = (await currentAiSettings()).provider;
    if (provider === 'claude-sub') {
      const deps = aiDeps();
      const servers = on ? await probeClaudeMcpServers({ binary: deps.binaries.claude, cwd: `${deps.workDir}/claude-cwd`, token: await getSecret('claude-sub') }) : [];
      return { on, provider, available: true as const, ...(on ? { servers: servers.length } : {}), ...(on && servers.length === 0 ? { hint: t('chat-tools.none-claude') } : {}) };
    }
    if (provider === 'chatgpt-sub') return { on, provider, available: true as const };
    return { on, provider, available: false as const, hint: t(provider === 'opencode-sub' || provider === 'agy-sub' ? 'chat-tools.unavailable-cli' : 'chat-tools.unavailable-api') };
  });
  handle('settings:set-keep-audio', async (_e, keep: unknown) => {
    await saveSettings({ ...(await loadSettings()), keepAudio: keep !== false });
    return { ok: true as const };
  });
  // abre a pasta das reuniões no Finder (caminho vem das configurações, nunca do renderer)
  handle('settings:reveal-root', async () => {
    const { root } = await loadSettings();
    await mkdir(root, { recursive: true });
    const error = await shell.openPath(root);
    return error ? { ok: false as const, message: error } : { ok: true as const };
  });

  handle('settings:set-onboarding-done', async () => {
    await saveSettings({ ...(await loadSettings()), onboardingDone: true });
    return { ok: true as const };
  });

  handle('asr:status', () => asrStatus);

  // `headings`: idioma dos nomes das seções dos embutidos (a página da reunião passa o idioma dela; senão vale o do app)
  const displayLanguage = async (headings: unknown): Promise<UiLanguage> => (headings === 'en' || headings === 'pt-BR' ? headings : currentUiLanguage());
  handle('templates:list', async (_e, headings?: unknown) => {
    const { root, defaultTemplateId } = await loadSettings();
    const language = await displayLanguage(headings);
    const { templates, warnings } = await listTemplates(root);
    if (warnings.length > 0) logWarn(`${warnings.length} template(s) ignorado(s)`);
    return { templates: templates.map((tpl) => localizeTemplate(tpl, language)), warnings, defaultId: (await resolveTemplate(root, defaultTemplateId)).id };
  });
  handle('templates:get', async (_e, id: string, headings?: unknown) => {
    const found = await getTemplate((await loadSettings()).root, String(id ?? ''));
    return found ? localizeTemplate(found, await displayLanguage(headings)) : null;
  });
  handle('templates:save', async (_e, input: NoteTemplateInput) => {
    try {
      return { ok: true as const, template: await saveTemplate((await loadSettings()).root, input) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  handle('templates:delete', async (_e, id: string) => {
    try {
      const settings = await loadSettings();
      await deleteTemplate(settings.root, String(id ?? ''));
      if (settings.defaultTemplateId === id) {
        const { defaultTemplateId: _gone, ...rest } = settings;
        await saveSettings(rest);
      }
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  handle('templates:restore', async (_e, id: string) => {
    try {
      return { ok: true as const, template: await restoreBuiltinTemplate((await loadSettings()).root, String(id ?? '')) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  // templates de ideias (modo ideia): embutidos + do usuário em <raiz>/.rice/idea-templates
  handle('ideatemplates:list', async (_e, headings?: unknown) => {
    const { root, lastIdeaTemplate } = await loadSettings();
    const language = await displayLanguage(headings);
    const { templates, warnings } = await listIdeaTemplates(root);
    return { templates: templates.map((x) => localizeIdeaTemplate(x, language)), warnings, lastId: lastIdeaTemplate ?? 'general' };
  });
  handle('ideatemplates:save', async (_e, input: unknown) => {
    try {
      return { ok: true as const, template: await saveIdeaTemplate((await loadSettings()).root, input as never) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  handle('ideatemplates:delete', async (_e, id: string) => {
    try {
      await deleteIdeaTemplate((await loadSettings()).root, String(id ?? ''));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  handle('ideatemplates:restore', async (_e, id: string) => {
    try {
      return { ok: true as const, template: await restoreBuiltinIdeaTemplate((await loadSettings()).root, String(id ?? '')) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  handle('templates:set-default', async (_e, id: string) => {
    const settings = await loadSettings();
    const template = await getTemplate(settings.root, String(id ?? ''));
    if (!template) return { ok: false as const, message: t('err.template-not-found') };
    await saveSettings({ ...settings, defaultTemplateId: template.id });
    return { ok: true as const };
  });
  // idioma falado nesta reunião (vale ao começar ou continuar a gravação; não muda durante uma gravação)
  handle('meetings:set-language', async (_e, rawDir: string, language: unknown) => {
    try {
      const dir = await checkedDir(rawDir);
      if (!isTranscriptionLanguage(language)) throw new Error(t('err.language-invalid'));
      if (session && session.state !== 'idle' && session.currentDir === dir) throw new Error(t('err.language-recording'));
      await updateMeta(dir, (meta) => ({ ...meta, language }));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });
  // ---- pastas (agrupamento na barra lateral): só rótulos; nenhuma pasta física se move ----
  const folderCall = async <T>(run: (root: string) => Promise<T>) => {
    try {
      return { ok: true as const, value: await run((await loadSettings()).root) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  };
  handle('folders:list', async () => readFolders((await loadSettings()).root));
  handle('folders:create', (_e, name: unknown, parentId?: unknown) => folderCall((root) => createFolder(root, name, parentId)));
  handle('folders:move', (_e, id: unknown, parentId: unknown) => folderCall((root) => moveFolder(root, String(id ?? ''), parentId ?? null)));
  handle('folders:rename', (_e, id: unknown, name: unknown) => folderCall((root) => renameFolder(root, String(id ?? ''), name)));
  handle('folders:delete', (_e, id: unknown) => folderCall((root) => deleteFolder(root, String(id ?? ''))));
  handle('folders:reorder', (_e, ids: unknown) => folderCall((root) => reorderFolders(root, ids)));
  // `dir` validado contra a raiz; `folderId` contra a lista (null remove da pasta)
  handle('meetings:set-folder', async (_e, rawDir: string, folderId: unknown) => {
    try {
      await setMeetingFolder((await loadSettings()).root, rawDir, folderId);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });

  handle('meetings:set-template', async (_e, rawDir: string, templateId: string) => {
    try {
      const dir = await checkedDir(rawDir);
      const template = await getTemplate((await loadSettings()).root, String(templateId ?? ''));
      if (!template) throw new Error(t('err.template-not-found'));
      await updateMeta(dir, (meta) => ({ ...meta, templateId: template.id }));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });

  handle('app:permission-status', () => ({
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
  }));

  // URL fixa: o renderer nunca escolhe o que abrir.
  handle('app:open-privacy', () => shell.openExternal(systemPanelUrl('microphone')));

  // URLs fixas: o renderer nunca escolhe o que abrir.
  handle('app:open-internet-accounts', () => shell.openExternal('x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension'));
  handle('app:open-calendar-privacy', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'));
  handle('app:open-reminders-privacy', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders'));
  // Lembretes de hoje (EKReminder): lidos só no Mac, mostrados no Início e nunca enviados à IA
  const remindersEnabled = async () => remindersSupported() && (await loadSettings()).showReminders !== false;
  handle('reminders:status', async () => ({ access: remindersAccess, enabled: remindersSupported() && (await remindersEnabled()) }));
  handle('reminders:request', () => {
    if (remindersAccess === 'notDetermined') detector?.requestRemindersAccess(); // a resposta chega por 'reminders:changed'
    return { access: remindersAccess };
  });
  handle('reminders:list', async () => {
    const enabled = await remindersEnabled();
    const items = enabled && remindersAccess === 'granted' && detector ? await detector.listReminders() : [];
    return { access: remindersAccess, enabled, items };
  });
  handle('reminders:complete', async (_e, id: unknown) => ({ ok: typeof id === 'string' && id.length > 0 && id.length < 200 && remindersAccess === 'granted' && detector ? await detector.completeReminder(id) : false }));
  handle('reminders:set-enabled', async (_e, on: unknown) => {
    await saveSettings({ ...(await loadSettings()), showReminders: on !== false });
    send('reminders:changed', null);
    return { ok: true as const };
  });
  handle('calendar:eventkit-status', () => ({ access: calendarAccess }));
  handle('calendar:eventkit-request', () => {
    if (calendarAccess === 'notDetermined') detector?.requestCalendarAccess(); // a resposta chega por 'calendar-access'
    return { access: calendarAccess };
  });
  handle('calendar:google-status', async () => ({
    ...(await googleAuth.status()),
    calendars: calendarFeed.calendarCount(),
    error: calendarFeed.lastError,
  }));
  handle('calendar:google-save-client', (_e, id: string, secret: string) => googleAuth.saveClient(String(id ?? ''), String(secret ?? '')));
  handle('calendar:google-connect', async () => {
    const result = await googleAuth.connect();
    if (result.ok) await calendarFeed.refresh();
    return result;
  });
  handle('calendar:google-disconnect', async () => {
    calendarFeed.invalidate(); // descarta refresh em andamento antes de apagar as credenciais
    await googleAuth.disconnect();
    await calendarFeed.refresh();
    return { ok: true as const };
  });
  handle('alert:action', (e, action: string) => {
    const entry = [...alertWindows.entries()].find(([, w]) => !w.isDestroyed() && w.webContents === e.sender);
    if (!entry || !alertScheduler) return; // só as janelinhas de aviso podem agir
    const [key] = entry;
    const ev = alertScheduler.eventFor(key);
    alertScheduler.dismiss(key);
    if (!ev) return;
    if (action === 'join') startFromCalendar(ev, true);
    else if (action === 'record') startFromCalendar(ev, false);
  });
  handle('calendar:events', () => calendarFeed.events());
  handle('calendar:open-link', (_e, url: string) => openJoinUrl(String(url ?? '')));

  // ---- provedores de IA: o renderer nunca recebe segredo, só hasKey e os 4 últimos caracteres ----
  handle('ai:status', async () => {
    const settings = await currentAiSettings();
    const notice = (await loadSettings()).aiNotices?.geminiSub ? 'gemini-discontinued' : null;
    return { ...(await aiStatus(settings, aiDeps())), light: settings.light, lightModel: (await lightModelFor(settings, undefined, () => cachedAgyModels({ binary: agyBinary(), workDir: app.getPath('userData') }, false))) ?? null, notice };
  });
  // o aviso aparece até a tela de IA mostrá-lo uma vez: aí o renderer chama isto e ele some
  handle('ai:dismiss-notice', async () => {
    const settings = await loadSettings();
    if (settings.aiNotices?.geminiSub) {
      const { geminiSub: _gone, ...rest } = settings.aiNotices;
      await saveSettings({ ...settings, aiNotices: rest });
    }
    return { ok: true as const };
  });
  handle('ai:set-light', async (_e, value: unknown) => {
    const v = String(value ?? '').trim();
    const provider = (await currentAiSettings()).provider;
    if (v !== 'auto' && v !== 'same' && !isModelFor(provider, v)) return { ok: false as const, message: t('err.model-invalid') };
    await updateAiSettings((ai) => ({ ...ai, light: v }));
    return { ok: true as const };
  });

  handle('ai:set-provider', async (_e, provider: unknown) => {
    invalidateAiStatus();
    if (!isProvider(provider)) return { ok: false as const, message: t('err.provider-unknown') };
    await updateAiSettings((ai) => ({ ...ai, provider }));
    return { ok: true as const };
  });

  handle('ai:save-key', async (_e, provider: unknown, raw: unknown) => {
    invalidateAiStatus();
    if (!isProvider(provider) || !hasKeyField(provider)) return { ok: false as const, message: t('err.provider-no-key') };
    const valid = validateKey(provider, String(raw ?? ''));
    if (!valid.ok) return { ok: false as const, message: valid.message };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false as const, message: t('err.keychain') };
    await saveSecret(app.getPath('userData'), provider, valid.key, tokenCrypto);
    await updateAiSettings((ai) => ({ ...ai, verified: { ...ai.verified, [provider]: undefined } })); // a conexão mudou: testar de novo
    return { ok: true as const, last4: valid.key.slice(-4) };
  });

  handle('ai:clear-key', async (_e, provider: unknown) => {
    invalidateAiStatus();
    if (!isProvider(provider) || !hasKeyField(provider)) return { ok: false as const, message: t('err.provider-no-key') };
    await clearSecret(app.getPath('userData'), provider);
    await updateAiSettings((ai) => ({ ...ai, verified: { ...ai.verified, [provider]: undefined } }));
    return { ok: true as const };
  });

  handle('ai:test', async (_e, provider: unknown) => {
    invalidateAiStatus();
    if (!isProvider(provider)) return { ok: false as const, message: t('err.provider-unknown') };
    const result = await testProvider(provider, await currentAiSettings(), aiDeps());
    await updateAiSettings((ai) => ({ ...ai, verified: { ...ai.verified, [provider]: result.ok } }));
    return result;
  });

  handle('ai:list-models', async (_e, provider: unknown) => {
    if (!isProvider(provider)) return { ok: false as const, message: t('err.provider-unknown') };
    return listModels(provider, aiDeps());
  });

  // modelos que o menu de IA do chat oferece para um provedor (o OpenCode consulta a CLI; o ChatGPT lê o cache do codex)
  handle('ai:model-catalog', async (_e, provider: unknown) => {
    if (!isProvider(provider)) return { ok: false as const, message: t('err.provider-unknown') };
    const models = await modelCatalog(provider, {
      opencode: async () => {
        const r = await listModels('opencode-sub', aiDeps());
        return r.ok ? r.models : [];
      },
      agy: async () => {
        const r = await listModels('agy-sub', aiDeps());
        return r.ok ? r.models.map((id) => ({ id, label: id })) : [];
      },
    });
    return { ok: true as const, models };
  });

  handle('ai:set-model', async (_e, provider: unknown, model: unknown) => {
    if (!isProvider(provider)) return { ok: false as const, message: t('err.provider-unknown') };
    const value = String(model ?? '').trim();
    if (value && !isModelFor(provider, value)) return { ok: false as const, message: t('err.model-invalid') };
    await updateAiSettings((ai) => {
      const { [provider]: _old, ...models } = ai.models;
      return { ...ai, models: value ? { ...models, [provider]: value } : models };
    });
    return { ok: true as const };
  });

  handle('settings:choose-root', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: t('dialog.choose-root') });
    if (result.canceled || !result.filePaths[0]) return loadSettings();
    const settings = { ...(await loadSettings()), root: result.filePaths[0] };
    await saveSettings(settings);
    return settings;
  });

  handle('meetings:repair', async (_e, rawDir: string) => {
    try {
      const dir = await checkedDir(rawDir);
      if (await readMetaIfUsable(dir)) return { ok: true as const, meta: await readMeta(dir) }; // já está bom
      return { ok: true as const, meta: await repairMeta(dir) };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  });
  handle('meetings:list', async () => {
    const { root } = await loadSettings();
    const dirs = await listMeetingDirs(root);
    const metas = await Promise.all(
      dirs.map(async (dir) => {
        // R-52: meta ilegível não derruba a lista: a reunião aparece como "precisa de reparo" (título e data pelo nome da pasta)
        return (await readMetaIfUsable(dir).then((m) => (m ? { dir, ...m } : null))) ?? (await damagedEntry(dir).catch(() => null));
      }),
    );
    return metas.filter((m) => m !== null).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  });

  // busca no conteúdo: o índice fica em memória e é atualizado por data de modificação a cada consulta
  handle('search:query', (_e, query: unknown) =>
    handleSearch({ root: async () => (await loadSettings()).root, folders: readFolders, index: searchIndex }, query).catch((err) => {
      logError('search failed', err);
      return [];
    }),
  );

  // "Nova reunião" / "Nova war room" sem título e sem agenda reaproveitam o rascunho vazio mais recente (não criam mais uma pasta)
  handle('meetings:create', async (_e, title: string, calendarEventId?: string, folderId?: string, kind?: string) => {
    const { root, defaultTemplateId } = await loadSettings();
    const inFolder = typeof folderId === 'string' && folderId && (await folderExists(root, folderId)) ? folderId : null;
    const warroom = kind === 'warroom' ? 'warroom' : undefined;
    const eventId = typeof calendarEventId === 'string' && calendarEventId ? calendarEventId : undefined;
    const draft = !eventId && !(typeof title === 'string' && title.trim()) ? await findEmptyDraft(root) : null;
    let dir: string;
    if (draft) {
      dir = draft;
      await reuseDraft(dir, { startedAt: new Date(), ...(inFolder ? { folderId: inFolder } : {}), ...(warroom ? { kind: warroom } : {}) });
    } else {
      ({ dir } = await createMeeting(root, {
        title,
        startedAt: new Date(),
        trigger: 'manual',
        state: 'draft',
        ...(eventId ? { calendarEventId: eventId } : {}),
        ...(inFolder ? { folderId: inFolder } : {}),
        templateId: (await resolveTemplate(root, defaultTemplateId)).id,
      }));
      if (warroom) await writeWarRoomConfig(dir, { ...(await readWarRoomConfig(dir)), kind: 'warroom' });
    }
    await rememberParticipants(dir, eventId);
    return dir;
  });
  // ao sair de uma reunião: se ela ficou vazia (rascunho), vai para a Lixeira em silêncio; a que está gravando nunca
  handle('meetings:discard-draft', async (_e, rawDir: unknown) => {
    const dir = await checkedDir(rawDir);
    if (!canDeleteMeeting({ sessionState: session?.state ?? 'idle', currentDir: session?.currentDir ?? null, dir })) return { ok: false as const };
    return { ok: await discardEmptyDraft(dir, (d) => shell.trashItem(d)) };
  });

  handle('meetings:read', async (_e, rawDir: string) => {
    const dir = await checkedDir(rawDir);
    return {
    meta: await readMeta(dir),
    transcript: await readMeetingText(dir, 'transcript'),
    annotations: await readMeetingText(dir, 'annotations'),
    notes: await readMeetingText(dir, 'notes'),
    chat: await readChat(dir),
    };
  });

  // dar nome a "Pessoa N": vale para a reunião toda (meta.speakers); nome vazio remove
  handle('meetings:set-speaker-name', async (_e, rawDir: string, id: unknown, name: unknown) => {
    const dir = await checkedDir(rawDir);
    const key = String(Math.trunc(Number(id)));
    if (!/^[1-9]\d?$/.test(key)) return { ok: false as const, message: t('err.speaker-invalid') };
    const clean = cleanSpeakerName(name);
    const speakers = await setSpeakerName(dir, Number(key), clean);
    return { ok: true as const, speakers };
  });
  // sugestão da IA pelo contexto da conversa; só devolve, nunca aplica
  handle('meetings:suggest-speakers', async (_e, rawDir: string) => {
    try {
      const dir = await checkedDir(rawDir);
      const meta = await readMeta(dir);
      const { language } = await notesLanguageOf(meta);
      const transcript = await chatTranscript(dir, await readMeetingText(dir, 'transcript'), 'obrigado, valeu, thanks', language);
      return { ok: true as const, suggestions: await suggestSpeakerNames(lightRunner ?? runner, transcript, language) };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  });
  handle('meetings:notes-progress', async (_e, rawDir: string) => notesProgress.get(await checkedDir(rawDir)) ?? null);
  handle('meetings:save-annotations', async (_e, rawDir: string, text: string) => {
    const dir = await checkedDir(rawDir);
    const meta = await readMeta(dir);
    return saveAnnotations(dir, String(text ?? ''), new Date(), meta.state === 'recording');
  });

  handle('meetings:rename', async (_e, dir: string, title: string) => {
    try {
      const meta = await renameMeeting(await checkedDir(dir), String(title ?? ''));
      return { ok: true as const, title: meta.title };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });

  handle('meetings:delete', async (_e, dir: string) => {
    try {
      const { root } = await loadSettings();
      await deleteMeetingDir({ dir, root, sessionState: session?.state ?? 'idle', currentDir: session?.currentDir ?? null, trash: (d) => shell.trashItem(d) });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  });

  handle('meetings:reveal', async (_e, dir: string) => shell.openPath(await checkedDir(dir)));

  handle('chat:ask', async (event, id: number, rawDir: string, question: string) => {
    const controller = new AbortController();
    chats.set(id, controller);
    try {
      const dir = await checkedDir(rawDir);
      const answer = await chatAnswer(runner, dir, question, controller.signal, (text) => event.sender.send('chat:delta', id, text));
      return { ok: true as const, answer };
    } catch (err) {
      const kind = err instanceof AiError ? err.kind : 'other';
      return { ok: false as const, kind, message: (err as Error).message };
    } finally {
      chats.delete(id);
    }
  });

  // ---- compartilhar: copiar notas (HTML + Markdown), rascunho de e-mail, Mail e PDF ----
  // texto puro para a área de transferência pelo main: a página não tem permissão de clipboard (hardening nega tudo)
  handle('clipboard:write-text', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 200_000) return false;
    clipboard.writeText(text);
    return true;
  });
  handle('share:copy-notes', (_e, dir: unknown) => copyNotes(shareDeps(runner), dir, 'rich'));
  handle('share:copy-markdown', (_e, dir: unknown) => copyNotes(shareDeps(runner), dir, 'markdown'));
  handle('share:email-draft', async (_e, id: number, dir: unknown) => {
    const controller = new AbortController();
    chats.set(id, controller);
    try {
      return await draftEmail(shareDeps(runner), dir, controller.signal);
    } finally {
      chats.delete(id);
    }
  });
  handle('share:open-mail', (_e, draft: unknown) => openMail(shareDeps(runner), draft));
  handle('share:export-info', (_e, dir: unknown) => exportInfo(shareDeps(runner), dir));
  handle('share:export-pdf', async (_e, dir: unknown, options: unknown) => {
    const result = await exportPdf(shareDeps(runner), dir, (options ?? {}) as Record<string, unknown>);
    return result.ok ? { ...result, display: tildify(result.path) } : result;
  });
  // "Alterar…": escolhe a pasta no diálogo nativo e lembra para as próximas vezes
  handle('share:choose-export-dir', async () => {
    const options = { title: t('dialog.save-pdf'), defaultPath: await exportDir(), properties: ['openDirectory' as const, 'createDirectory' as const] };
    const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { ok: true as const, canceled: true as const, folder: tildify(await exportDir()) };
    await saveSettings({ ...(await loadSettings()), exportDir: result.filePaths[0] });
    return { ok: true as const, folder: tildify(result.filePaths[0]) };
  });
  handle('share:reveal-export', (_e, path: unknown) => {
    if (typeof path !== 'string' || path !== lastExport) return { ok: false as const };
    shell.showItemInFolder(path);
    return { ok: true as const };
  });

  // chat entre reuniões: o escopo é validado no main; o streaming usa o mesmo 'chat:delta' do chat da reunião
  handle('gchat:history', async () => readGlobalConversation((await loadSettings()).root));
  handle('gchat:new', async () => {
    await startNewGlobalConversation((await loadSettings()).root);
    return { ok: true as const };
  });
  handle('gchat:ask', async (event, id: number, question: unknown, scope: unknown) => {
    const controller = new AbortController();
    chats.set(id, controller);
    try {
      return await askAcrossMeetings(
        {
          root: async () => (await loadSettings()).root,
          folders: readFolders,
          index: searchIndex,
          runner,
          language: async () => ((await currentUiLanguage()) === 'en' ? 'en' : 'pt'),
          noMeetings: (lang) => t('gchat.none', undefined, lang === 'en' ? 'en' : 'pt-BR'),
          fallbackNotice: (lang) => t('gchat.fallback', undefined, lang === 'en' ? 'en' : 'pt-BR'),
          noMeetingsInPeriod: (lang) => t('gchat.none-period', undefined, lang === 'en' ? 'en' : 'pt-BR'),
          useTools: async () => (await loadSettings()).chatTools === true,
        },
        question,
        scope,
        controller.signal,
        (text) => event.sender.send('chat:delta', id, text),
      );
    } finally {
      chats.delete(id);
    }
  });

  handle('chat:cancel', (_e, id: number) => chats.get(id)?.abort());
}

/**
 * R-56: uma instância só usa o microfone e a pasta das reuniões. A segunda traz a primeira para a frente e encerra
 * (o bloqueio é por `--user-data-dir`, então uma instância de teste isolada não conflita com a do dia a dia).
 */
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      if (!BENCH) window.show();
      window.focus();
    } else {
      createWindow();
    }
  });
}

// instâncias de teste/medição (RICE_BENCH ou --user-data-dir próprio) usam um Keychain falso: rodam isoladas, sem acesso ao
// Keychain do usuário, e o macOS mostrava "Chaves Não Encontradas" na tela dele a cada abertura
const TEST_INSTANCE = BENCH || process.env.RICE_MOCK_KEYCHAIN === '1' || process.argv.some((a) => a.startsWith('--user-data-dir'));
if (TEST_INSTANCE && process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');

// renderers sempre em sandbox (os preloads só usam contextBridge/ipcRenderer) e toda janela, inclusive a do PDF, travada
app.enableSandbox();
app.on('web-contents-created', (_e, contents) => lockdownWebContents(contents, RENDERER_DIR));

app.whenReady().then(async () => {
  if (!singleInstance) return; // a segunda instância só espera o `quit`
  // nenhuma permissão de página (câmera, microfone do navegador, localização, notificações...): o áudio é capturado pelo
  // processo nativo e as notificações são do próprio Electron; downloads por página também ficam bloqueados
  void loadSettings().then(({ root }) => tightenAppData(root, app.getPath('userData'))).catch(() => {}); // corrige o que foi criado antes com 0755/0644
  const ses = electronSession.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  if (isWindows()) {
    app.setAppUserModelId('com.rice.app'); // avisos e agrupamento na barra de tarefas
    nativeTheme.on('updated', () => {
      if (window && !window.isDestroyed()) window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors, window.webContents.getZoomFactor()));
    });
  }
  if (BENCH) app.dock?.hide();
  if (appIconPath) {
    const image = nativeImage.createFromPath(appIconPath);
    if (!image.isEmpty()) app.dock?.setIcon(image);
  }
  uiLanguageNow = await currentUiLanguage();
  setLanguage(uiLanguageNow);
  buildAppMenu();
  await migrateLegacyToken(app.getPath('userData')).catch((err) => logError('token migration', err));
  const runner = createActiveRunner(currentAiSettings, aiDeps());
  lightRunner = createLightRunner(currentAiSettings, aiDeps());
  configureLongNotes({
    lightRunner,
    ...(typeof cachedSettings.notesDirectMaxChars === 'number' && cachedSettings.notesDirectMaxChars >= 5_000 ? { directMaxChars: cachedSettings.notesDirectMaxChars } : {}),
    onProgress: (p) => {
      if (p.phase === 'done') notesProgress.delete(p.dir);
      else notesProgress.set(p.dir, p);
      send('session:notes-progress', p);
    },
  });
  registerIpc(runner);
  const asr = setupSession(runner);
  if (!BENCH) {
    createTray();
    nub = createNub();
  }
  try {
    const result = await recoverInterrupted((await loadSettings()).root);
    recoveredCount = (Array.isArray(result) ? result : result.recovered).length;
  } catch (err) {
    logError('recovery failed', err);
  }
  createWindow();
  setupDetector();
  const sendCalendar = (channel: string) => window && !window.isDestroyed() && window.webContents.send(channel, null);
  calendarFeed.on('change', () => sendCalendar('calendar:changed'));
  googleAuth.on('disconnected', () => {
    sendCalendar('calendar:disconnected');
    void calendarFeed.refresh();
  });
  powerMonitor.on('suspend', () => session?.suspend());
  powerMonitor.on('resume', () => {
    session?.resume();
    void calendarFeed.refresh();
    void refreshEventKit();
  });
  alertScheduler = new AlertScheduler({
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    isRecording: () => session?.state !== 'idle',
    show: showAlert,
  });
  calendarFeed.on('change', () => alertScheduler?.update(calendarFeed.events()));
  calendarFeed.start();
  setInterval(() => void refreshEventKit(), 5 * 60_000).unref();
  setTimeout(() => void asr.warmup(), 2000);
  // monta o índice de busca em segundo plano, para a primeira busca já encontrar tudo
  void loadSettings().then(({ root }) => searchIndex.refresh(root)).catch((err) => logError('search index', err));
  app.on('activate', createWindow);

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    detector?.stop();
    alertScheduler?.dispose();
    calendarFeed.stop();
    nub?.dispose();
    void (async () => {
      try {
        if (session?.state === 'recording') await session.stop({ quick: true }); // saída: prazo curto para a fila de transcrição
        await session?.drain();
      } catch (err) {
        logError('stop on quit failed', err);
      }
      await asr.stop().catch(() => {});
      app.quit();
    })();
  });
});

// O Rice continua na barra de menu quando a janela fecha.
app.on('window-all-closed', () => {});
