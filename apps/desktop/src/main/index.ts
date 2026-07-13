import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { STRINGS, type AgentEvent } from '@apollo/shared';
import { createTray, getTray } from './tray';
import { createAudioWindow, createOrbWindow, createPaletteWindow, openSettingsWindow, togglePalette } from './windows';
import { createOrbController } from './orbController';
import { createWorkerHost } from './voice/workerHost';
import { createVoiceController } from './voice/voiceController';
import { createTtsPipeline } from './voice/tts/pipeline';
import { createEdgeTts } from './voice/tts/edge';
import { FakeTts } from './voice/tts/fake';
import { createDeepgramStt } from './voice/sttDeepgram';
import { FakeStt, type FakeSttFixture } from './voice/sttFake';
import { wavToFrames } from './voice/wav';
import { readFileSync } from 'node:fs';
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
  const onHotkeyPress = (): void => {
    togglePalette();
    if (settings.get().ptt.enabled && !voiceController.isVoiceDisabled()) voiceController.onHotkey();
  };
  const settings = createSettingsService(repos.settings, {
    onChange: (next, prev) => {
      if (next.hotkey !== prev.hotkey) registerHotkey(next.hotkey, onHotkeyPress, log);
      if (next.wake.sensitivity !== prev.wake.sensitivity) workerHost.send({ t: 'setSensitivity', v: next.wake.sensitivity });
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

  const registry = createRegistry(
    [
      ...createTimerTools({ timers: repos.timers, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createAlarmTools({ alarms: repos.alarms, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
      ...createTodoTools({ todos: repos.todos, undo: repos.undo }),
      ...createContactTools({ contacts: repos.contacts, undo: repos.undo }),
      ...createMemoryTools({ memory: repos.memory, undo: repos.undo }),
      createUndoTool(repos),
      ...createCalendarTools({ events: repos.events, undo: repos.undo }),
      ...createReminderTools({ reminders: repos.reminders, undo: repos.undo, onArm: () => scheduler.rearm() }),
      ...createWeatherTools({
        http,
        getHome: () => settings.get().home,
        getUnits: () => settings.get().units,
      }),
      createSearchWebTool({ http, getBraveKey: () => secrets.get('brave') }),
      createNewsTool({ http, feeds: repos.feeds, summarize: createLlmSummarizer(llm) }),
      createFilesTool({ getApprovedDirs: () => settings.get().approvedDirs }),
      ...createEmailTools({ provider: () => emailService.provider(), contacts: repos.contacts }),
      createBriefTool({ getTool: (n) => registry.get(n), emailConnected: () => emailService.isConnected() }),
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

  function emitToAll(event: AgentEvent): void {
    orbController.onAgentEvent(event);
    if (voiceTurnActive && event.type === 'token') ttsPipeline.feedToken(event.text);
    if (event.type === 'done' || event.type === 'error') {
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

  const orchestrator: Orchestrator = createOrchestrator({
    registry,
    repos,
    llm,
    systemPrompt: () => buildSystemPrompt(userInfo().username || 'the user'),
    emit: emitToAll,
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    historyEnabled: () => settings.get().history.enabled,
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
    },
    ttsDrained: () => voiceController.ttsFinished(),
    adapterStates: () => ({
      stt: useRealStt ? 'deepgram' : 'fake',
      tts: settings.get().adapters.tts === 'fake' ? 'fake' : 'edge',
      wake: useRealWake ? 'porcupine' : 'fake',
      llm: secrets.get('anthropic') ? 'anthropic' : 'no-key',
    }),
    logTail: (lines) => readLogTail(join(userData, 'logs', 'apollo.log'), lines),
    oauthConnect: () => emailService.connect(),
    oauthRevoke: () => emailService.revoke(),
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

  createTray({ onOpenSettings: () => openSettingsWindow() });
  const palette = createPaletteWindow();
  // B1: the hotkey activates Apollo — palette for typing, and (PTT) listening when voice is up
  registerHotkey(settings.get().hotkey, onHotkeyPress, log);

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
        return res.turnId && active ? 'turn-ok' : 'turn-bad:' + events.join(',');
      })()`;
      const idleClickThrough = orbController.isClickThrough(); // sampled before the turn activates the orb
      void palette.webContents
        .executeJavaScript(script)
        .then((result: string) => {
          const orbOk = !orbWindow.isDestroyed() && orbWindow.isAlwaysOnTop() && !orbWindow.isFocused();
          const activeInteractive = !orbController.isClickThrough(); // turn just ran: orb must be interactive during linger
          // eslint-disable-next-line no-console
          console.log(
            `SMOKE_OK tray=${getTray() !== null} palette=${!palette.isDestroyed()} e2e=${result} orb=${orbOk} clickThroughIdle=${idleClickThrough} interactiveActive=${activeInteractive}`,
          );
          app.exit(result === 'turn-ok' && orbOk && idleClickThrough && activeInteractive ? 0 : 1);
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
