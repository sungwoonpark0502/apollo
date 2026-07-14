import { type Handlers } from '../router';
import { type Orchestrator } from '../../agent/orchestrator';
import { type Repos } from '../../db/repos/index';
import { buildWorkspaceHandlers } from './workspace';
import { type InvokeReq, type InvokeRes } from '@apollo/shared';
import { type SettingsService } from '../../settingsService';
import { type Secrets } from '../../security/secrets';
import { type KeyProvider } from '@apollo/shared';

export interface HandlerDeps {
  orchestrator: () => Orchestrator;
  repos: Repos;
  settings: SettingsService;
  secrets: Secrets;
  testKey: (provider: KeyProvider) => Promise<{ ok: boolean; message: string }>;
  setMuted: (on: boolean) => void;
  onUserActivity?: () => void;
  ttsDrained?: () => void;
  adapterStates: () => { stt: string; tts: string; wake: string; llm: string; embedder: string };
  indexQueueDepth?: () => number;
  logTail: (lines: number) => string[];
  egressHosts: () => string[];
  wipeAllData: () => void;
  finishOnboarding?: () => void;
  requestPermission?: (kind: 'mic' | 'accessibility') => Promise<boolean>;
  oauthConnect?: () => Promise<{ ok: boolean; address?: string }>;
  oauthRevoke?: () => void;
  oauthStatus?: () => InvokeRes<'oauth.google.status'>;
  debugWake?: () => void;
  debugInjectAudio?: (wavPath: string) => Promise<void>;
  /** E1: opens/focuses the Workspace window at a target view (wired in 5.2). */
  openWorkspace?: (target: InvokeReq<'workspace.open'>) => void;
  openSettings?: () => void;
  todayData?: () => Promise<InvokeRes<'workspace.today'>>;
  geocode?: (query: string) => Promise<InvokeRes<'geocode.search'>>;
  checkForUpdates?: () => Promise<InvokeRes<'update.check'>>;
  // F1 proactive + quick capture (wired in 6.2/6.3/6.5)
  suggestionAction?: (suggestionId: string, actionId: string) => void;
  openCapture?: () => void;
  captureSubmit?: (req: InvokeReq<'capture.submit'>) => InvokeRes<'capture.submit'>;
  recallQuery?: (req: InvokeReq<'recall.query'>) => Promise<InvokeRes<'recall.query'>>;
  memoryIndexStats?: () => InvokeRes<'memory.indexStats'>;
  memoryRebuild?: () => void;
  memoryClear?: () => void;
  backupNow?: () => InvokeRes<'backup.now'>;
  backupList?: () => InvokeRes<'backup.list'>;
  backupRestore?: (filename: string) => Promise<InvokeRes<'backup.restore'>>;
  exportRun?: (includeConversations: boolean) => Promise<InvokeRes<'export.run'>>;
  importRun?: () => Promise<InvokeRes<'import.run'>>;
  captureClassify?: (req: InvokeReq<'capture.classify'>) => InvokeRes<'capture.classify'>;
  tz?: () => string;
  log: (msg: string) => void;
}

export function buildHandlers(deps: HandlerDeps): Handlers {
  return {
    ...buildWorkspaceHandlers({
      repos: deps.repos,
      tz: deps.tz ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      openWorkspace: (target) => deps.openWorkspace?.(target),
      log: deps.log,
    }),
    'settings.open': () => {
      deps.openSettings?.();
      return { ok: true as const };
    },
    'workspace.today': async () => (deps.todayData ? deps.todayData() : { weather: null, brief: null }),
    'geocode.search': async (req) => (deps.geocode ? deps.geocode(req.query) : []),
    'update.check': async () => (deps.checkForUpdates ? deps.checkForUpdates() : { status: 'disabled' as const }),
    'suggestion.action': (req) => {
      deps.suggestionAction?.(req.suggestionId, req.actionId);
      return { ok: true as const };
    },
    'proactive.recent': (req) =>
      deps.repos.suggestions.recent(req.limit).map((s) => ({ id: s.id, ruleId: s.ruleId, title: s.payload.title, createdAt: s.createdAt, outcome: s.outcome })),
    'capture.open': () => {
      deps.openCapture?.();
      return { ok: true as const };
    },
    'capture.submit': (req) => {
      if (!deps.captureSubmit) throw new Error('capture not available');
      return deps.captureSubmit(req);
    },
    'recall.query': async (req) => (deps.recallQuery ? deps.recallQuery(req) : []),
    'memory.indexStats': () =>
      deps.memoryIndexStats?.() ?? { note: 0, message: 0, fact: 0, total: 0, pending: 0, sizeBytes: 0, enabled: true, embedder: 'fake' },
    'memory.rebuild': () => {
      deps.memoryRebuild?.();
      return { ok: true as const };
    },
    'memory.clear': () => {
      deps.memoryClear?.();
      return { ok: true as const };
    },
    'backup.now': () => deps.backupNow?.() ?? { ok: false },
    'backup.list': () => deps.backupList?.() ?? [],
    'backup.restore': async (req) => (deps.backupRestore ? deps.backupRestore(req.filename) : { ok: true as const }),
    'export.run': async (req) => (deps.exportRun ? deps.exportRun(req.includeConversations) : { path: null }),
    'import.run': async () => (deps.importRun ? deps.importRun() : { counts: null }),
    'capture.classify': (req) => {
      if (!deps.captureClassify) throw new Error('capture not available');
      return deps.captureClassify(req);
    },
    'agent.userMessage': (req) => {
      deps.onUserActivity?.();
      const { turnId } = deps.orchestrator().handleUserMessage(req);
      return { turnId };
    },
    'agent.cancel': (req) => {
      deps.orchestrator().cancel(req.turnId);
      return { ok: true as const };
    },
    'agent.confirm': async (req) => {
      await deps.orchestrator().confirm(req.confirmationId, req.approved);
      return { ok: true as const };
    },
    'voice.setMuted': (req) => {
      deps.setMuted(req.muted);
      return { ok: true as const };
    },
    'tts.drained': () => {
      deps.ttsDrained?.();
      return { ok: true as const };
    },
    'diagnostics.get': () => ({
      perf: deps.repos.perf.aggregates(),
      adapters: deps.adapterStates(),
      logTail: deps.logTail(200),
      indexQueueDepth: deps.indexQueueDepth?.() ?? 0,
    }),
    'privacy.get': () => ({
      egressHosts: deps.egressHosts(),
      memoryFacts: deps.repos.memory.list().map((f) => ({ id: f.id, category: f.category, fact: f.fact })),
    }),
    'privacy.deleteMemory': (req) => {
      deps.repos.memory.delete(req.id);
      return { ok: true as const };
    },
    'privacy.wipe': () => {
      deps.wipeAllData(); // deletes DB + safeStorage entries and relaunches (C14.10)
      return { ok: true as const };
    },
    'onboarding.finish': () => {
      deps.finishOnboarding?.();
      return { ok: true as const };
    },
    'permissions.request': async (req) => ({ granted: (await deps.requestPermission?.(req.kind)) ?? false }),
    'data.mutate': (req) => {
      switch (req.op) {
        case 'completeTodo':
          deps.repos.todos.complete(req.id);
          break;
        case 'snoozeReminder':
          deps.repos.reminders.snooze(req.id, req.min);
          break;
        case 'completeReminder':
          deps.repos.reminders.complete(req.id);
          break;
        case 'cancelTimer':
          deps.repos.timers.cancel(req.id);
          break;
        case 'deleteEvent':
          deps.repos.events.softDelete(req.id);
          break;
        case 'pinCard':
          break; // pinning is renderer-local state; ack keeps the channel uniform
      }
      return { ok: true as const };
    },
    // feeds live in the feeds table; settings.get/set present them as the C3 settings field
    'settings.get': () => ({ ...deps.settings.get(), feeds: deps.repos.feeds.list() }),
    'settings.set': (req) => {
      deps.settings.set({ ...req, feeds: [] });
      const existing = new Set(deps.repos.feeds.list().map((f) => f.id));
      for (const f of req.feeds) {
        deps.repos.feeds.upsert(f);
        existing.delete(f.id);
      }
      for (const gone of existing) deps.repos.feeds.remove(gone);
      return { ok: true as const };
    },
    'keys.set': (req) => {
      const ok = deps.secrets.set(req.provider, req.value);
      deps.log(`keys.set provider=${req.provider} ok=${ok}`); // value intentionally not logged
      return { ok };
    },
    'keys.test': (req) => deps.testKey(req.provider),
    'keys.info': () => deps.secrets.info(),
    'keys.remove': (req) => {
      if (req.provider === 'anthropic' || req.provider === 'deepgram' || req.provider === 'brave' || req.provider === 'picovoice') {
        deps.secrets.delete(req.provider);
      }
      deps.log(`keys.remove provider=${req.provider}`);
      return { ok: true as const };
    },
    'actionLog.list': () => deps.repos.actionLog.recent(100),
    'oauth.google.start': async () => (deps.oauthConnect ? await deps.oauthConnect() : { ok: false }),
    'oauth.google.revoke': () => {
      deps.oauthRevoke?.();
      return { ok: true };
    },
    'oauth.google.status': () => deps.oauthStatus?.() ?? { connected: false, address: null, needsReauth: false },
    'debug.wake': () => {
      deps.debugWake?.();
      return { ok: true as const };
    },
    'debug.injectAudio': async (req) => {
      await deps.debugInjectAudio?.(req.wavPath);
      return { ok: true as const };
    },
  };
}
