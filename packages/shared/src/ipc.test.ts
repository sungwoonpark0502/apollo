import { describe, expect, it } from 'vitest';
import { invokeChannels, pushChannels, type InvokeChannelName, type PushChannelName } from './ipc';
import { defaultSettings } from './settings';
import type { AgentEvent } from './agent';

/** A valid request+response fixture for every invoke channel. Adding a channel without a fixture fails the suite. */
const invokeFixtures: Record<InvokeChannelName, { req: unknown; res: unknown }> = {
  'agent.userMessage': {
    req: { text: 'set a timer for 5 minutes', source: 'text', convId: 'c1' },
    res: { turnId: 't1' },
  },
  'agent.cancel': { req: { turnId: 't1' }, res: { ok: true } },
  'agent.confirm': { req: { confirmationId: 'cf1', approved: true }, res: { ok: true } },
  'voice.setMuted': { req: { muted: true }, res: { ok: true } },
  'data.mutate': { req: { op: 'snoozeReminder', id: 'r1', min: 10 }, res: { ok: true } },
  'settings.get': { req: {}, res: defaultSettings() },
  'settings.set': { req: defaultSettings(), res: { ok: true } },
  'keys.set': { req: { provider: 'anthropic', value: 'sk-test' }, res: { ok: true } },
  'keys.test': { req: { provider: 'deepgram' }, res: { ok: false, message: 'no key stored' } },
  'oauth.google.start': { req: {}, res: { ok: true, address: 'user@gmail.com' } },
  'oauth.google.revoke': { req: {}, res: { ok: true } },
  'oauth.google.status': { req: {}, res: { connected: true, address: 'user@gmail.com', needsReauth: false } },
  'onboarding.finish': { req: {}, res: { ok: true } },
  'permissions.request': { req: { kind: 'mic' }, res: { granted: true } },
  'privacy.get': {
    req: {},
    res: { egressHosts: ['api.anthropic.com'], memoryFacts: [{ id: 'm1', category: 'person', fact: 'x' }] },
  },
  'privacy.deleteMemory': { req: { id: 'm1' }, res: { ok: true } },
  'privacy.wipe': { req: { confirm: 'ERASE' }, res: { ok: true } },
  'diagnostics.get': {
    req: {},
    res: {
      perf: [{ name: 'turn_total', count: 3, p50: 120, p95: 480 }],
      adapters: { stt: 'fake', tts: 'real', wake: 'fake', llm: 'real', embedder: 'fake' },
      logTail: ['line one', 'line two'],
      indexQueueDepth: 0,
    },
  },
  'tts.drained': { req: {}, res: { ok: true } },
  'debug.wake': { req: {}, res: { ok: true } },
  'debug.injectAudio': { req: { wavPath: '/tmp/fixture.wav' }, res: { ok: true } },
  // ---- E1 Workspace channels (defaults materialized so parse round-trips equal) ----
  'workspace.open': { req: { view: 'calendar', dateIso: '2026-07-14' }, res: { ok: true } },
  'events.list': {
    req: { startMs: 1_800_000_000_000, endMs: 1_800_086_400_000 },
    res: [
      {
        eventId: 'e1', occStartTs: 1_800_000_000_000, occEndTs: 1_800_003_600_000,
        title: 'Dentist', allDay: false, tz: 'America/Los_Angeles', isRecurring: false,
        location: null, notes: null, dateIso: '2027-01-15', rrule: null, calendarId: 'default',
      },
    ],
  },
  'events.get': {
    req: { id: 'e1' },
    res: {
      id: 'e1', title: 'Dentist', startTs: 1_800_000_000_000, endTs: null, tz: 'America/Los_Angeles',
      allDay: false, rrule: null, location: null, notes: null, calendarId: 'default', color: '#D97757',
    },
  },
  'events.search': {
    req: { query: 'dentist' },
    res: [{ id: 'e1', title: 'Dentist', startTs: 1_800_000_000_000, endTs: null, tz: 'America/Los_Angeles', allDay: false, rrule: null, location: null, notes: null, calendarId: 'default', color: '#D97757' }],
  },
  'events.create': {
    req: { title: 'Standup', startIso: '2026-07-14T09:00:00', tz: 'LOCAL' },
    res: {
      id: 'e2', title: 'Standup', startTs: 1_800_000_000_000, endTs: 1_800_003_600_000,
      tz: 'America/Los_Angeles', allDay: false, rrule: null, location: null, notes: null, calendarId: 'default', color: '#D97757',
    },
  },
  'events.update': {
    req: { id: 'e1', patch: { title: 'Dentist (moved)' }, scope: 'all' },
    res: {
      id: 'e1', title: 'Dentist (moved)', startTs: 1_800_000_000_000, endTs: null,
      tz: 'America/Los_Angeles', allDay: false, rrule: null, location: null, notes: null, calendarId: 'default', color: '#D97757',
    },
  },
  'events.delete': { req: { id: 'e1', scope: 'single', occStartTs: 1_800_000_000_000 }, res: { ok: true } },
  'calendars.crud': { req: { op: 'create', name: 'Work', color: '#4C8BF5' }, res: { ok: true } },
  'notes.list': {
    req: { query: 'groceries', limit: 50 },
    res: [{ id: 'n1', title: 'Groceries', snippet: 'milk, eggs', updatedAt: 1_800_000_000_000, pinned: false }],
  },
  'notes.get': { req: { id: 'n1' }, res: { id: 'n1', content: 'Groceries\nmilk', pinned: false, updatedAt: 1 } },
  'notes.save': { req: { content: 'Groceries\nmilk, eggs' }, res: { id: 'n1', content: 'Groceries\nmilk, eggs', pinned: false, updatedAt: 1 } },
  'notes.delete': { req: { id: 'n1' }, res: { undoToken: 'u1' } },
  'notes.pin': { req: { id: 'n1', pinned: true }, res: { ok: true } },
  'undo.apply': { req: { undoToken: 'u1' }, res: { ok: true } },
  'undo.recent': { req: {}, res: [{ undoToken: 'u1', label: 'Deleted a note', ts: 1_800_000_000_000 }] },
  'undo.latest': { req: {}, res: { ok: true, label: 'Deleted a note' } },
  'shortcuts.list': { req: {}, res: [{ scope: 'Workspace', keys: '⌘K', description: 'Search everything' }] },
  'google.connect': { req: {}, res: { ok: true, calendars: [{ id: 'google:primary', name: 'James', color: '#4C8BF5', kind: 'google', readOnly: false }] } },
  'google.applySelection': { req: { calendars: [{ id: 'google:primary', name: 'James', color: '#4C8BF5', kind: 'google', readOnly: false }], direction: 'two-way' }, res: { ok: true } },
  'google.disconnect': { req: { keepLocal: true }, res: { ok: true } },
  'google.sync': { req: {}, res: { ok: true, changed: 3 } },
  'google.resolveConflict': { req: { eventId: 'e1', choice: 'mine' }, res: { ok: true } },
  'link.preview': { req: { url: 'https://example.com/post' }, res: { ok: true, url: 'https://example.com/post', title: 'Post', summary: 'A short summary.', siteName: 'example.com' } },
  'suggestion.action': { req: { suggestionId: 's1', actionId: 'dismiss' }, res: { ok: true } },
  'proactive.recent': { req: { limit: 10 }, res: [{ id: 's1', ruleId: 'meeting_lead', title: 'Standup in 10 min', createdAt: 1, outcome: 'dismissed' }] },
  'capture.open': { req: {}, res: { ok: true } },
  'capture.classify': {
    req: { text: 'call mom tomorrow at 6' },
    res: { suggestedType: 'reminder', reminderAvailable: true, reminderIso: '2026-07-14T18:00:00-07:00', timePhrase: 'tomorrow at 6', texts: { note: 'call mom tomorrow at 6', todo: 'call mom tomorrow at 6', reminder: 'call mom' } },
  },
  'capture.submit': { req: { text: 'buy milk', type: 'todo' }, res: { ok: true, savedAs: 'todo', id: 't1' } },
  'recall.query': {
    req: { query: 'drone startup', limit: 6 },
    res: [{ chunkId: 'ch1', kind: 'note', refId: 'n1', title: 'Ideas', snippet: 'drone delivery…', ts: 5 }],
  },
  'memory.indexStats': { req: {}, res: { note: 3, message: 10, fact: 2, total: 15, pending: 0, sizeBytes: 4096, enabled: true, embedder: 'fake' } },
  'memory.rebuild': { req: {}, res: { ok: true } },
  'memory.clear': { req: {}, res: { ok: true } },
  'backup.now': { req: {}, res: { ok: true, filename: 'apollo-2026-manual.db' } },
  'backup.list': { req: {}, res: [{ filename: 'apollo-2026-manual.db', reason: 'manual', sizeBytes: 4096, createdAt: 1 }] },
  'backup.restore': { req: { filename: 'apollo-2026-manual.db' }, res: { ok: true } },
  'export.run': { req: { includeConversations: false }, res: { path: '/tmp/apollo-export.zip' } },
  'import.run': { req: {}, res: { counts: { notes: 2, events: 1, todos: 0, reminders: 0, facts: 3 } } },
  'actionLog.list': { req: {}, res: [{ id: 'a1', ts: 1, tool: 'email.send', summary: 'Send email to jane@x.com', outcome: 'executed', convId: 'c1' }] },
  'usage.summary': { req: {}, res: { today: [{ provider: 'anthropic', metric: 'inputTokens', amount: 100 }], month: [{ provider: 'anthropic', metric: 'inputTokens', amount: 3000 }] } },
  'conversations.list': { req: { limit: 50 }, res: [{ id: 'c1', title: 'set a timer', startedAt: 1, lastTs: 2, messageCount: 4, pinned: false }] },
  'conversations.get': { req: { id: 'c1' }, res: { messages: [{ id: 'm1', role: 'user', content: 'hi', ts: 1 }, { id: 'm2', role: 'assistant', content: 'hello', ts: 2 }] } },
  'conversations.delete': { req: { id: 'c1' }, res: { ok: true } },
  'conversations.setActive': { req: { id: 'c1' }, res: { ok: true } },
  'conversations.new': { req: {}, res: { ok: true, id: 'c2' } },
  'conversations.active': { req: {}, res: { id: 'c1' } },
  'conversations.rename': { req: { id: 'c1', title: 'Trip planning' }, res: { ok: true } },
  'conversations.pin': { req: { id: 'c1', pinned: true }, res: { ok: true } },
  'chat.send': { req: { text: 'set a timer for 10 minutes', convId: 'c1' }, res: { turnId: 't1' } },
  'chat.stop': { req: { turnId: 't1' }, res: { ok: true } },
  'chat.regenerate': { req: { convId: 'c1', messageId: 'm2' }, res: { turnId: 't2' } },
  'chat.editAndResend': { req: { convId: 'c1', messageId: 'm1', newText: 'set a timer for 5 minutes' }, res: { turnId: 't3' } },
  'tts.speak': { req: { text: 'Timer set for 10 minutes.' }, res: { ok: true } },
  'dictation.start': { req: {}, res: { ok: true } },
  'dictation.stop': { req: {}, res: { ok: true } },
  'auth.signIn': { req: {}, res: { ok: true } },
  'auth.signOut': { req: {}, res: { ok: true } },
  'auth.usage': { req: {}, res: { used: 12, limit: 200, resetIso: '2026-08-01T00:00:00.000Z' } },
  'app.mode': { req: {}, res: { mode: 'managed' } },
  'devices.list': { req: {}, res: { inputs: [{ deviceId: 'default', label: 'Built-in Mic' }], outputs: [{ deviceId: 'default', label: 'Built-in Speakers' }] } },
  'alert.action': { req: { kind: 'alarm', id: 'a1', action: 'snooze', snoozeMin: 10 }, res: { ok: true } },
  'keys.info': { req: {}, res: [{ provider: 'anthropic', configured: true, last4: 'x123', setAt: 1 }] },
  'keys.remove': { req: { provider: 'anthropic' }, res: { ok: true } },
  'settings.open': { req: {}, res: { ok: true } },
  'geocode.search': { req: { query: 'columbus', countryCode: 'US' }, res: [{ label: 'Columbus, Ohio, United States', city: 'Columbus', lat: 39.96, lon: -83, tz: 'America/New_York', countryCode: 'US' }] },
  'update.check': { req: {}, res: { status: 'none' } },
  'update.install': { req: {}, res: { ok: true } },
  'resources.get': { req: {}, res: [{ type: 'Browser', rssMB: 120 }, { type: 'Tab', rssMB: 80 }] },
  'workspace.today': {
    req: {},
    res: {
      news: [],
      weather: {
        place: 'Columbus',
        now: { tempF: 88, feelsF: 92, condition: 'Sunny', precipPct: 5, windMph: 6 },
        hours: [{ iso: '2026-07-13T14:00', temp: 89, precipPct: 10, condition: 'Sunny' }],
      },
      brief: { kind: 'text', body: 'Good morning' },
    },
  },
};

const pushFixtures: Record<PushChannelName, unknown> = {
  'agent.events': { type: 'turnStart', turnId: 't1', convId: 'c1' } satisfies AgentEvent,
  'voice.state': { state: 'listening' },
  'voice.partial': { transcript: 'set a tim', rms: 0.42 },
  'tts.audio': { seq: 0, mime: 'audio/mp3', data: new ArrayBuffer(8), last: false },
  'tts.stop': {},
  'tts.spoken': { index: 0 },
  'data.changed': { entity: 'note', op: 'create', id: 'n1' },
  'settings.changed': defaultSettings(),
  'workspace.navigate': { view: 'calendar', dateIso: '2026-07-14' },
  'suggestion.show': {
    suggestion: {
      id: 's1', ruleId: 'meeting_lead', urgency: 'time-sensitive', title: 'Standup in 10 min', body: '9:30 AM',
      actions: [{ id: 'snooze', label: 'Snooze 5 min', kind: 'snooze' }, { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }],
      createdAt: 1_800_000_000_000,
    },
    silent: false,
  },
  'capture.result': { ok: true },
  'alert.ringing': { kind: 'timer', id: 't1', label: 'pasta', firedAt: 1_800_000_000_000, silent: false },
  'alert.stop': { id: 't1' },
  'update.state': { status: 'ready', version: '1.2.3' },
  'google.state': { status: 'idle', lastSyncTs: 1_800_000_000_000 },
  'dictation.text': { text: 'note that the dentist moved', final: false },
  'auth.state': { status: 'signedIn', user: { name: 'James', email: 'james@example.com', plan: 'free' } },
};

describe('invoke channel round-trips', () => {
  for (const [name, def] of Object.entries(invokeChannels)) {
    it(`${name} req+res round-trip`, () => {
      const fx = invokeFixtures[name as InvokeChannelName];
      expect(fx, `missing fixture for channel ${name}`).toBeDefined();
      expect(def.req.parse(fx.req)).toEqual(fx.req);
      expect(def.res.parse(fx.res)).toEqual(fx.res);
    });
  }
});

describe('push channel round-trips', () => {
  for (const [name, schema] of Object.entries(pushChannels)) {
    it(`${name} round-trip`, () => {
      const fx = pushFixtures[name as PushChannelName];
      expect(fx, `missing fixture for channel ${name}`).toBeDefined();
      expect(schema.parse(fx)).toEqual(fx);
    });
  }
});

describe('malformed payload rejection', () => {
  it('rejects wrong types', () => {
    expect(invokeChannels['agent.userMessage'].req.safeParse({ text: 5, source: 'text', convId: 'c' }).success).toBe(false);
  });
  it('rejects empty text', () => {
    expect(invokeChannels['agent.userMessage'].req.safeParse({ text: '', source: 'text', convId: 'c' }).success).toBe(false);
  });
  it('rejects unknown enum values', () => {
    expect(invokeChannels['agent.userMessage'].req.safeParse({ text: 'x', source: 'carrier-pigeon', convId: 'c' }).success).toBe(false);
    expect(invokeChannels['keys.set'].req.safeParse({ provider: 'openai', value: 'k' }).success).toBe(false);
  });
  it('rejects missing discriminant fields', () => {
    expect(invokeChannels['data.mutate'].req.safeParse({ id: 'x' }).success).toBe(false);
    expect(invokeChannels['data.mutate'].req.safeParse({ op: 'snoozeReminder', id: 'x', min: -5 }).success).toBe(false);
  });
  it('rejects garbage on push schemas', () => {
    expect(pushChannels['voice.state'].safeParse({ state: 'happy' }).success).toBe(false);
    expect(pushChannels['tts.audio'].safeParse({ seq: 0, mime: 'audio/wav', data: new ArrayBuffer(1), last: false }).success).toBe(false);
  });
  it('rejects malformed Workspace payloads (E1)', () => {
    expect(invokeChannels['workspace.open'].req.safeParse({ view: 'dashboard' }).success).toBe(false);
    expect(invokeChannels['events.list'].req.safeParse({ startMs: 'monday', endMs: 2 }).success).toBe(false);
    expect(invokeChannels['events.create'].req.safeParse({ startIso: '2026-07-14T09:00:00' }).success).toBe(false); // no title
    expect(invokeChannels['events.create'].req.safeParse({ title: '', startIso: 'x' }).success).toBe(false);
    expect(invokeChannels['events.update'].req.safeParse({ id: 'e1', patch: {}, scope: 'some' }).success).toBe(false);
    expect(invokeChannels['events.delete'].req.safeParse({ scope: 'all' }).success).toBe(false);
    expect(invokeChannels['notes.list'].req.safeParse({ limit: 0 }).success).toBe(false);
    expect(invokeChannels['notes.list'].req.safeParse({ limit: 10_000 }).success).toBe(false);
    expect(invokeChannels['notes.save'].req.safeParse({ content: 42 }).success).toBe(false);
    expect(invokeChannels['notes.pin'].req.safeParse({ id: 'n1', pinned: 'yes' }).success).toBe(false);
    expect(invokeChannels['undo.apply'].req.safeParse({}).success).toBe(false);
    expect(pushChannels['data.changed'].safeParse({ entity: 'spaceship', op: 'create', id: 'x' }).success).toBe(false);
    expect(pushChannels['data.changed'].safeParse({ entity: 'note', op: 'upsert', id: 'x' }).success).toBe(false);
  });
  it('rejects malformed proactive/capture payloads (F1)', () => {
    expect(invokeChannels['capture.submit'].req.safeParse({ text: '', type: 'note' }).success).toBe(false);
    expect(invokeChannels['capture.submit'].req.safeParse({ text: 'x', type: 'calendar' }).success).toBe(false);
    expect(invokeChannels['suggestion.action'].req.safeParse({ suggestionId: 's1' }).success).toBe(false);
    expect(invokeChannels['recall.query'].req.safeParse({ query: 'x' }).success).toBe(false); // min length 2
    expect(invokeChannels['recall.query'].req.safeParse({ query: 'hello', limit: 99 }).success).toBe(false);
    expect(invokeChannels['recall.query'].req.safeParse({ query: 'hi', kinds: ['email'] }).success).toBe(false);
    expect(pushChannels['suggestion.show'].safeParse({ suggestion: { id: 's1', ruleId: 'r', urgency: 'urgent', title: 't', body: 'b', actions: [], createdAt: 1 } }).success).toBe(false);
  });
});
