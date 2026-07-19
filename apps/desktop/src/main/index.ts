import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, Notification, powerMonitor, safeStorage, session, shell, systemPreferences } from 'electron';
import { lockDownSession, defaultSessionAllows, audioSessionAllows } from './security/permissions';
import { join } from 'node:path';
import { configureCalendars, configureFormat, localDateKey, STRINGS, type AgentEvent, type Settings } from '@apollo/shared';
import { createTray, getTray } from './tray';
import { AUDIO_SESSION_PARTITION, createAudioWindow, createOnboardingWindow, closeOnboardingWindow, createOrbWindow, openCaptureWindow, openSettingsWindow, openWorkspaceWindow, getWorkspaceWindow } from './windows';
import { createTodayProvider } from './workspace/today';
import { type CardPayload, type WorkspaceNavigate } from '@apollo/shared';
import { createOrbController } from './orbController';
import { createWorkerHost } from './voice/workerHost';
import { createVoiceController } from './voice/voiceController';
import { createTtsPipeline } from './voice/tts/pipeline';
import { createEdgeTts } from './voice/tts/edge';
import { FakeTts } from './voice/tts/fake';
import { createDeepgramStt } from './voice/sttDeepgram';
import { FakeStt, type FakeSttFixture } from './voice/sttFake';
import { wavToFrames } from './voice/wav';
import { readFileSync, rmSync } from 'node:fs';
import { AUDIO_PORT_CHANNEL, type VoiceState } from '@apollo/shared';
import { createLogger, readLogTail } from './logger';
import { loadConfig } from './config';
import { openDb } from './db/connection';
import { migrate } from './db/migrate';
import { createRepos } from './db/repos/index';
import { createSettingsService } from './settingsService';
import { createSecrets, createKeyTester, safeStorageCodec } from './security/secrets';
import { createEgressPolicy } from './net/egress';
import { createBreaker } from './net/breaker';
import { createHttpClient } from './net/httpClient';
import { createRegistry } from './tools/registry';
import { createTimerTools } from './tools/timer';
import { createAlarmTools } from './tools/alarm';
import { createNoteTools } from './tools/note';
import { createContactTools } from './tools/contact';
import { createMemoryTools } from './tools/memory';
import { createUndoTool } from './tools/undo';
import { createCalendarTools } from './tools/calendar';
import { createReminderTools } from './tools/reminder';
import { createNewsTool, createLlmSummarizer, DEFAULT_FEEDS } from './tools/news';
import { createFilesTool } from './tools/files';
import { createSystemTools, spawnRunner } from './tools/system';
import { createWeatherTools } from './tools/weather';
import { createSearchWebTool } from './tools/searchWeb';
import { createLinkTools } from './tools/link';
import { createLinkReader } from './net/linkReader';
import { createGCalModule } from './gcal/module';
import { createGoogleClient } from './gcal/googleClient';
import { isVoiceBusy, canDrainIndex } from './voice/fsmPriority';
import { createEmailTools } from './tools/email';
import { createBriefTool } from './tools/brief';
import { createScreenTool, readScreenContext } from './tools/screen';
import { createAppOpenTool } from './tools/appOpen';
import { createProactiveTools } from './tools/proactive';
import { createProactiveController, isDNDNow, type ProactiveController } from './proactive/controller';
import { createQuickCaptureService } from './quickCapture/service';
import { createBackup, listBackups, recoverIfCorrupt, backupsDir } from './db/backup';
import { exportZip, importZip } from './data/exportImport';
import { writeFileSync } from 'node:fs';
import { createEmbedder } from './memory/embedderFactory';
import { createIndexer } from './memory/indexer';
import { createRecall } from './memory/recall';
import { createRecallTool } from './tools/recall';
import { initUpdater } from './updater';
import { createEmailService } from './security/emailService';
import { createDailyBrief } from './scheduler/dailyBrief';
import { createOrchestrator, type Orchestrator } from './agent/orchestrator';
import { createConversationManager } from './agent/conversationManager';
import { buildSystemPrompt } from './agent/systemPrompt';
import { createAnthropicLlm } from './agent/llmAnthropic';
import { createBackendLlm } from './agent/llmBackend';
import { byokAllowedFromEnv, resolveMode } from './auth/mode';
import { createSession } from './auth/session';
import { runSignInFlow } from './auth/signInFlow';
import { createBackendSearch, createBackendSttToken } from './auth/transports';
import { createScheduler } from './scheduler/scheduler';
import { registerRouter, makeTrustedUrlCheck, pushTo } from './ipc/router';
import { createThrottle } from './ipc/throttle';
import { shouldWarnUsage } from './net/usageWarn';
import { buildHandlers } from './ipc/handlers/index';
import { registerHotkey, unregisterAll } from './shortcuts';
import { hotkeyConflictAdvice } from './hotkeyAdvice';
import { userInfo } from 'node:os';

// PART K: second-instance/activate open the Workspace (the palette is gone);
// boot() fills this in once settings-backed bounds are available.
let openWorkspaceRef: (() => void) | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // H7 single instance: a second launch focuses/opens the Workspace, then exits.
  app.on('second-instance', () => {
    const ws = getWorkspaceWindow();
    if (ws && !ws.isDestroyed()) { ws.show(); ws.focus(); }
    else openWorkspaceRef?.();
  });
  void app.whenReady().then(boot);
  app.on('window-all-closed', () => {
    /* tray app: keep running */
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWorkspaceRef?.();
  });
  app.on('will-quit', () => unregisterAll());
}

function boot(): void {
  const bootStart = Date.now(); // H8 boot spans
  if (process.platform === 'darwin') app.dock?.hide();

  const dev = !app.isPackaged;
  let lastActivityMs = Date.now(); // C19: drives brief deferral (input in last 10 min)
  const userData = app.getPath('userData');
  const logger = createLogger({ logDir: join(userData, 'logs'), dev });

  // H3 permission lockdown: default session denies everything; audio window gets
  // a dedicated session allowing only media (audio).
  lockDownSession(session.defaultSession, defaultSessionAllows, (m) => logger.warn(m));
  lockDownSession(session.fromPartition(AUDIO_SESSION_PARTITION), audioSessionAllows, (m) => logger.warn(m));
  const log = (msg: string): void => logger.info(msg);
  logger.info({ dev }, 'apollo booting');

  const config = loadConfig({ dotEnvPath: join(app.getAppPath(), '../../.env') });
  const inMemory = dev && process.env['APOLLO_SMOKE'] === '1';
  const dbPath = join(userData, 'apollo.db');

  // H2 boot integrity: quick_check, and on failure quarantine + restore newest backup.
  let corruptRecovery: ReturnType<typeof recoverIfCorrupt> | null = null;
  if (!inMemory) {
    const rec = recoverIfCorrupt(dbPath, userData);
    if (rec.recovered !== 'ok') {
      corruptRecovery = rec;
      logger.warn({ rec }, 'db corruption recovered');
    }
  }

  const db = openDb(inMemory ? ':memory:' : dbPath);
  const schemaVersion = migrate(db, {
    // H2 pre-migrate backup: snapshot before applying any pending migration.
    onBeforeMigrate: inMemory ? undefined : () => { try { createBackup(dbPath, userData, 'pre-migrate'); } catch { /* best effort */ } },
  });
  logger.info({ schemaVersion }, 'db ready');
  const bootDbReadyMs = Date.now() - bootStart; // recorded to perf_spans once repos exist

  if (corruptRecovery) {
    void app.whenReady().then(() => {
      void dialog.showMessageBox({ type: 'warning', title: STRINGS.app.name, message: STRINGS.errors.DB_CORRUPT });
    });
  }

  // H2 weekly auto-backup: on boot (and the daily scheduler tick) if the newest
  // auto backup is older than 7 days and backup.autoWeekly is on.
  const maybeAutoBackup = (): void => {
    if (inMemory || !settings.get().backup.autoWeekly) return;
    const newestAuto = listBackups(userData).find((b) => b.reason === 'auto');
    if (!newestAuto || Date.now() - newestAuto.createdAt > 7 * 86_400_000) {
      try { createBackup(dbPath, userData, 'auto'); } catch { /* best effort */ }
    }
  };

  const repos = createRepos(db);
  // Forward reference: the proactive controller is created later but settings.onChange
  // (which can fire during boot) must not touch it before it exists.
  let proactiveRef: ProactiveController | null = null;
  let quickCaptureRef: ReturnType<typeof createQuickCaptureService> | null = null;
  let reRegisterHotkeys: (() => void) | null = null;
  const onHotkeyPress = (): void => {
    // PART K: the hotkey is push-to-talk only; typed input lives in the Chat tab.
    if (settings.get().ptt.enabled && !voiceController.isVoiceDisabled()) {
      ensureWorker(); // H8: PTT spawns the audio worker on demand
      voiceController.onHotkey();
    }
  };
  // I2: keep format.ts's context in step with locale/timeFormat/weekStart so
  // every spoken template and tool string formats consistently.
  const applyFormat = (s: Settings): void => {
    configureFormat({
      locale: s.locale.region ?? app.getLocale(),
      timeFormat: s.profile.timeFormat,
      weekStart: s.profile.weekStart,
    });
    configureCalendars(s.calendars.active);
  };
  const settings = createSettingsService(repos.settings, {
    onChange: (next, prev) => {
      applyFormat(next);
      if (next.voice.pttHotkey !== prev.voice.pttHotkey || next.quickCapture.hotkey !== prev.quickCapture.hotkey) reRegisterHotkeys?.();
      if (next.wake.sensitivity !== prev.wake.sensitivity) workerHost.send({ t: 'setSensitivity', v: next.wake.sensitivity });
      if (JSON.stringify(next.proactive) !== JSON.stringify(prev.proactive)) proactiveRef?.reconfigure();
      if (next.history.enabled !== prev.history.enabled) indexer.onHistoryToggled(next.history.enabled); // G3/G7 immediate purge
      // E7: broadcast so open views re-render on units/timeFormat/weekStart/profile changes.
      // workspaceBounds churns on every drag; exclude it from the broadcast.
      if (JSON.stringify({ ...next, workspaceBounds: null }) !== JSON.stringify({ ...prev, workspaceBounds: null })) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) pushTo(win.webContents, 'settings.changed', next);
        }
      }
    },
  });
  applyFormat(settings.get()); // seed format context at boot
  const secrets = createSecrets({ settings: repos.settings, codec: safeStorageCodec(safeStorage), env: config.env, log });
  const testKey = createKeyTester({ secrets, model: settings.get().anthropic.model });

  const emailService = createEmailService({
    repos,
    codec: safeStorageCodec(safeStorage),
    clientId: () => config.env['GOOGLE_CLIENT_ID'] ?? null,
    clientSecret: () => config.env['GOOGLE_CLIENT_SECRET'] ?? null,
    openExternal: (url) => void shell.openExternal(url),
    log,
  });

  const egress = createEgressPolicy(() => repos.feeds.list().map((f) => new URL(f.url).hostname));
  // H4: use Electron's net.fetch transport (system proxy, PAC, OS cert store) while
  // preserving the httpClient interface, breaker, and egress allowlist.
  const http = createHttpClient({ egress, breaker: createBreaker(), fetchFn: (url, init) => net.fetch(url as string, init), log });
  // I4 user-link lane: the ONLY egress path that reaches arbitrary public hosts,
  // and only for user-provided links via link.read/link.preview. It replaces the
  // C14.9 allowlist with the SSRF guard; nothing else may use it.
  const linkReader = createLinkReader({ fetchFn: (url, init) => net.fetch(url as string, init) as unknown as Promise<Response>, log });

  // H6 ringing overlay: push to the orb + OS notification. DND suppresses sound only.
  function ringAlert(kind: 'timer' | 'alarm', id: string, label: string | null, body: string): void {
    const silent = isDNDNow(settings.get(), Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now());
    if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'alert.ringing', { kind, id, label, firedAt: Date.now(), silent });
    const n = new Notification({ title: STRINGS.app.name, body });
    n.on('click', () => { if (!orbWindow.isDestroyed()) orbWindow.showInactive(); });
    n.show();
  }

  const scheduler = createScheduler({
    repos,
    onTimerFire: (t) => ringAlert('timer', t.id, t.label, STRINGS.spoken.timerDone(t.label)),
    onReminderFire: (r) => {
      // Reminders route to Workspace Today on click (not a ringing overlay).
      const n = new Notification({ title: STRINGS.app.name, body: STRINGS.spoken.reminderFired(r.text) });
      n.on('click', () => openWorkspace({ view: 'today' }));
      n.show();
    },
    onAlarmFire: (a) => ringAlert('alarm', a.id, a.label, STRINGS.spoken.alarmFired(a.label)),
    log,
  });

  repos.feeds.seed(DEFAULT_FEEDS);
  if (settings.get().approvedDirs.length === 0) {
    settings.patch({
      approvedDirs: [app.getPath('documents'), app.getPath('desktop'), app.getPath('downloads')],
    });
  }

  // L0.2 mode: BYOK only when the build permits it AND a real key exists;
  // otherwise managed (backend transport, no provider keys on the device).
  const byokAllowed = byokAllowedFromEnv(process.env);
  const appMode = resolveMode({ allowByok: byokAllowed, hasProviderKey: secrets.has('anthropic') });
  log(`operating mode: ${appMode}`);

  const egressCheckedFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!egress.isAllowedUrl(url)) {
      log(`egress blocked: ${url}`);
      return Promise.reject(new Error('egress blocked'));
    }
    return fetch(input, init);
  }) as typeof fetch;

  // L1 session: refresh token in safeStorage, access token in memory only.
  const authSession = createSession({
    baseUrl: config.backendBaseUrl,
    fetchFn: egressCheckedFetch,
    loadRefreshToken: () => secrets.getSessionToken(),
    saveRefreshToken: (t) => secrets.setSessionToken(t),
    runSignInFlow: () =>
      runSignInFlow({
        baseUrl: config.backendBaseUrl,
        authorizeUrl: config.oidcAuthorizeUrl,
        clientId: config.oidcClientId,
        fetchFn: egressCheckedFetch,
      }),
    onChange: (state) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) pushTo(win.webContents, 'auth.state', state);
    },
    log,
  });

  /**
   * L0.2 transport selection. Both branches satisfy the same LlmClient, so the
   * orchestrator, tools, and voice code below are identical in either mode.
   */
  const llm =
    appMode === 'byok'
      ? createAnthropicLlm({
          apiKey: () => secrets.get('anthropic'),
          model: () => settings.get().anthropic.model,
          fetchFn: egressCheckedFetch,
          log,
        })
      : createBackendLlm({
          baseUrl: config.backendBaseUrl,
          getAccessToken: () => authSession.getAccessToken(),
          fetchFn: egressCheckedFetch,
          log,
        });

  // G1/G3 semantic memory: on-device embedder + background indexer.
  const { embedder, adapterState: embedderState } = createEmbedder({
    settings: () => settings.get(),
    modelDir: join(__dirname, '../../resources/models'),
    log,
  });
  let activeTurns = 0; // gate the indexer: drain only when no turn is running and voice is idle
  const indexer = createIndexer({
    repos,
    embedder,
    historyEnabled: () => settings.get().history.enabled,
    indexEnabled: () => settings.get().memory.indexEnabled,
    canDrain: () => activeTurns === 0 && canDrainIndex(voiceController.state()), // J3: idle or muted, never listening/thinking/speaking/followup
    log,
  });
  const recall = createRecall({ chunks: repos.chunks, repos, embedder });

  const registry = createRegistry(
    [
      ...createTimerTools({ timers: repos.timers, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createAlarmTools({ alarms: repos.alarms, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
      ...createContactTools({ contacts: repos.contacts, undo: repos.undo }),
      ...createMemoryTools({
        memory: repos.memory,
        undo: repos.undo,
        embedder,
        onFactSaved: (f) => indexer.onFactSaved(f),
        onFactForgotten: (id) => indexer.onFactForgotten(id),
      }),
      createUndoTool(repos, { onUndone: (what, convId) => repos.actionLog.record({ tool: 'undo.last', summary: what, outcome: 'undone', convId }) }),
      ...createCalendarTools({ events: repos.events, undo: repos.undo, defaultCalendarId: () => settings.get().calendars.defaultCalendarId }),
      ...createReminderTools({ reminders: repos.reminders, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createWeatherTools({
        http,
        getHome: () => settings.get().profile.homePlace,
        getUnits: () => settings.get().profile.units,
      }),
      createSearchWebTool({
        http,
        getBraveKey: () => secrets.get('brave'),
        // Managed mode proxies search through the backend (which holds the key).
        ...(appMode === 'managed'
          ? { managedSearch: createBackendSearch({ baseUrl: config.backendBaseUrl, getAccessToken: () => authSession.getAccessToken(), fetchFn: egressCheckedFetch, log }) }
          : {}),
      }),
      ...createLinkTools({ reader: linkReader, allowLinkReading: () => settings.get().allowLinkReading }),
      createRecallTool({ recall, tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone }),
      createNewsTool({ http, feeds: repos.feeds, summarize: createLlmSummarizer(llm) }),
      createFilesTool({ getApprovedDirs: () => settings.get().approvedDirs }),
      ...createEmailTools({ provider: () => emailService.provider(), contacts: repos.contacts, needsReauth: () => emailService.needsReauth() }),
      createBriefTool({ getTool: (n) => registry.get(n), emailConnected: () => emailService.isConnected() }),
      createScreenTool({ run: spawnRunner() }),
      createAppOpenTool({ openWorkspace: (target) => openWorkspace(target) }),
      ...createProactiveTools({
        getSettings: () => settings.get(),
        setSettings: (next) => settings.set(next),
        status: () => proactiveRef?.status() ?? { enabledRules: [], remainingBudget: 0 },
        undo: repos.undo,
      }),
      ...createSystemTools({
        run: spawnRunner(),
        openPath: (p) => shell.openPath(p),
        picturesDir: () => app.getPath('pictures'),
      }),
    ],
    { perf: (turnId, name, durMs) => repos.perf.record(turnId, name, durMs), log },
  );

  const orbWindow = createOrbWindow();
  const orbController = createOrbController(orbWindow);

  let lastBriefCard: CardPayload | null = null;
  const todayProvider = createTodayProvider({
    http,
    getHome: () => settings.get().profile.homePlace,
    getUnits: () => settings.get().profile.units,
    getLatestBrief: () => lastBriefCard,
  });

  // E3 Workspace: single instance, bounds persisted in the settings blob under a
  // reserved key; opened from tray, orb menu, app.open tool, and card deep links.
  function openWorkspace(target?: WorkspaceNavigate): void {
    const win = openWorkspaceWindow({
      getBounds: () => settings.get().workspaceBounds ?? null,
      saveBounds: (b) => settings.patch({ workspaceBounds: b }),
    });
    const nav = (): void => {
      if (target) pushTo(win.webContents, 'workspace.navigate', target);
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', nav);
    else nav();
  }
  openWorkspaceRef = () => openWorkspace({ view: settings.get().workspace.defaultView });

  // H4 usage warn card: at most once per local day when Anthropic tokens cross the limit.
  let lastUsageWarnDay: string | null = null;
  function maybeWarnUsage(): void {
    const limit = settings.get().usage.warnDailyAnthropicTokens;
    const today = localDateKey(Date.now()); // YYYY-MM-DD local
    const total = repos.usageLog.todayTotal('anthropic', 'inputTokens') + repos.usageLog.todayTotal('anthropic', 'outputTokens');
    const decision = shouldWarnUsage({ todayTotalTokens: total, limit, today, lastWarnedDay: lastUsageWarnDay });
    lastUsageWarnDay = decision.lastWarnedDay;
    if (decision.warn) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) pushTo(win.webContents, 'agent.events', { type: 'card', card: { kind: 'text', body: STRINGS.usage.warnCard } });
      }
    }
  }

  function emitToAll(event: AgentEvent): void {
    orbController.onAgentEvent(event);
    if (voiceTurnActive && event.type === 'token') ttsPipeline.feedToken(event.text);
    if (event.type === 'card' && event.card.kind === 'brief') lastBriefCard = event.card; // E3.1 latest brief
    if (event.type === 'turnStart') activeTurns += 1;
    if (event.type === 'done' || event.type === 'error') {
      activeTurns = Math.max(0, activeTurns - 1);
      indexer.pump(); // G3: let the index queue drain now the turn is over
      if (voiceTurnActive) {
        voiceTurnActive = false;
        ttsPipeline.endTurn();
      }
      if (!ttsPipeline.isActive()) voiceController.turnDone(); // text-only reply → idle
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) pushTo(win.webContents, 'agent.events', event);
    }
  }

  // E2 live sync: every repo mutation (agent tools and Workspace IPC alike)
  // fans out to all open windows within the same event-loop tick.
  repos.bus.subscribe((change) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) pushTo(win.webContents, 'data.changed', change);
    }
  });

  // Screen context (C8.3): cached + refreshed asynchronously so the CONTEXT
  // block carries activeApp/selectedText without spawning osascript in the hot
  // path (speed invariant B2.1). The screen.context tool reads it on demand.
  let lastScreen: { app: string; title: string; selectedText: string } | null = null;
  const refreshScreen = (): void => {
    void readScreenContext({ run: spawnRunner() })
      .then((s) => {
        if (!s.permissionMissing) lastScreen = { app: s.app, title: s.title, selectedText: s.selectedText };
      })
      .catch(() => undefined);
  };

  const orchestrator: Orchestrator = createOrchestrator({
    registry,
    repos,
    llm,
    systemPrompt: () => buildSystemPrompt(userInfo().username || 'the user'),
    emit: emitToAll,
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    historyEnabled: () => settings.get().history.enabled,
    onNewConversation: () => conversationManager.startNew(), // H5
    onUndone: (what, convId) => repos.actionLog.record({ tool: 'undo.last', summary: what, outcome: 'undone', convId }), // I3
    onMessagePersisted: (m) => indexer.onMessagePersisted(m),
    onAction: (e) => repos.actionLog.record(e), // H3 audit trail
    onUsage: (e) => {
      repos.usageLog.add('anthropic', 'inputTokens', e.inputTokens);
      repos.usageLog.add('anthropic', 'outputTokens', e.outputTokens);
      maybeWarnUsage(); // H4: one warning card per day when over the configured limit
    },
    buildContext: () => {
      const c: Record<string, string> = {};
      if (lastScreen?.app) c.activeApp = lastScreen.app + (lastScreen.title ? ` — ${lastScreen.title}` : '');
      if (lastScreen?.selectedText) c.selectedText = lastScreen.selectedText.slice(0, 500);
      return c;
    },
    log,
  });

  // Audio worker (C12.2): FakeWake unless a Picovoice key exists (C17 auto mode)
  const wakeMode = settings.get().adapters.wake;
  const picovoiceKey = secrets.get('picovoice');
  const useRealWake = wakeMode === 'real' || (wakeMode === 'auto' && picovoiceKey !== null);
  const workerHost = createWorkerHost({
    modulePath: join(__dirname, 'audioWorker.js'),
    env: {
      APOLLO_VAD_MODEL: join(__dirname, '../../resources/silero_vad.onnx'),
      APOLLO_WAKE: useRealWake ? 'porcupine' : 'fake',
      ...(picovoiceKey ? { APOLLO_PICOVOICE_KEY: picovoiceKey } : {}),
      APOLLO_WAKE_KEYWORD_PATH: join(__dirname, '../../resources/hey_apollo.ppn'),
      APOLLO_WAKE_SENSITIVITY: String(settings.get().wake.sensitivity),
    },
    onMessage: (msg) => voiceController.onWorkerMessage(msg),
    onDisabled: () => {
      new Notification({ title: STRINGS.app.name, body: STRINGS.notifications.voiceDisabled }).show();
    },
    log,
  });
  function pushVoiceState(state: VoiceState): void {
    if (state === 'idle') indexer.pump(); // G3: index queue may drain once voice is idle
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) pushTo(win.webContents, 'voice.state', { state });
    }
  }

  // STT adapter selection (C17 auto): real STT when we have a credential source
  // — a local key in BYOK, or the backend's short-lived scoped token in managed
  // mode (L0.1) — else FakeSTT fixtures.
  const sttMode = settings.get().adapters.stt;
  const managedSttToken = createBackendSttToken({
    baseUrl: config.backendBaseUrl,
    getAccessToken: () => authSession.getAccessToken(),
    fetchFn: egressCheckedFetch,
    log,
  });
  const sttCredential = (): string | null | Promise<string | null> =>
    appMode === 'byok' ? secrets.get('deepgram') : managedSttToken();
  const useRealStt = sttMode === 'real' || (sttMode === 'auto' && (appMode === 'managed' || secrets.get('deepgram') !== null));
  const sttAdapter = useRealStt
    ? createDeepgramStt({ apiKey: sttCredential, resolveProxy: (url) => session.defaultSession.resolveProxy(url), log })
    : new FakeStt(loadVoiceFixtures());

  function loadVoiceFixtures(): FakeSttFixture[] {
    try {
      return readFileSync(join(app.getAppPath(), '../../eval/voice_fixtures.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as FakeSttFixture);
    } catch {
      return [];
    }
  }

  // TTS pipeline (C12.5): edge is keyless, so 'auto' means real unless forced fake
  const ttsAdapter = settings.get().adapters.tts === 'fake' ? new FakeTts() : createEdgeTts({ voice: () => settings.get().tts.voice, rate: () => settings.get().voice.ttsRate, log });
  const ttsPipeline = createTtsPipeline({
    adapter: ttsAdapter,
    pushAudio: (p) => {
      if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'tts.audio', p);
    },
    pushStop: () => {
      if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'tts.stop', {});
    },
    onFirstChunk: () => voiceController.ttsStarted(),
    onSentence: (index) => {
      if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'tts.spoken', { index });
    },
    onError: (copy) => new Notification({ title: STRINGS.app.name, body: copy }).show(),
    onSynthChars: (chars) => repos.usageLog.add('tts', 'characters', chars), // H4
    perf: (name, dur) => repos.perf.record('voice', name, dur),
    log,
  });
  let voiceTurnActive = false;

  // H5 one-brain conversation lifecycle (main owns the active id).
  const conversationManager = createConversationManager({ onRotate: (id) => log(`conversation rotated → ${id}`) });
  const voiceController = createVoiceController({
    stt: sttAdapter,
    workerSend: (m) => workerHost.send(m),
    onAudioSeconds: (s) => repos.usageLog.add('deepgram', 'seconds', s), // H4
    getFollowupWindowSec: () => settings.get().voice.followupWindowSec, // H5
    dispatch: (text) => {
      voiceTurnActive = true;
      ttsPipeline.beginTurn();
      orchestrator.handleUserMessage({ text, source: 'voice', convId: conversationManager.forTurn() });
    },
    pushState: pushVoiceState,
    pushPartial: (transcript, rms) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) pushTo(win.webContents, 'voice.partial', { transcript, rms });
      }
    },
    playEarcon: (name) => log(`earcon: ${name}`), // audible earcons play in the orb on voice.state changes
    stopTts: () => ttsPipeline.stop(),
    notify: (copy) => new Notification({ title: STRINGS.app.name, body: copy }).show(),
    log,
  });

  // H8 lazy init: spawn the audio worker only when wake is enabled at boot; PTT
  // (onHotkey) starts it on demand otherwise, so a text-only user pays no worker cost.
  const ensureWorker = (): void => { if (!workerHost.isRunning()) workerHost.start(); };
  if (settings.get().wake.enabled) workerHost.start();

  ipcMain.on(AUDIO_PORT_CHANNEL, (event) => {
    const trusted = makeTrustedUrlCheck(process.env['ELECTRON_RENDERER_URL']);
    if (!event.senderFrame || !trusted(event.senderFrame.url)) {
      log('audio.port dropped: untrusted sender');
      return;
    }
    const port = event.ports[0];
    if (port) workerHost.attachAudioPort(port);
  });
  createAudioWindow();

  // C14.10 "Wipe all data": delete the DB + safeStorage secrets and relaunch.
  function wipeAllData(): void {
    try {
      secrets.wipeAll();
      emailService.revoke();
      db.close();
      const dbPath = join(userData, 'apollo.db');
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          rmSync(dbPath + suffix, { force: true });
        } catch {
          /* best effort */
        }
      }
    } catch (e) {
      log(`wipe failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    app.relaunch();
    app.exit(0);
  }

  // I7 Google Calendar sync module. Inert unless googleCalendar.enabled; the
  // calendar-scope token is not yet wired (see HUMAN_TODO for live auth), so
  // makeClient returns null and the module stays fully inert until connected.
  const pushGoogleState = (s: { status: 'idle' | 'syncing' | 'error'; lastSyncTs: number | null; message?: string }): void => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) pushTo(win.webContents, 'google.state', s);
  };
  const getCalendarToken = async (): Promise<string | null> => null; // HUMAN_TODO: incremental calendar-scope grant
  const gcal = createGCalModule({
    repos,
    getSettings: () => settings.get(),
    setSettings: (s) => settings.set(s),
    makeClient: () =>
      settings.get().googleCalendar.enabled
        ? createGoogleClient({
            http,
            getAccessToken: getCalendarToken,
            // Egress-guarded: the Calendar client may only reach allowlisted Google hosts.
            fetchFn: (url, init) => {
              if (!egress.isAllowedUrl(url as string)) throw new Error(`egress blocked: ${url as string}`);
              return net.fetch(url as string, init) as unknown as Promise<Response>;
            },
          })
        : null,
    pushState: pushGoogleState,
    // I7.4: surface conflicts as a card on the orb with Keep mine / theirs / both.
    onConflict: (c) =>
      emitToAll({
        type: 'card',
        card: { kind: 'syncConflict', eventId: c.eventId, localTitle: c.local.title, localStart: c.local.startTs, remoteTitle: c.remote.title, remoteStart: c.remote.startTs },
      }),
    revoke: async () => {
      /* HUMAN_TODO: revoke the calendar scope via oauth2.googleapis.com/revoke */
    },
    log,
  });

  const handlers = buildHandlers({
    orchestrator: () => orchestrator,
    repos,
    settings,
    secrets,
    testKey,
    setMuted: (on) => voiceController.setMuted(on),
    activeConvId: () => conversationManager.forTurn(), // H5 one-brain
    currentConvId: () => conversationManager.current(), // K2: pure read for the Chat tab
    setActiveConversation: (id) => conversationManager.setActive(id),
    newConversation: () => conversationManager.startNew(),
    listDevices: async () => {
      // H7: the audio window holds mic permission, so enumerateDevices returns labels.
      const audio = createAudioWindow();
      try {
        const raw = (await audio.webContents.executeJavaScript(
          `navigator.mediaDevices.enumerateDevices().then(ds => ds.map(d => ({ kind: d.kind, deviceId: d.deviceId, label: d.label })))`,
        )) as Array<{ kind: string; deviceId: string; label: string }>;
        const map = (k: string): Array<{ deviceId: string; label: string }> =>
          raw.filter((d) => d.kind === k).map((d) => ({ deviceId: d.deviceId, label: d.label || 'Device' }));
        return { inputs: map('audioinput'), outputs: map('audiooutput') };
      } catch {
        return { inputs: [], outputs: [] };
      }
    },
    alertAction: (kind, id, action, snoozeMin) => {
      if (action === 'snooze') {
        const min = snoozeMin ?? (kind === 'alarm' ? 10 : 5);
        const at = Date.now() + min * 60_000;
        // Snooze a one-shot alert; a recurring alarm keeps its own schedule (C19/H6).
        if (kind === 'timer') { const t = repos.timers.start({ label: repos.timers.get(id)?.label ?? null, endsAt: at }); void t; }
        else repos.alarms.set({ label: repos.alarms.get(id)?.label ?? null, atTs: at });
        scheduler.rearm();
      }
      if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'alert.stop', { id });
    },
    onUserActivity: () => {
      lastActivityMs = Date.now();
      dailyBrief.noteActivity();
      refreshScreen(); // refresh for the NEXT turn's CONTEXT; non-blocking
    },
    ttsDrained: () => voiceController.ttsFinished(),
    adapterStates: () => ({
      stt: useRealStt ? 'deepgram' : 'fake',
      tts: settings.get().adapters.tts === 'fake' ? 'fake' : 'edge',
      wake: useRealWake ? 'porcupine' : 'fake',
      llm: secrets.get('anthropic') ? 'anthropic' : 'no-key',
      embedder: embedderState,
    }),
    indexQueueDepth: () => repos.chunks.pendingEmbedding(1000).length,
    recallQuery: (req) =>
      recall.search({
        query: req.query,
        ...(req.kinds ? { kinds: req.kinds } : {}),
        ...(req.sinceIso ? { sinceIso: req.sinceIso } : {}),
        limit: req.limit,
      }),
    memoryIndexStats: () => {
      const k = repos.chunks.countByKind();
      return {
        note: k.note, message: k.message, fact: k.fact,
        total: repos.chunks.count(),
        pending: repos.chunks.pendingEmbedding(100_000).length,
        sizeBytes: repos.chunks.sizeBytes(),
        enabled: settings.get().memory.indexEnabled,
        embedder: embedderState,
      };
    },
    memoryRebuild: () => {
      if (!settings.get().memory.indexEnabled) settings.patch({ memory: { indexEnabled: true } });
      indexer.rebuild();
    },
    memoryClear: () => {
      indexer.clear();
      settings.patch({ memory: { indexEnabled: false } });
    },
    backupNow: () => {
      try {
        const dest = createBackup(dbPath, userData, 'manual');
        return { ok: true, filename: dest.split('/').pop() };
      } catch (e) {
        log(`backup failed: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false };
      }
    },
    backupList: () => listBackups(userData),
    backupRestore: async (filename) => {
      const src = join(backupsDir(userData), filename);
      const res = await dialog.showMessageBox({
        type: 'warning', buttons: ['Cancel', 'Restore & relaunch'], defaultId: 1, cancelId: 0,
        title: STRINGS.app.name, message: STRINGS.settings.privacy.restoreConfirm(filename),
      });
      if (res.response !== 1) return { ok: true as const };
      createBackup(dbPath, userData, 'manual'); // safety snapshot of current state
      db.close();
      for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix, { force: true }); } catch { /* best effort */ } }
      writeFileSync(dbPath, readFileSync(src));
      app.relaunch();
      app.exit(0);
      return { ok: true as const };
    },
    exportRun: async (includeConversations) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Apollo data', defaultPath: `apollo-export-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      if (canceled || !filePath) return { path: null };
      const { buffer } = exportZip(repos, settings.get(), { includeConversations });
      writeFileSync(filePath, buffer);
      return { path: filePath };
    },
    importRun: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Apollo data', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      if (canceled || !filePaths[0]) return { counts: null };
      const counts = importZip(repos, readFileSync(filePaths[0]));
      return { counts };
    },
    logTail: (lines) => readLogTail(join(userData, 'logs', 'apollo.log'), lines),
    egressHosts: () => egress.allowedHosts(),
    wipeAllData: () => wipeAllData(),
    finishOnboarding: (opts) => {
      const firstTime = !settings.get().onboarded;
      settings.patch({ onboarded: true });
      // I6: opt-in welcome note, seeded once. A real, editable, deletable note.
      if (firstTime && opts.seedWelcomeNote && repos.notes.list({ limit: 1 }).length === 0) {
        repos.notes.save({ content: STRINGS.onboarding.welcomeNote });
      }
      closeOnboardingWindow();
      openWorkspace({ view: 'chat' }); // K4: finish opens the Workspace at Chat
    },
    requestPermission: async (kind) => {
      if (process.platform !== 'darwin') return true;
      if (kind === 'mic') {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'granted') return true;
        return systemPreferences.askForMediaAccess('microphone');
      }
      // Accessibility: prompts once; returns current trust state.
      return systemPreferences.isTrustedAccessibilityClient(true);
    },
    oauthConnect: () => emailService.connect(),
    oauthRevoke: () => emailService.revoke(),
    oauthStatus: () => ({ connected: emailService.isConnected(), address: emailService.address(), needsReauth: emailService.needsReauth() }),
    openWorkspace: (target) => openWorkspace(target),
    openSettings: () => openSettingsWindow(),
    todayData: () => todayProvider.get(),
    geocode: async (query, countryCode) => {
      // E6/E7 geocoding autocomplete through the egress-checked http client.
      // When a country is chosen, over-fetch then filter to that country_code.
      try {
        const count = countryCode ? 20 : 5;
        const data = (await http.getJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}&language=en`,
        )) as { results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string; country_code?: string; timezone?: string }> };
        return (data.results ?? [])
          .filter((r) => !countryCode || (r.country_code ?? '').toUpperCase() === countryCode.toUpperCase())
          .slice(0, 8)
          .map((r) => ({
            label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
            city: r.name,
            lat: r.latitude,
            lon: r.longitude,
            tz: r.timezone ?? 'auto',
            countryCode: (r.country_code ?? '').toUpperCase(),
          }));
      } catch {
        return [];
      }
    },
    linkPreview: async (url) => {
      // I4 Notes affordance: a direct user action on a URL they authored → SSRF +
      // policy gate apply (via the reader), no substring gate needed.
      if (!settings.get().allowLinkReading) return { ok: false as const, url, title: '', summary: '', siteName: '', error: 'disabled' };
      const r = await linkReader.read(url, { previewOnly: true });
      return { ok: r.ok, url: r.url, title: r.title || r.siteName, summary: r.text, siteName: r.siteName, ...(r.error ? { error: r.error } : {}) };
    },
    googleConnect: () => gcal.connect(),
    googleApplySelection: (req) => {
      gcal.applySelection(req.calendars, req.direction);
      gcal.start();
      void gcal.sync();
    },
    googleDisconnect: (keepLocal) => gcal.disconnect(keepLocal),
    googleSync: () => gcal.sync(),
    googleResolveConflict: (req) => gcal.resolveConflict(req.eventId, req.choice),
    // K2 "Speak this": a typed conversation can be listened to on demand.
    speakText: (text) => {
      ttsPipeline.beginTurn();
      ttsPipeline.feedToken(text);
      ttsPipeline.endTurn();
    },
    // K2 dictation-into-composer: transcripts stream to the Chat composer, never auto-send.
    dictationStart: async () => {
      ensureWorker(); // H8: dictation spawns the audio worker on demand, like PTT
      return voiceController.startDictation((text, final) => {
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) pushTo(win.webContents, 'dictation.text', { text, final });
      });
    },
    dictationStop: () => voiceController.stopDictation(),
    // L1 accounts: main owns the tokens; the renderer only ever sees state.
    authSignIn: () => authSession.signIn(),
    authSignOut: () => authSession.signOut(),
    authUsage: async () => {
      const token = await authSession.getAccessToken();
      if (!token) return { used: 0, limit: 0, resetIso: '' };
      try {
        const res = await egressCheckedFetch(`${config.backendBaseUrl}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) return { used: 0, limit: 0, resetIso: '' };
        const body = (await res.json()) as { usage?: { used: number; limit: number; resetIso: string } };
        return body.usage ?? { used: 0, limit: 0, resetIso: '' };
      } catch {
        return { used: 0, limit: 0, resetIso: '' };
      }
    },
    appMode: () => appMode,
    checkForUpdates: async () => (app.isPackaged ? { status: 'checking' as const } : { status: 'disabled' as const }),
    installUpdate: () => updaterHandle?.install(),
    resourceReport: () =>
      app.getAppMetrics().map((m) => ({
        type: m.type + (m.serviceName ? `:${m.serviceName}` : ''),
        rssMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024), // KB → MB
      })),
    suggestionAction: (suggestionId, actionId) => proactiveRef?.handleAction(suggestionId, actionId),
    openCapture: () => openCaptureWindow(),
    captureSubmit: (req) => {
      if (!quickCaptureRef) throw new Error('capture not ready');
      return quickCaptureRef.submit(req);
    },
    captureClassify: (req) => quickCaptureRef?.classify(req) ?? { suggestedType: 'note', reminderAvailable: false, reminderIso: null, timePhrase: null, texts: { note: req.text, todo: req.text, reminder: req.text } },
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    debugWake: () => voiceController.onWake(),
    debugInjectAudio: async (wavPath) => {
      // A2.2a: drives wake → listen → EOT with mic-identical frames.
      voiceController.onWake();
      await new Promise((r) => setTimeout(r, 30));
      voiceController.onWorkerMessage({ t: 'vad', speech: true });
      for (const f of wavToFrames(wavPath)) {
        voiceController.onWorkerMessage({ t: 'frame', pcm: f.buffer as ArrayBuffer });
        await new Promise((r) => setTimeout(r, 2));
      }
      voiceController.onWorkerMessage({ t: 'vad', speech: false });
    },
    log,
  });
  registerRouter(ipcMain, handlers, {
    isTrustedUrl: makeTrustedUrlCheck(process.env['ELECTRON_RENDERER_URL']),
    isDev: dev,
    throttle: createThrottle(), // H3 per-channel per-sender token buckets
    log,
  });

  createTray({
    onOpenSettings: () => openSettingsWindow(),
    onOpenWorkspace: () => openWorkspace({ view: 'today' }),
    onOpenChat: () => openWorkspace({ view: 'chat' }),
    onQuickCapture: () => openCaptureWindow(),
  });
  // H8 boot spans: tray + db-ready + windows recorded to perf_spans (budget: boot_to_tray p95 < 2500ms).
  repos.perf.record('boot', 'boot_db_ready', bootDbReadyMs);
  const trayMs = Date.now() - bootStart;
  repos.perf.record('boot', 'boot_to_tray', trayMs);
  repos.perf.record('boot', 'boot_windows_lazy', Date.now() - bootStart);
  // PART K: the global hotkey is push-to-talk only (the palette is gone; typing
  // lives in the Workspace Chat tab). H7: never silently lose the hotkey.
  if (!registerHotkey(settings.get().voice.pttHotkey, onHotkeyPress, log)) {
    new Notification({ title: STRINGS.app.name, body: hotkeyConflictAdvice(settings.get().voice.pttHotkey, process.platform) }).show();
  }

  // First run (C18): show the 4-step onboarding until completed.
  if (!settings.get().onboarded && process.env['APOLLO_SMOKE'] !== '1') {
    createOnboardingWindow();
  }

  // I7: start the 15-min sync tick when Google is connected; sync on focus if stale.
  if (gcal.enabled()) gcal.start();
  app.on('browser-window-focus', () => void gcal.onFocus());

  // C14.8 auto-updates (packaged builds only).
  let updaterHandle: Awaited<ReturnType<typeof initUpdater>> | null = null;
  void initUpdater({
    isPackaged: app.isPackaged,
    notify: (title, body) => new Notification({ title, body }).show(),
    onState: (status, version) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) pushTo(win.webContents, 'update.state', { status, ...(version ? { version } : {}) });
      }
    },
    log,
  }).then((h) => { updaterHandle = h; });

  const missed = scheduler.start();
  const missedCount = missed.timers.length + missed.reminders.length + missed.alarms.length;
  if (missedCount > 0) {
    new Notification({ title: STRINGS.notifications.whileAwayTitle, body: STRINGS.spoken.whileAway(missedCount) }).show();
  }

  // C19 daily brief: fires at the configured time if the user is active, else
  // defers to their next interaction; "good morning" also triggers it (fast path).
  const dailyBrief = createDailyBrief({
    getBriefTimeHHMM: () => settings.get().brief.timeHHMM,
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    isUserActive: () => Date.now() - lastActivityMs < 10 * 60_000,
    runBrief: () => {
      orchestrator.handleUserMessage({ text: 'good morning', source: 'voice', convId: conversationManager.forTurn() });
    },
    log,
  });
  dailyBrief.start();

  // F3 proactive engine: deterministic, local-only nudges gated by the governor.
  const proactive = createProactiveController({
    repos,
    settings: () => settings.get(),
    saveSettings: (next) => settings.set(next),
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    gmailConnected: () => emailService.isConnected(),
    voiceBusy: () => isVoiceBusy(voiceController.state()), // J2: followup/waking defer nudges too
    // Cross-app fullscreen detection isn't exposed by Electron; conservatively false
    // (never suppress a nudge for a fullscreen we can't observe). See HUMAN_TODO.
    isFullscreen: () => false,
    push: (payload) => {
      // I6: the very first proactive nudge ever is preceded by a one-time explainer.
      const firstNudge = !settings.get().firstNudgeSeen;
      if (firstNudge) settings.patch({ firstNudgeSeen: true });
      if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'suggestion.show', { ...payload, silent: payload.silent ?? false, ...(firstNudge ? { firstNudge: true } : {}) });
    },
    notify: (title, body) => new Notification({ title, body }).show(),
    speak: (line) => {
      if (!voiceController.isVoiceDisabled() && voiceController.state() === 'idle') {
        ttsPipeline.beginTurn();
        ttsPipeline.feedToken(line);
        ttsPipeline.endTurn();
      }
    },
    navigate: (target) => openWorkspace(target),
    isDND: () => isDNDNow(settings.get(), Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now()),
    // needs_reply (F3.3): read-only Gmail search for unreplied inbound threads.
    emailNeedingReply: async (staleHours) => {
      const p = emailService.provider();
      if (!p.isConnected()) return [];
      const days = Math.max(1, Math.ceil(staleHours / 24));
      const items = await p.list(`is:unread to:me -in:sent older_than:${days}d`, 3);
      return items.map((m) => ({ from: m.from, subject: m.subject })); // inert text only
    },
    // weather_heads_up (F3.3): max precip probability over the next 12h at home.
    weatherPrecipNext12h: async () => {
      const home = settings.get().profile.homePlace;
      if (!home) return null;
      try {
        const data = (await http.getJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${home.lat}&longitude=${home.lon}&hourly=precipitation_probability&forecast_days=1`,
        )) as { hourly?: { precipitation_probability?: number[] } };
        const probs = (data.hourly?.precipitation_probability ?? []).slice(0, 12);
        return probs.length ? Math.max(...probs) : null;
      } catch {
        return null;
      }
    },
    log,
  });
  proactive.start();
  proactiveRef = proactive;
  indexer.start(); // G3: boot rescan + DataBus-driven note indexing
  // J3 unified resume: fire missed scheduler items (grouped, recomputed from
  // absolute targets), catch up proactive, and sync gcal if stale.
  powerMonitor.on('resume', () => {
    proactive.onResume();
    scheduler.catchUp();
    void gcal.onFocus();
  });

  // H7 battery pause: when on battery and pauseWakeOnBattery, disable wake
  // detection (sensitivity 0); PTT still works. Restore on AC.
  const applyBatteryWakePolicy = (): void => {
    const paused = settings.get().voice.pauseWakeOnBattery && powerMonitor.isOnBatteryPower();
    workerHost.send({ t: 'setSensitivity', v: paused ? 0 : settings.get().wake.sensitivity });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) pushTo(win.webContents, 'voice.state', { state: voiceController.state() });
    }
  };
  powerMonitor.on('on-battery', applyBatteryWakePolicy);
  powerMonitor.on('on-ac', applyBatteryWakePolicy);
  applyBatteryWakePolicy();

  // F4 Quick Capture: global-hotkey micro-window; classify + save through the repos.
  const quickCapture = createQuickCaptureService({
    repos,
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    defaultType: () => settings.get().quickCapture.defaultType,
    onReminderArmed: () => scheduler.rearm(),
  });
  quickCaptureRef = quickCapture;
  // registerHotkey() unregisters all shortcuts then registers the PTT hotkey,
  // so the capture hotkey must be (re-)added right after. reRegisterHotkeys does both.
  reRegisterHotkeys = (): void => {
    registerHotkey(settings.get().voice.pttHotkey, onHotkeyPress, log);
    try {
      globalShortcut.register(settings.get().quickCapture.hotkey, () => openCaptureWindow());
    } catch (e) {
      log(`quick-capture hotkey failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  reRegisterHotkeys();

  if (process.env['APOLLO_SMOKE'] === '1') {
    orbWindow.webContents.once('did-finish-load', () => {
      // Drives a real turn over the bridge: IPC → router → orchestrator →
      // fast path → timer tool → agent.events back to the renderer. PART K:
      // the typed path is chat.send (the palette is gone).
      const script = `(async () => {
        if (typeof window.apollo !== 'object' || typeof window.apollo.call !== 'function') return 'no-bridge';
        const events = [];
        window.apollo.on('agent.events', (e) => events.push(e.type));
        const active0 = await window.apollo.call('conversations.active', {});
        const res = await window.apollo.call('chat.send', { text: 'set a timer for 5 minutes', convId: active0.id });
        await new Promise((r) => setTimeout(r, 500));
        const active = events.includes('turnStart') && events.includes('card') && events.includes('done');
        if (!(res.turnId && active)) return 'turn-bad:' + events.join(',');
        // E-phase one-brain: write via Workspace channel, read it back over IPC + live data.changed.
        let changed = 0;
        window.apollo.on('data.changed', (c) => { if (c.entity === 'note') changed++; });
        const saved = await window.apollo.call('notes.save', { content: 'Smoke test note\\nbody line' });
        const list = await window.apollo.call('notes.list', { limit: 10 });
        const seen = list.some((n) => n.id === saved.id && n.title === 'Smoke test note');
        await window.apollo.call('workspace.open', { view: 'today' });
        await new Promise((r) => setTimeout(r, 100));
        // F4 Quick Capture: classify (reminder detection) + submit a todo, verify it appears live (zero LLM).
        const cls = await window.apollo.call('capture.classify', { text: 'call mom tomorrow at 6' });
        const cap = await window.apollo.call('capture.submit', { text: 'file quarterly taxes', type: 'todo' });
        // L2: a captured to-do becomes a checklist item on the list note.
        const listNote = await window.apollo.call('notes.get', { id: cap.id });
        const captureOk = cls.suggestedType === 'reminder' && cap.ok && listNote.content.includes('file quarterly taxes');
        if (!seen || changed === 0) return 'workspace-bad:seen=' + seen + ',changed=' + changed;
        return captureOk ? 'turn-ok' : 'capture-bad:cls=' + cls.suggestedType + ',ok=' + cap.ok;
      })()`;
      const idleClickThrough = orbController.isClickThrough(); // sampled before the turn activates the orb
      void orbWindow.webContents
        .executeJavaScript(script)
        .then((result: string) => {
          const orbOk = !orbWindow.isDestroyed() && orbWindow.isAlwaysOnTop() && !orbWindow.isFocused();
          const activeInteractive = !orbController.isClickThrough(); // turn just ran: orb must be interactive during linger
          const ws = getWorkspaceWindow();
          const wsOk = ws !== null && !ws.isDestroyed();
          // Confirm the Workspace React tree actually rendered (catches a renderer
          // module-eval throw, e.g. a CJS dep like rrule failing to import).
          void (wsOk ? ws.webContents.executeJavaScript('document.getElementById("root")?.childElementCount > 0') : Promise.resolve(false))
            .then((rendered: boolean) => {
              // eslint-disable-next-line no-console
              console.log(
                `SMOKE_OK tray=${getTray() !== null} e2e=${result} orb=${orbOk} clickThroughIdle=${idleClickThrough} interactiveActive=${activeInteractive} workspace=${wsOk} wsRendered=${rendered} boot_to_tray=${trayMs}`,
              );
              app.exit(result === 'turn-ok' && orbOk && idleClickThrough && activeInteractive && wsOk && rendered ? 0 : 1);
            });
        })
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.log(`SMOKE_FAIL ${e instanceof Error ? e.message : String(e)}`);
          app.exit(1);
        });
    });
  }

  maybeAutoBackup(); // H2 weekly auto-backup check on boot

  logger.info({ tools: registry.all().length, strings: Object.keys(STRINGS).length }, 'apollo ready');
}
