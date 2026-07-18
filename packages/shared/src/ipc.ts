import { z } from 'zod';
import { agentEventSchema, messageSourceSchema } from './agent';
import { voiceStateSchema } from './voice';
import { SettingsSchema } from './settings';
import { cardPayloadSchema, eventDTOSchema, noteListItemSchema, occurrenceDTOSchema, recallItemSchema, suggestionDTOSchema, weatherNowSchema } from './cards';

/**
 * Single source of truth for everything crossing the IPC bridge (C4).
 * ipc/router.ts registers these generically; preload generates window.apollo.
 */

export const ackSchema = z.object({ ok: z.literal(true) });
export type Ack = z.infer<typeof ackSchema>;

export const keyProviderSchema = z.enum(['anthropic', 'deepgram', 'brave', 'picovoice']);
export type KeyProvider = z.infer<typeof keyProviderSchema>;

export const dataMutateSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('completeTodo'), id: z.string() }),
  z.object({ op: z.literal('snoozeReminder'), id: z.string(), min: z.number().int().positive() }),
  z.object({ op: z.literal('completeReminder'), id: z.string() }), // E3.1 inline reminder actions
  z.object({ op: z.literal('cancelTimer'), id: z.string() }),
  z.object({ op: z.literal('deleteEvent'), id: z.string() }),
  z.object({ op: z.literal('pinCard'), cardId: z.string(), pinned: z.boolean() }),
]);
export type DataMutate = z.infer<typeof dataMutateSchema>;

interface ChannelDef {
  readonly req: z.ZodType;
  readonly res: z.ZodType;
}

/** Renderer → Main (ipcRenderer.invoke). */
export const invokeChannels = {
  'agent.userMessage': {
    req: z.object({ text: z.string().min(1), source: messageSourceSchema, convId: z.string() }),
    res: z.object({ turnId: z.string() }),
  },
  'agent.cancel': { req: z.object({ turnId: z.string() }), res: ackSchema },
  'agent.confirm': {
    // I3 batch: deniedIndices lists rows the user unchecked in a batchConfirm card.
    req: z.object({ confirmationId: z.string(), approved: z.boolean(), deniedIndices: z.array(z.number().int()).optional() }),
    res: ackSchema,
  },
  'voice.setMuted': { req: z.object({ muted: z.boolean() }), res: ackSchema },
  'data.mutate': { req: dataMutateSchema, res: ackSchema },
  'settings.get': { req: z.object({}), res: SettingsSchema },
  'settings.set': { req: SettingsSchema, res: ackSchema },
  'keys.set': {
    req: z.object({ provider: keyProviderSchema, value: z.string().min(1) }), // write-only
    res: z.object({ ok: z.boolean() }),
  },
  'keys.test': { req: z.object({ provider: keyProviderSchema }), res: z.object({ ok: z.boolean(), message: z.string() }) },
  'oauth.google.start': { req: z.object({}), res: z.object({ ok: z.boolean(), address: z.string().optional() }) },
  'oauth.google.revoke': { req: z.object({}), res: z.object({ ok: z.boolean() }) },
  'oauth.google.status': { req: z.object({}), res: z.object({ connected: z.boolean(), address: z.string().nullable(), needsReauth: z.boolean() }) },
  'onboarding.finish': { req: z.object({ seedWelcomeNote: z.boolean().optional() }), res: ackSchema },
  'permissions.request': {
    req: z.object({ kind: z.enum(['mic', 'accessibility']) }),
    res: z.object({ granted: z.boolean() }),
  },
  'privacy.get': {
    req: z.object({}),
    res: z.object({
      egressHosts: z.array(z.string()),
      memoryFacts: z.array(z.object({ id: z.string(), category: z.string(), fact: z.string() })),
    }),
  },
  'privacy.deleteMemory': { req: z.object({ id: z.string() }), res: ackSchema },
  'privacy.wipe': { req: z.object({ confirm: z.literal('ERASE') }), res: ackSchema },
  'diagnostics.get': {
    req: z.object({}),
    res: z.object({
      perf: z.array(z.object({ name: z.string(), count: z.number(), p50: z.number(), p95: z.number() })),
      adapters: z.object({ stt: z.string(), tts: z.string(), wake: z.string(), llm: z.string(), embedder: z.string() }),
      logTail: z.array(z.string()),
      indexQueueDepth: z.number(),
    }),
  },
  'tts.drained': { req: z.object({}), res: ackSchema },      // orb player → FSM "queue drained"
  'debug.wake': { req: z.object({}), res: ackSchema },       // dev only: drives FakeWake
  'debug.injectAudio': { req: z.object({ wavPath: z.string() }), res: ackSchema }, // dev only: A2.2a

  // ---- E1 Workspace channels ----
  'workspace.open': {
    req: z.object({
      view: z.enum(['chat', 'today', 'calendar', 'notes']), // K1: 'chat' added
      dateIso: z.string().optional(),
      noteId: z.string().optional(),
      convId: z.string().optional(), // K3: deep-link Chat to a specific conversation
    }),
    res: ackSchema,
  },
  // PART K Chat tab verbs: thin aliases over the one-brain agent path so
  // throttling and UI state stay chat-specific (K1).
  'chat.send': {
    req: z.object({ text: z.string().min(1), convId: z.string() }),
    res: z.object({ turnId: z.string() }),
  },
  'chat.stop': { req: z.object({ turnId: z.string() }), res: ackSchema },
  'chat.regenerate': {
    req: z.object({ convId: z.string(), messageId: z.string() }),
    res: z.object({ turnId: z.string() }),
  },
  'chat.editAndResend': {
    req: z.object({ convId: z.string(), messageId: z.string(), newText: z.string().min(1) }),
    res: z.object({ turnId: z.string() }),
  },
  // K2 "Speak this": reads a message aloud on demand so a typed conversation
  // can be listened to. Same TTS pipeline as voice replies.
  'tts.speak': { req: z.object({ text: z.string().min(1).max(4000) }), res: ackSchema },
  // K2 dictation-into-composer: STT transcribes into the textarea, never auto-sends.
  'dictation.start': { req: z.object({}), res: z.object({ ok: z.boolean() }) },
  'dictation.stop': { req: z.object({}), res: ackSchema },
  // L1 accounts. Tokens never cross this boundary — only status and profile.
  'auth.signIn': { req: z.object({}), res: ackSchema }, // opens the system browser
  'auth.signOut': { req: z.object({}), res: ackSchema },
  'auth.usage': {
    req: z.object({}),
    res: z.object({ used: z.number(), limit: z.number(), resetIso: z.string() }),
  },
  /** L0.2: which mode the build is running in, so the UI can hide Keys/Account. */
  'app.mode': { req: z.object({}), res: z.object({ mode: z.enum(['managed', 'byok']) }) },
  'events.list': {
    req: z.object({ startMs: z.number(), endMs: z.number() }),
    res: z.array(occurrenceDTOSchema),
  },
  'events.get': { req: z.object({ id: z.string() }), res: eventDTOSchema },
  'events.search': { req: z.object({ query: z.string().min(1) }), res: z.array(eventDTOSchema) }, // omnisearch Events group
  'events.create': {
    req: z.object({
      title: z.string().min(1),
      startIso: z.string(),
      endIso: z.string().optional(),
      tz: z.string().default('LOCAL'),
      allDay: z.boolean().optional(),
      rrule: z.string().optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
      reminderMin: z.number().int().min(0).optional(),
      calendarId: z.string().optional(),
    }),
    res: eventDTOSchema,
  },
  'events.update': {
    req: z.object({
      id: z.string(),
      patch: z
        .object({
          title: z.string().min(1),
          startIso: z.string(),
          endIso: z.string().nullable(),
          tz: z.string(),
          allDay: z.boolean(),
          rrule: z.string().nullable(),
          location: z.string().nullable(),
          notes: z.string().nullable(),
          reminderMin: z.number().int().min(0).nullable(),
          calendarId: z.string(),
        })
        .partial(),
      scope: z.enum(['single', 'all']).default('all'),
      occStartTs: z.number().optional(), // required when scope=single on a recurring event
    }),
    res: eventDTOSchema,
  },
  'events.delete': {
    req: z.object({ id: z.string(), scope: z.enum(['single', 'all']).default('all'), occStartTs: z.number().optional() }),
    res: ackSchema,
  },
  // I1 local calendar collections CRUD. delete blocks if events exist unless reassignTo is given.
  'calendars.crud': {
    req: z.discriminatedUnion('op', [
      z.object({ op: z.literal('create'), name: z.string().min(1), color: z.string() }),
      z.object({ op: z.literal('rename'), id: z.string(), name: z.string().min(1) }),
      z.object({ op: z.literal('recolor'), id: z.string(), color: z.string() }),
      z.object({ op: z.literal('delete'), id: z.string(), reassignTo: z.string().optional() }),
      z.object({ op: z.literal('setDefault'), id: z.string() }),
    ]),
    res: z.object({ ok: z.boolean(), error: z.string().optional(), eventCount: z.number().optional() }),
  },
  'notes.list': {
    req: z.object({ query: z.string().optional(), limit: z.number().int().positive().max(200).default(50) }),
    res: z.array(noteListItemSchema),
  },
  'notes.get': {
    req: z.object({ id: z.string() }),
    res: z.object({ id: z.string(), content: z.string(), pinned: z.boolean(), updatedAt: z.number() }),
  },
  'notes.save': {
    req: z.object({ id: z.string().optional(), content: z.string() }), // upsert
    res: z.object({ id: z.string(), content: z.string(), pinned: z.boolean(), updatedAt: z.number() }),
  },
  'notes.delete': { req: z.object({ id: z.string() }), res: z.object({ undoToken: z.string() }) },
  'notes.pin': { req: z.object({ id: z.string(), pinned: z.boolean() }), res: ackSchema },
  'todos.list': {
    req: z.object({}),
    res: z.array(z.object({ id: z.string(), content: z.string(), dueTs: z.number().nullable(), done: z.boolean() })),
  },
  'todos.add': {
    req: z.object({ content: z.string().min(1), dueTs: z.number().optional() }),
    res: z.object({ id: z.string() }),
  },
  'todos.toggle': { req: z.object({ id: z.string(), done: z.boolean() }), res: ackSchema },
  'todos.delete': { req: z.object({ id: z.string() }), res: ackSchema },
  'undo.apply': { req: z.object({ undoToken: z.string() }), res: ackSchema }, // UI undo toasts
  // I3 global undo: last 10 undoable actions across all surfaces + a shortcut that undoes the newest.
  'undo.recent': {
    req: z.object({}),
    res: z.array(z.object({ undoToken: z.string(), label: z.string(), ts: z.number() })),
  },
  // I6 shortcuts registry: single source that drives the help sheet.
  'shortcuts.list': {
    req: z.object({}),
    res: z.array(z.object({ scope: z.enum(['Global', 'Workspace', 'Calendar', 'Notes', 'Voice']), keys: z.string(), description: z.string() })),
  },
  // I7 Google Calendar sync (opt-in). Inert unless googleCalendar.enabled.
  'google.connect': {
    req: z.object({}),
    res: z.object({
      ok: z.boolean(),
      calendars: z
        .array(z.object({ id: z.string(), name: z.string(), color: z.string(), kind: z.enum(['local', 'google']), readOnly: z.boolean() }))
        .optional(),
    }),
  },
  'google.applySelection': {
    req: z.object({
      calendars: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), kind: z.enum(['local', 'google']), readOnly: z.boolean() })),
      direction: z.enum(['read-only', 'two-way']),
    }),
    res: ackSchema,
  },
  'google.disconnect': { req: z.object({ keepLocal: z.boolean() }), res: ackSchema },
  'google.sync': { req: z.object({}), res: z.object({ ok: z.boolean(), changed: z.number() }) },
  'google.resolveConflict': { req: z.object({ eventId: z.string(), choice: z.enum(['mine', 'theirs', 'both']) }), res: ackSchema },
  'undo.latest': { req: z.object({}), res: z.object({ ok: z.boolean(), label: z.string().optional() }) },
  // I4 link.preview: link.read capped to metadata + first paragraph (Notes affordance).
  'link.preview': {
    req: z.object({ url: z.string().url() }),
    res: z.object({ ok: z.boolean(), url: z.string(), title: z.string(), summary: z.string(), siteName: z.string(), error: z.string().optional() }),
  },
  // ---- F1 Proactive + Quick Capture channels ----
  'suggestion.action': { req: z.object({ suggestionId: z.string(), actionId: z.string() }), res: ackSchema },
  'proactive.recent': {
    req: z.object({ limit: z.number().int().positive().max(50).default(10) }),
    res: z.array(z.object({ id: z.string(), ruleId: z.string(), title: z.string(), createdAt: z.number(), outcome: z.string().nullable() })),
  },
  'capture.open': { req: z.object({}), res: ackSchema },
  'capture.classify': {
    req: z.object({ text: z.string() }),
    res: z.object({
      suggestedType: z.enum(['note', 'todo', 'reminder']),
      reminderAvailable: z.boolean(),
      reminderIso: z.string().nullable(),
      timePhrase: z.string().nullable(),
      texts: z.object({ note: z.string(), todo: z.string(), reminder: z.string() }),
    }),
  },
  'capture.submit': {
    req: z.object({
      text: z.string().min(1),
      type: z.enum(['note', 'todo', 'reminder']),
      reminderIso: z.string().optional(),
    }),
    res: z.object({ ok: z.boolean(), savedAs: z.enum(['note', 'todo', 'reminder']), id: z.string() }),
  },
  'recall.query': {
    req: z.object({
      query: z.string().min(2),
      kinds: z.array(z.enum(['note', 'message', 'fact'])).optional(),
      sinceIso: z.string().optional(),
      limit: z.number().int().min(1).max(10).default(6),
    }),
    res: z.array(recallItemSchema),
  },
  'memory.indexStats': {
    req: z.object({}),
    res: z.object({
      note: z.number(), message: z.number(), fact: z.number(),
      total: z.number(), pending: z.number(), sizeBytes: z.number(), enabled: z.boolean(), embedder: z.string(),
    }),
  },
  'memory.rebuild': { req: z.object({}), res: ackSchema }, // drops + re-scans corpus in background
  'memory.clear': { req: z.object({}), res: ackSchema },   // drops + disables until re-enabled
  // ---- H2 data safety ----
  'backup.now': { req: z.object({}), res: z.object({ ok: z.boolean(), filename: z.string().optional() }) },
  'backup.list': {
    req: z.object({}),
    res: z.array(z.object({ filename: z.string(), reason: z.enum(['pre-migrate', 'auto', 'manual']), sizeBytes: z.number(), createdAt: z.number() })),
  },
  'backup.restore': { req: z.object({ filename: z.string() }), res: ackSchema },
  'export.run': { req: z.object({ includeConversations: z.boolean() }), res: z.object({ path: z.string().nullable() }) },
  'import.run': {
    req: z.object({}),
    res: z.object({ counts: z.object({ notes: z.number(), events: z.number(), todos: z.number(), reminders: z.number(), facts: z.number() }).nullable() }),
  },
  'actionLog.list': {
    req: z.object({}),
    res: z.array(z.object({ id: z.string(), ts: z.number(), tool: z.string(), summary: z.string(), outcome: z.enum(['executed', 'canceled', 'denied', 'expired', 'undone']), convId: z.string().nullable() })),
  },
  'usage.summary': {
    req: z.object({}),
    res: z.object({
      today: z.array(z.object({ provider: z.string(), metric: z.string(), amount: z.number() })),
      month: z.array(z.object({ provider: z.string(), metric: z.string(), amount: z.number() })),
    }),
  },
  // ---- H5 conversation lifecycle ----
  'conversations.list': {
    req: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    res: z.array(z.object({ id: z.string(), title: z.string(), startedAt: z.number(), lastTs: z.number(), messageCount: z.number(), pinned: z.boolean() })),
  },
  'conversations.get': {
    // K1: message ids drive chat.regenerate / chat.editAndResend targeting.
    req: z.object({ id: z.string() }),
    res: z.object({ messages: z.array(z.object({ id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), ts: z.number() })) }),
  },
  'conversations.delete': { req: z.object({ id: z.string() }), res: ackSchema },
  'conversations.setActive': { req: z.object({ id: z.string() }), res: ackSchema },
  'conversations.new': { req: z.object({}), res: z.object({ ok: z.literal(true), id: z.string() }) }, // K2 New chat
  'conversations.active': { req: z.object({}), res: z.object({ id: z.string() }) }, // K2 shared activeConvId
  'conversations.rename': { req: z.object({ id: z.string(), title: z.string().max(120) }), res: ackSchema }, // K2 sidebar
  'conversations.pin': { req: z.object({ id: z.string(), pinned: z.boolean() }), res: ackSchema }, // K2 sidebar
  // H7 audio device pickers (labels available via the audio window's mic session)
  'devices.list': {
    req: z.object({}),
    res: z.object({
      inputs: z.array(z.object({ deviceId: z.string(), label: z.string() })),
      outputs: z.array(z.object({ deviceId: z.string(), label: z.string() })),
    }),
  },
  // ---- H6 alerts ----
  'alert.action': {
    req: z.object({ kind: z.enum(['timer', 'alarm']), id: z.string(), action: z.enum(['dismiss', 'snooze']), snoozeMin: z.number().int().min(1).max(120).optional() }),
    res: ackSchema,
  },
  // H3 key metadata (write-only keys; this returns non-secret metadata only)
  'keys.info': {
    req: z.object({}),
    res: z.array(z.object({ provider: keyProviderSchema, configured: z.boolean(), last4: z.string().nullable(), setAt: z.number().nullable() })),
  },
  'keys.remove': { req: z.object({ provider: keyProviderSchema }), res: ackSchema },
  'settings.open': { req: z.object({}), res: ackSchema }, // rail gear → settings window
  'geocode.search': {
    req: z.object({ query: z.string().min(1), countryCode: z.string().length(2).optional() }),
    res: z.array(z.object({ label: z.string(), city: z.string(), lat: z.number(), lon: z.number(), tz: z.string(), countryCode: z.string() })),
  },
  'update.check': { req: z.object({}), res: z.object({ status: z.enum(['checking', 'available', 'none', 'disabled']), version: z.string().optional() }) },
  'update.install': { req: z.object({}), res: ackSchema }, // H7 quit + install (only when ready)
  'resources.get': {
    req: z.object({}),
    res: z.array(z.object({ type: z.string(), rssMB: z.number() })), // H8 idle RSS per process
  },
  // Today view data that has no repo: weather strip (profile home, next 6h) + latest brief
  'workspace.today': {
    req: z.object({}),
    res: z.object({
      weather: z
        .object({
          place: z.string(),
          now: weatherNowSchema,
          hours: z.array(z.object({ iso: z.string(), temp: z.number(), precipPct: z.number(), condition: z.string() })),
        })
        .nullable(),
      brief: cardPayloadSchema.nullable(),
    }),
  },
} as const satisfies Record<string, ChannelDef>;

export const workspaceNavigateSchema = z.object({
  view: z.enum(['chat', 'today', 'calendar', 'notes']), // K1: 'chat' added
  dateIso: z.string().optional(),
  noteId: z.string().optional(),
  convId: z.string().optional(), // K3: open Chat on a specific conversation
});
export type WorkspaceNavigate = z.infer<typeof workspaceNavigateSchema>;

export const dataChangedSchema = z.object({
  entity: z.enum(['event', 'note', 'todo', 'reminder', 'timer']),
  op: z.enum(['create', 'update', 'delete']),
  id: z.string(),
});
export type DataChanged = z.infer<typeof dataChangedSchema>;

/** Main → Renderer (webContents.send). */
export const pushChannels = {
  'agent.events': agentEventSchema,
  'voice.state': z.object({ state: voiceStateSchema }),
  'voice.partial': z.object({ transcript: z.string(), rms: z.number() }),
  'tts.audio': z.object({
    seq: z.number().int().nonnegative(),
    mime: z.literal('audio/mp3'),
    data: z.instanceof(ArrayBuffer),
    last: z.boolean(),
  }),
  'tts.stop': z.object({}),
  'tts.spoken': z.object({ index: z.number().int().nonnegative() }), // E4 spoken-row sync
  'data.changed': dataChangedSchema,        // E2 live sync fan-out
  'settings.changed': SettingsSchema,       // E7 live settings broadcast
  'workspace.navigate': workspaceNavigateSchema, // main → workspace window routing
  // F1: governor → orb delivery; either a single suggestion or a batched group, plus a silent flag for DND
  'suggestion.show': z.object({
    suggestion: suggestionDTOSchema.optional(),
    group: z.array(suggestionDTOSchema).optional(),
    silent: z.boolean().default(false),
    firstNudge: z.boolean().optional(), // I6: show the one-time proactivity explainer above this nudge
  }),
  'capture.result': z.object({ ok: z.boolean() }), // main → capture window: morph + close, or shake
  // H6: main → orb ringing overlay
  'alert.ringing': z.object({ kind: z.enum(['timer', 'alarm']), id: z.string(), label: z.string().nullable(), firedAt: z.number(), silent: z.boolean().default(false) }),
  'alert.stop': z.object({ id: z.string() }), // main → orb: stop ringing (snoozed/dismissed elsewhere)
  'update.state': z.object({ status: z.enum(['idle', 'checking', 'downloading', 'ready']), version: z.string().optional() }), // H7
  // I7 Google Calendar sync status → Calendar header indicator
  'google.state': z.object({ status: z.enum(['idle', 'syncing', 'error']), lastSyncTs: z.number().nullable(), message: z.string().optional() }),
  // K2 dictation transcript stream → the Chat composer (final=true ends the session)
  'dictation.text': z.object({ text: z.string(), final: z.boolean() }),
  // L1 auth state → every window (sign-in affordance, Account tab)
  'auth.state': z.object({
    status: z.enum(['signedOut', 'signingIn', 'signedIn']),
    user: z.object({ name: z.string(), email: z.string(), plan: z.string() }).optional(),
  }),
} as const satisfies Record<string, z.ZodType>;

export type InvokeChannelName = keyof typeof invokeChannels;
export type PushChannelName = keyof typeof pushChannels;

export type InvokeReq<K extends InvokeChannelName> = z.infer<(typeof invokeChannels)[K]['req']>;
export type InvokeRes<K extends InvokeChannelName> = z.infer<(typeof invokeChannels)[K]['res']>;
export type PushPayload<K extends PushChannelName> = z.infer<(typeof pushChannels)[K]>;

/** Channels only registered when app is not packaged. */
export const DEV_ONLY_CHANNELS: readonly InvokeChannelName[] = ['debug.wake', 'debug.injectAudio'];

/** The one object exposed on window.apollo (C4). */
export interface ApolloBridge {
  call<K extends InvokeChannelName>(channel: K, payload: InvokeReq<K>): Promise<InvokeRes<K>>;
  on<K extends PushChannelName>(channel: K, listener: (payload: PushPayload<K>) => void): () => void;
  /** Capture renderer only: hands the audio-frame MessagePort to main (→ audio worker). */
  sendAudioPort(port: MessagePort): void;
}

/** postMessage channel name for the audio port hand-off (not an invoke channel). */
export const AUDIO_PORT_CHANNEL = 'audio.port';
