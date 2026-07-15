import { z } from 'zod';

export type VoiceState = 'idle' | 'waking' | 'listening' | 'thinking' | 'speaking' | 'followup' | 'muted' | 'error';

export const voiceStateSchema = z.enum(['idle', 'waking', 'listening', 'thinking', 'speaking', 'followup', 'muted', 'error']);

export type WorkerToMain =
  | { t: 'wake' }
  | { t: 'vad'; speech: boolean }
  | { t: 'frame'; pcm: ArrayBuffer }        // Int16, 16kHz, mono, 512 samples
  | { t: 'fatal'; msg: string };

export type MainToWorker =
  | { t: 'mode'; mode: 'passive' | 'stream' | 'gated' }  // gated = TTS playing
  | { t: 'setSensitivity'; v: number }                   // 0..1
  | { t: 'mute'; on: boolean };

export const workerToMainSchema: z.ZodType<WorkerToMain> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('wake') }),
  z.object({ t: z.literal('vad'), speech: z.boolean() }),
  z.object({ t: z.literal('frame'), pcm: z.instanceof(ArrayBuffer) }),
  z.object({ t: z.literal('fatal'), msg: z.string() }),
]) as unknown as z.ZodType<WorkerToMain>;

export const mainToWorkerSchema: z.ZodType<MainToWorker> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('mode'), mode: z.enum(['passive', 'stream', 'gated']) }),
  z.object({ t: z.literal('setSensitivity'), v: z.number().min(0).max(1) }),
  z.object({ t: z.literal('mute'), on: z.boolean() }),
]) as unknown as z.ZodType<MainToWorker>;

/** Audio frame contract: Int16 PCM, 16 kHz, mono, 512 samples per frame. */
export const AUDIO = { sampleRate: 16_000, frameSamples: 512, channels: 1 } as const;
