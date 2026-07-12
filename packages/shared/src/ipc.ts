import { z } from 'zod';
import { agentEventSchema, messageSourceSchema } from './agent';
import { voiceStateSchema } from './voice';
import { SettingsSchema } from './settings';

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
} as const satisfies Record<string, ChannelDef>;

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
