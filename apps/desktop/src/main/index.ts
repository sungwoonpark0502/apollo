import { app, BrowserWindow, globalShortcut, ipcMain, Notification, powerMonitor, safeStorage, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { STRINGS, type AgentEvent } from '@apollo/shared';
import { createTray, getTray } from './tray';
import { createAudioWindow, createOnboardingWindow, closeOnboardingWindow, createOrbWindow, createPaletteWindow, openCaptureWindow, openSettingsWindow, openWorkspaceWindow, getWorkspaceWindow, togglePalette } from './windows';
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
import { AUDIO_PORT_CHANNEL, newId, type VoiceState } from '@apollo/shared';
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
import { createTodoTools } from './tools/todo';
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
import { createEmailTools } from './tools/email';
import { createBriefTool } from './tools/brief';
import { createScreenTool, readScreenContext } from './tools/screen';
import { createAppOpenTool } from './tools/appOpen';
import { createProactiveTools } from './tools/proactive';
import { createProactiveController, isDNDNow, type ProactiveController } from './proactive/controller';
import { createQuickCaptureService } from './quickCapture/service';
import { createEmbedder } from './memory/embedderFactory';
import { createIndexer } from './memory/indexer';
import { initUpdater } from './updater';
import { createEmailService } from './security/emailService';
import { createDailyBrief } from './scheduler/dailyBrief';
import { createOrchestrator, type Orchestrator } from './agent/orchestrator';
import { buildSystemPrompt } from './agent/systemPrompt';
import { createAnthropicLlm } from './agent/llmAnthropic';
import { createScheduler } from './scheduler/scheduler';
import { registerRouter, makeTrustedUrlCheck, pushTo } from './ipc/router';
import { buildHandlers } from './ipc/handlers/index';
import { registerHotkey, unregisterAll } from './shortcuts';
import { userInfo } from 'node:os';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => togglePalette());
  void app.whenReady().then(boot);
  app.on('window-all-closed', () => {
    /* tray app: keep running */
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPaletteWindow();
  });
  app.on('will-quit', () => unregisterAll());
}

function boot(): void {
  if (process.platform === 'darwin') app.dock?.hide();

  const dev = !app.isPackaged;
  let lastActivityMs = Date.now(); // C19: drives brief deferral (input in last 10 min)
  const userData = app.getPath('userData');
  const logger = createLogger({ logDir: join(userData, 'logs'), dev });
  const log = (msg: string): void => logger.info(msg);
  logger.info({ dev }, 'apollo booting');

  const config = loadConfig({ dotEnvPath: join(app.getAppPath(), '../../.env') });
  const db = openDb(dev && process.env['APOLLO_SMOKE'] === '1' ? ':memory:' : join(userData, 'apollo.db'));
  const schemaVersion = migrate(db);
  logger.info({ schemaVersion }, 'db ready');

  const repos = createRepos(db);
  // Forward reference: the proactive controller is created later but settings.onChange
  // (which can fire during boot) must not touch it before it exists.
  let proactiveRef: ProactiveController | null = null;
  let quickCaptureRef: ReturnType<typeof createQuickCaptureService> | null = null;
  let reRegisterHotkeys: (() => void) | null = null;
  const onHotkeyPress = (): void => {
    togglePalette();
    if (settings.get().ptt.enabled && !voiceController.isVoiceDisabled()) voiceController.onHotkey();
  };
  const settings = createSettingsService(repos.settings, {
    onChange: (next, prev) => {
      if (next.hotkey !== prev.hotkey || next.quickCapture.hotkey !== prev.quickCapture.hotkey) reRegisterHotkeys?.();
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
  const http = createHttpClient({ egress, breaker: createBreaker(), log });

  const scheduler = createScheduler({
    repos,
    onTimerFire: (t) => {
      new Notification({ title: STRINGS.app.name, body: STRINGS.spoken.timerDone(t.label) }).show();
    },
    onReminderFire: (r) => {
      new Notification({ title: STRINGS.app.name, body: STRINGS.spoken.reminderFired(r.text) }).show();
    },
    onAlarmFire: (a) => {
      new Notification({ title: STRINGS.app.name, body: STRINGS.spoken.alarmFired(a.label) }).show();
    },
    log,
  });

  repos.feeds.seed(DEFAULT_FEEDS);
  if (settings.get().approvedDirs.length === 0) {
    settings.patch({
      approvedDirs: [app.getPath('documents'), app.getPath('desktop'), app.getPath('downloads')],
    });
  }

  // Streams through the egress-checked fetch; throws KEY_MISSING (mapped to
  // Settings > Keys copy) until a key exists, while fast path and tools work.
  const llm = createAnthropicLlm({
    apiKey: () => secrets.get('anthropic'),
    model: () => settings.get().anthropic.model,
    fetchFn: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!egress.isAllowedUrl(url)) {
        log(`egress blocked (llm): ${url}`);
        return Promise.reject(new Error('egress blocked'));
      }
      return fetch(input, init);
    }) as typeof fetch,
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
    canDrain: () => activeTurns === 0 && voiceController.state() === 'idle',
    log,
  });

  const registry = createRegistry(
    [
      ...createTimerTools({ timers: repos.timers, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createAlarmTools({ alarms: repos.alarms, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
      ...createTodoTools({ todos: repos.todos, undo: repos.undo }),
      ...createContactTools({ contacts: repos.contacts, undo: repos.undo }),
      ...createMemoryTools({
        memory: repos.memory,
        undo: repos.undo,
        onFactSaved: (f) => indexer.onFactSaved(f),
        onFactForgotten: (id) => indexer.onFactForgotten(id),
      }),
      createUndoTool(repos),
      ...createCalendarTools({ events: repos.events, undo: repos.undo }),
      ...createReminderTools({ reminders: repos.reminders, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createWeatherTools({
        http,
        getHome: () => settings.get().profile.homePlace,
        getUnits: () => settings.get().profile.units,
      }),
      createSearchWebTool({ http, getBraveKey: () => secrets.get('brave') }),
      createNewsTool({ http, feeds: repos.feeds, summarize: createLlmSummarizer(llm) }),
      createFilesTool({ getApprovedDirs: () => settings.get().approvedDirs }),
      ...createEmailTools({ provider: () => emailService.provider(), contacts: repos.contacts }),
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
    onMessagePersisted: (m) => indexer.onMessagePersisted(m),
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

  // STT adapter selection (C17 auto): Deepgram when a key exists, else FakeSTT fixtures.
  const sttMode = settings.get().adapters.stt;
  const useRealStt = sttMode === 'real' || (sttMode === 'auto' && secrets.get('deepgram') !== null);
  const sttAdapter = useRealStt
    ? createDeepgramStt({ apiKey: () => secrets.get('deepgram'), log })
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
  const ttsAdapter = settings.get().adapters.tts === 'fake' ? new FakeTts() : createEdgeTts({ voice: () => settings.get().tts.voice, log });
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
    perf: (name, dur) => repos.perf.record('voice', name, dur),
    log,
  });
  let voiceTurnActive = false;

  const voiceConvId = newId(); // voice turns share one conversation per app session
  const voiceController = createVoiceController({
    stt: sttAdapter,
    workerSend: (m) => workerHost.send(m),
    dispatch: (text) => {
      voiceTurnActive = true;
      ttsPipeline.beginTurn();
      orchestrator.handleUserMessage({ text, source: 'voice', convId: voiceConvId });
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

  workerHost.start();

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

  const handlers = buildHandlers({
    orchestrator: () => orchestrator,
    repos,
    settings,
    secrets,
    testKey,
    setMuted: (on) => voiceController.setMuted(on),
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
    logTail: (lines) => readLogTail(join(userData, 'logs', 'apollo.log'), lines),
    egressHosts: () => egress.allowedHosts(),
    wipeAllData: () => wipeAllData(),
    finishOnboarding: () => {
      settings.patch({ onboarded: true });
      closeOnboardingWindow();
      openWorkspace({ view: 'today' }); // E6: finish opens the Workspace Today view
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
    openWorkspace: (target) => openWorkspace(target),
    openSettings: () => openSettingsWindow(),
    todayData: () => todayProvider.get(),
    geocode: async (query) => {
      // E6/E7 geocoding autocomplete through the egress-checked http client.
      try {
        const data = (await http.getJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en`,
        )) as { results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string; timezone?: string }> };
        return (data.results ?? []).map((r) => ({
          label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude,
          lon: r.longitude,
          tz: r.timezone ?? 'auto',
        }));
      } catch {
        return [];
      }
    },
    checkForUpdates: async () => (app.isPackaged ? { status: 'checking' as const } : { status: 'disabled' as const }),
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
    log,
  });

  createTray({ onOpenSettings: () => openSettingsWindow(), onOpenWorkspace: () => openWorkspace({ view: 'today' }), onQuickCapture: () => openCaptureWindow() });
  const palette = createPaletteWindow();
  // B1: the hotkey activates Apollo — palette for typing, and (PTT) listening when voice is up
  registerHotkey(settings.get().hotkey, onHotkeyPress, log);

  // First run (C18): show the 4-step onboarding until completed.
  if (!settings.get().onboarded && process.env['APOLLO_SMOKE'] !== '1') {
    createOnboardingWindow();
  }

  // C14.8 auto-updates (packaged builds only).
  void initUpdater({
    isPackaged: app.isPackaged,
    notify: (title, body) => new Notification({ title, body }).show(),
    log,
  });

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
      orchestrator.handleUserMessage({ text: 'good morning', source: 'voice', convId: voiceConvId });
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
    voiceBusy: () => ['listening', 'thinking', 'speaking'].includes(voiceController.state()),
    // Cross-app fullscreen detection isn't exposed by Electron; conservatively false
    // (never suppress a nudge for a fullscreen we can't observe). See HUMAN_TODO.
    isFullscreen: () => false,
    push: (payload) => {
      if (!orbWindow.isDestroyed()) pushTo(orbWindow.webContents, 'suggestion.show', { ...payload, silent: payload.silent ?? false });
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
  powerMonitor.on('resume', () => proactive.onResume());

  // F4 Quick Capture: global-hotkey micro-window; classify + save through the repos.
  const quickCapture = createQuickCaptureService({
    repos,
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    defaultType: () => settings.get().quickCapture.defaultType,
    onReminderArmed: () => scheduler.rearm(),
  });
  quickCaptureRef = quickCapture;
  // registerHotkey() unregisters all shortcuts then registers the palette hotkey,
  // so the capture hotkey must be (re-)added right after. reRegisterHotkeys does both.
  reRegisterHotkeys = (): void => {
    registerHotkey(settings.get().hotkey, onHotkeyPress, log);
    try {
      globalShortcut.register(settings.get().quickCapture.hotkey, () => openCaptureWindow());
    } catch (e) {
      log(`quick-capture hotkey failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  reRegisterHotkeys();

  if (process.env['APOLLO_SMOKE'] === '1') {
    palette.webContents.once('did-finish-load', () => {
      // Drives a real turn over the bridge: IPC → router → orchestrator →
      // fast path → timer tool → agent.events back to the renderer.
      const script = `(async () => {
        if (typeof window.apollo !== 'object' || typeof window.apollo.call !== 'function') return 'no-bridge';
        const events = [];
        window.apollo.on('agent.events', (e) => events.push(e.type));
        const res = await window.apollo.call('agent.userMessage', { text: 'set a timer for 5 minutes', source: 'text', convId: 'smoke' });
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
        const todos = await window.apollo.call('todos.list', {});
        const captureOk = cls.suggestedType === 'reminder' && cap.ok && todos.some((t) => t.id === cap.id);
        if (!seen || changed === 0) return 'workspace-bad:seen=' + seen + ',changed=' + changed;
        return captureOk ? 'turn-ok' : 'capture-bad:cls=' + cls.suggestedType + ',ok=' + cap.ok;
      })()`;
      const idleClickThrough = orbController.isClickThrough(); // sampled before the turn activates the orb
      void palette.webContents
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
                `SMOKE_OK tray=${getTray() !== null} palette=${!palette.isDestroyed()} e2e=${result} orb=${orbOk} clickThroughIdle=${idleClickThrough} interactiveActive=${activeInteractive} workspace=${wsOk} wsRendered=${rendered}`,
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

  logger.info({ tools: registry.all().length, strings: Object.keys(STRINGS).length }, 'apollo ready');
}
