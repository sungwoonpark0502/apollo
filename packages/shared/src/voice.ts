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

// ---- H6 ringing sound policy (pure; shared by the scheduler and the orb overlay) ----
export type AlertKind = 'timer' | 'alarm';

const TIMER_LOOP_CAP_MS = 60_000;
const RAMP_STEP_MS = 60_000;
const RAMP_FACTOR = 0.8;
const MIN_GAIN = 0.2;

export interface RingState {
  looping: boolean;
  gain: number;
}

/** Timers auto-stop the loop after 60s (card stays). Alarms ring until dismissed,
 *  volume stepping down 20% every 60s to a floor. */
export function ringState(kind: AlertKind, elapsedMs: number): RingState {
  if (kind === 'timer') return { looping: elapsedMs < TIMER_LOOP_CAP_MS, gain: 1 };
  const steps = Math.floor(Math.max(0, elapsedMs) / RAMP_STEP_MS);
  return { looping: true, gain: Math.max(MIN_GAIN, RAMP_FACTOR ** steps) };
}

/** Default snooze minutes per kind (H6): timer 5, alarm 10. */
export function defaultSnoozeMin(kind: AlertKind): number {
  return kind === 'alarm' ? 10 : 5;
}
