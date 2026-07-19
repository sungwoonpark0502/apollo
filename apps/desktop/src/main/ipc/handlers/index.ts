import { type Handlers } from '../router';
import { type Orchestrator } from '../../agent/orchestrator';
import { type Repos } from '../../db/repos/index';
import { buildWorkspaceHandlers } from './workspace';
import { createChatActions } from '../../agent/chatActions';
import { applyCalendarCrud } from '../../calendars/service';
import { newId, shortcutList, type InvokeReq, type InvokeRes } from '@apollo/shared';
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
  finishOnboarding?: (opts: { seedWelcomeNote?: boolean }) => void;
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
  geocode?: (query: string, countryCode?: string) => Promise<InvokeRes<'geocode.search'>>;
  linkPreview?: (url: string) => Promise<InvokeRes<'link.preview'>>;
  googleConnect?: () => Promise<InvokeRes<'google.connect'>>;
  googleApplySelection?: (req: InvokeReq<'google.applySelection'>) => void;
  googleDisconnect?: (keepLocal: boolean) => Promise<void>;
  googleSync?: () => Promise<InvokeRes<'google.sync'>>;
  googleResolveConflict?: (req: InvokeReq<'google.resolveConflict'>) => void;
  /** K2 "Speak this": read a message aloud through the TTS pipeline. */
  speakText?: (text: string) => void;
  /** K2 dictation-into-composer: returns false when STT/mic is unavailable. */
  dictationStart?: () => Promise<boolean>;
  dictationStop?: () => void;
  // L1 accounts. Tokens never cross this boundary — only status/profile/usage.
  authSignIn?: () => Promise<{ ok: boolean }>;
  authSignOut?: () => Promise<void>;
  authState?: () => InvokeRes<'auth.status'>;
  authUsage?: () => Promise<InvokeRes<'auth.usage'>>;
  authPasswordSignIn?: (email: string, password: string) => Promise<InvokeRes<'auth.signInWithPassword'>>;
  authPasswordSignUp?: (email: string, password: string, name?: string) => Promise<InvokeRes<'auth.signUpWithPassword'>>;
  appMode?: () => 'managed' | 'byok';
  chatModels?: () => Promise<InvokeRes<'chat.models'>>;
  checkForUpdates?: () => Promise<InvokeRes<'update.check'>>;
  installUpdate?: () => void;
  resourceReport?: () => InvokeRes<'resources.get'>;
  // F1 proactive + quick capture (wired in 6.2/6.3/6.5)
  activeConvId?: () => string; // H5 main-owned conversation id (rotates when stale)
  currentConvId?: () => string; // K2: pure read of the active id (no rotation side effect)
  setActiveConversation?: (id: string) => void;
  newConversation?: () => string; // K2: returns the fresh conversation id
  alertAction?: (kind: 'timer' | 'alarm', id: string, action: 'dismiss' | 'snooze', snoozeMin?: number) => void;
  listDevices?: () => Promise<InvokeRes<'devices.list'>>;
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
  // PART K: regenerate/edit truncate the thread, purge index chunks, and
  // re-dispatch through the identical one-brain agent path.
  const chatActions = createChatActions({
    repos: deps.repos,
    dispatch: ({ text, convId }) => {
      const { turnId } = deps.orchestrator().handleUserMessage({ text, source: 'text', convId });
      return { turnId };
    },
  });
  return {
    ...buildWorkspaceHandlers({
      repos: deps.repos,
      tz: deps.tz ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      openWorkspace: (target) => deps.openWorkspace?.(target),
      defaultCalendarId: () => deps.settings.get().calendars.defaultCalendarId,
      log: deps.log,
    }),
    'settings.open': () => {
      deps.openSettings?.();
      return { ok: true as const };
    },
    'workspace.today': async () => (deps.todayData ? deps.todayData() : { weather: null, brief: null, news: [] }),
    'geocode.search': async (req) => (deps.geocode ? deps.geocode(req.query, req.countryCode) : []),
    'link.preview': async (req) =>
      deps.linkPreview
        ? deps.linkPreview(req.url)
        : { ok: false as const, url: req.url, title: '', summary: '', siteName: '', error: 'unavailable' },
    'update.check': async () => (deps.checkForUpdates ? deps.checkForUpdates() : { status: 'disabled' as const }),
    'update.install': () => {
      deps.installUpdate?.();
      return { ok: true as const };
    },
    'resources.get': () => deps.resourceReport?.() ?? [],
    'shortcuts.list': () => shortcutList(process.platform === 'darwin'),
    'google.connect': async () => (deps.googleConnect ? deps.googleConnect() : { ok: false as const }),
    'google.applySelection': (req) => {
      deps.googleApplySelection?.(req);
      return { ok: true as const };
    },
    'google.disconnect': async (req) => {
      await deps.googleDisconnect?.(req.keepLocal);
      return { ok: true as const };
    },
    'google.sync': async () => (deps.googleSync ? deps.googleSync() : { ok: false as const, changed: 0 }),
    'google.resolveConflict': (req) => {
      deps.googleResolveConflict?.(req);
      return { ok: true as const };
    },
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
      // H5 one-brain: main owns the active conversation id (shared with voice).
      const convId = deps.activeConvId ? deps.activeConvId() : req.convId;
      const { turnId } = deps.orchestrator().handleUserMessage({ ...req, convId });
      return { turnId };
    },
    'agent.cancel': (req) => {
      deps.orchestrator().cancel(req.turnId);
      return { ok: true as const };
    },
    // PART K chat verbs: thin aliases over the identical one-brain agent path.
    'chat.send': (req) => {
      deps.onUserActivity?.();
      const convId = deps.activeConvId ? deps.activeConvId() : req.convId;
      const { turnId } = deps.orchestrator().handleUserMessage({ text: req.text, source: 'text', convId });
      return { turnId };
    },
    'chat.stop': (req) => {
      deps.orchestrator().cancel(req.turnId);
      return { ok: true as const };
    },
    'tts.speak': (req) => {
      deps.speakText?.(req.text);
      return { ok: true as const };
    },
    'dictation.start': async () => ({ ok: (await deps.dictationStart?.()) ?? false }),
    'dictation.stop': () => {
      deps.dictationStop?.();
      return { ok: true as const };
    },
    'auth.status': () => deps.authState?.() ?? { status: 'signedOut' as const },
    'auth.signIn': async () => {
      await deps.authSignIn?.();
      return { ok: true as const };
    },
    'auth.signOut': async () => {
      await deps.authSignOut?.();
      return { ok: true as const };
    },
    // L1.4: the credential goes straight through to the backend and is never
    // stored, echoed, or logged here. Only the outcome comes back.
    'auth.signInWithPassword': async (req) =>
      (await deps.authPasswordSignIn?.(req.email, req.password)) ?? { ok: false, error: 'unavailable' },
    'auth.signUpWithPassword': async (req) =>
      (await deps.authPasswordSignUp?.(req.email, req.password, req.name)) ?? { ok: false, error: 'unavailable' },
    'auth.usage': async () => (deps.authUsage ? deps.authUsage() : { used: 0, limit: 0, resetIso: '' }),
    'app.mode': () => ({ mode: deps.appMode?.() ?? ('managed' as const) }),
    'chat.models': async () => (deps.chatModels ? deps.chatModels() : { providers: [] }),
    'chat.regenerate': (req) => {
      deps.onUserActivity?.();
      deps.setActiveConversation?.(req.convId);
      return chatActions.regenerate(req.convId, req.messageId);
    },
    'chat.editAndResend': (req) => {
      deps.onUserActivity?.();
      deps.setActiveConversation?.(req.convId);
      return chatActions.editAndResend(req.convId, req.messageId, req.newText);
    },
    'agent.confirm': async (req) => {
      await deps.orchestrator().confirm(req.confirmationId, req.approved, req.deniedIndices);
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
    'onboarding.finish': (req) => {
      deps.finishOnboarding?.({ seedWelcomeNote: req.seedWelcomeNote });
      return { ok: true as const };
    },
    'permissions.request': async (req) => ({ granted: (await deps.requestPermission?.(req.kind)) ?? false }),
    'data.mutate': (req) => {
      switch (req.op) {
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
    'calendars.crud': (req) => {
      const cur = deps.settings.get();
      const { state, result } = applyCalendarCrud(
        { active: cur.calendars.active, defaultCalendarId: cur.calendars.defaultCalendarId },
        req,
        {
          eventCount: (id) => deps.repos.events.countByCalendar(id),
          reassign: (from, to) => deps.repos.events.reassignCalendar(from, to),
          newId: () => `cal-${newId()}`,
        },
      );
      if (result.ok) {
        deps.settings.set({ ...cur, feeds: [], calendars: state });
      }
      return result;
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
    'usage.summary': () => ({
      today: deps.repos.usageLog.today().map((u) => ({ provider: u.provider, metric: u.metric, amount: u.amount })),
      month: deps.repos.usageLog.month().map((u) => ({ provider: u.provider, metric: u.metric, amount: u.amount })),
    }),
    'conversations.list': (req) => deps.repos.conversations.listSummaries(req.limit),
    'conversations.get': (req) => ({ messages: deps.repos.conversations.messagesOf(req.id) as Array<{ id: string; role: 'user' | 'assistant'; content: string; ts: number }> }),
    'conversations.delete': (req) => {
      deps.repos.chunks.purgeConversation(req.id); // H5: purge indexed message chunks + vectors
      deps.repos.conversations.deleteConversation(req.id);
      return { ok: true as const };
    },
    'conversations.setActive': (req) => {
      deps.setActiveConversation?.(req.id);
      return { ok: true as const };
    },
    'conversations.new': () => ({ ok: true as const, id: deps.newConversation?.() ?? '' }),
    'conversations.active': () => ({ id: deps.currentConvId?.() ?? '' }),
    'conversations.rename': (req) => {
      deps.repos.conversations.rename(req.id, req.title);
      return { ok: true as const };
    },
    'conversations.pin': (req) => {
      deps.repos.conversations.setPinned(req.id, req.pinned);
      return { ok: true as const };
    },
    'alert.action': (req) => {
      deps.alertAction?.(req.kind, req.id, req.action, req.snoozeMin);
      return { ok: true as const };
    },
    'devices.list': async () => (deps.listDevices ? deps.listDevices() : { inputs: [], outputs: [] }),
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
