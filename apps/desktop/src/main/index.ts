import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { AppError, STRINGS, type AgentEvent } from '@apollo/shared';
import { createTray, getTray } from './tray';
import { createPaletteWindow, openSettingsWindow, togglePalette } from './windows';
import { createLogger } from './logger';
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
import { createWeatherTools } from './tools/weather';
import { createSearchWebTool } from './tools/searchWeb';
import { createOrchestrator, type Orchestrator } from './agent/orchestrator';
import { buildSystemPrompt } from './agent/systemPrompt';
import { type LlmClient } from './agent/llm';
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
  const userData = app.getPath('userData');
  const logger = createLogger({ logDir: join(userData, 'logs'), dev });
  const log = (msg: string): void => logger.info(msg);
  logger.info({ dev }, 'apollo booting');

  const config = loadConfig({ dotEnvPath: join(app.getAppPath(), '../../.env') });
  const db = openDb(dev && process.env['APOLLO_SMOKE'] === '1' ? ':memory:' : join(userData, 'apollo.db'));
  const schemaVersion = migrate(db);
  logger.info({ schemaVersion }, 'db ready');

  const repos = createRepos(db);
  const settings = createSettingsService(repos.settings, {
    onChange: (next, prev) => {
      if (next.hotkey !== prev.hotkey) registerHotkey(next.hotkey, togglePalette, log);
    },
  });
  const secrets = createSecrets({ settings: repos.settings, codec: safeStorageCodec(safeStorage), env: config.env, log });
  const testKey = createKeyTester({ secrets, model: settings.get().anthropic.model });

  const egress = createEgressPolicy(() => repos.feeds.list().map((f) => new URL(f.url).hostname));
  const http = createHttpClient({ egress, breaker: createBreaker(), log });

  const registry = createRegistry(
    [
      ...createTimerTools({ timers: repos.timers, undo: repos.undo }),
      ...createAlarmTools({ alarms: repos.alarms, undo: repos.undo }),
      ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
      ...createTodoTools({ todos: repos.todos, undo: repos.undo }),
      ...createContactTools({ contacts: repos.contacts, undo: repos.undo }),
      ...createMemoryTools({ memory: repos.memory, undo: repos.undo }),
      createUndoTool(repos),
      ...createWeatherTools({
        http,
        getHome: () => settings.get().home,
        getUnits: () => settings.get().units,
      }),
      createSearchWebTool({ http, getBraveKey: () => secrets.get('brave') }),
    ],
    { perf: (turnId, name, durMs) => repos.perf.record(turnId, name, durMs), log },
  );

  function emitToAll(event: AgentEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) pushTo(win.webContents, 'agent.events', event);
    }
  }

  // Real Anthropic adapter lands in 0.7; until a key exists every LLM turn
  // resolves to KEY_MISSING copy while fast path and tools keep working.
  const keyMissingLlm: LlmClient = {
    stream() {
      return Promise.reject(new AppError('KEY_MISSING', 'no anthropic key'));
    },
  };

  const orchestrator: Orchestrator = createOrchestrator({
    registry,
    repos,
    llm: keyMissingLlm,
    systemPrompt: () => buildSystemPrompt(userInfo().username || 'the user'),
    emit: emitToAll,
    tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    historyEnabled: () => settings.get().history.enabled,
    log,
  });

  const handlers = buildHandlers({
    orchestrator: () => orchestrator,
    repos,
    settings,
    secrets,
    testKey,
    setMuted: () => undefined, // voice lands in Phase 2
    log,
  });
  registerRouter(ipcMain, handlers, {
    isTrustedUrl: makeTrustedUrlCheck(process.env['ELECTRON_RENDERER_URL']),
    isDev: dev,
    log,
  });

  createTray({ onOpenSettings: () => openSettingsWindow() });
  const palette = createPaletteWindow();
  registerHotkey(settings.get().hotkey, togglePalette, log);

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
      void palette.webContents
        .executeJavaScript(script)
        .then((result: string) => {
          // eslint-disable-next-line no-console
          console.log(`SMOKE_OK tray=${getTray() !== null} palette=${!palette.isDestroyed()} e2e=${result}`);
          app.exit(result === 'turn-ok' ? 0 : 1);
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
