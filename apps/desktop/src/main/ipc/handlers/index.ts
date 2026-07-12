import { type Handlers } from '../router';
import { type Orchestrator } from '../../agent/orchestrator';
import { type Repos } from '../../db/repos/index';
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
  ttsDrained?: () => void;
  debugWake?: () => void;
  debugInjectAudio?: (wavPath: string) => Promise<void>;
  log: (msg: string) => void;
}

export function buildHandlers(deps: HandlerDeps): Handlers {
  return {
    'agent.userMessage': (req) => {
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
    'data.mutate': (req) => {
      switch (req.op) {
        case 'completeTodo':
          deps.repos.todos.complete(req.id);
          break;
        case 'snoozeReminder':
          deps.repos.reminders.snooze(req.id, req.min);
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
    'oauth.google.start': () => ({ ok: false }), // Phase 3
    'oauth.google.revoke': () => ({ ok: false }), // Phase 3
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
