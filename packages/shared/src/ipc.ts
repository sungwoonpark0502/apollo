import { z } from 'zod';
import { agentEventSchema, messageSourceSchema } from './agent';
import { voiceStateSchema } from './voice';
import { SettingsSchema } from './settings';
import { cardPayloadSchema, eventDTOSchema, noteListItemSchema, occurrenceDTOSchema, weatherNowSchema } from './cards';

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
  'agent.confirm': { req: z.object({ confirmationId: z.string(), approved: z.boolean() }), res: ackSchema },
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
  'onboarding.finish': { req: z.object({}), res: ackSchema },
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
      adapters: z.object({ stt: z.string(), tts: z.string(), wake: z.string(), llm: z.string() }),
      logTail: z.array(z.string()),
    }),
  },
  'tts.drained': { req: z.object({}), res: ackSchema },      // orb player → FSM "queue drained"
  'debug.wake': { req: z.object({}), res: ackSchema },       // dev only: drives FakeWake
  'debug.injectAudio': { req: z.object({ wavPath: z.string() }), res: ackSchema }, // dev only: A2.2a

  // ---- E1 Workspace channels ----
  'workspace.open': {
    req: z.object({
      view: z.enum(['today', 'calendar', 'notes']),
      dateIso: z.string().optional(),
      noteId: z.string().optional(),
    }),
    res: ackSchema,
  },
  'events.list': {
    req: z.object({ startMs: z.number(), endMs: z.number() }),
    res: z.array(occurrenceDTOSchema),
  },
  'events.get': { req: z.object({ id: z.string() }), res: eventDTOSchema },
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
  'settings.open': { req: z.object({}), res: ackSchema }, // rail gear → settings window
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
  view: z.enum(['today', 'calendar', 'notes']),
  dateIso: z.string().optional(),
  noteId: z.string().optional(),
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
