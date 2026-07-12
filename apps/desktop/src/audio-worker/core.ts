import type { MainToWorker, WorkerToMain } from '@apollo/shared';
import { type WakeAdapter } from './wake/adapter';
import type { SileroVad } from './vad/silero';

/**
 * Pure audio-worker mode machine (C12.2), testable without utilityProcess:
 *  - passive: wake adapter per frame, nothing forwarded
 *  - stream:  frames forwarded to main + VAD transitions emitted
 *  - gated:   TTS playing; wake runs with +0.15 threshold, frames not forwarded
 *  - muted:   everything dropped
 */
export interface WorkerCoreDeps {
  wake: WakeAdapter;
  vad: SileroVad;
  send: (msg: WorkerToMain, transfer?: ArrayBuffer[]) => void;
}

export function createWorkerCore(deps: WorkerCoreDeps) {
  let mode: 'passive' | 'stream' | 'gated' = 'passive';
  let muted = false;

  void deps.wake.start(() => deps.send({ t: 'wake' }));

  return {
    control(msg: MainToWorker): void {
      switch (msg.t) {
        case 'mode':
          mode = msg.mode;
          if (msg.mode !== 'stream') deps.vad.reset();
          break;
        case 'setSensitivity':
          deps.wake.setSensitivity(msg.v);
          break;
        case 'mute':
          muted = msg.on;
          if (msg.on) deps.vad.reset();
          break;
      }
    },

    async frame(pcm: Int16Array): Promise<void> {
      if (muted) return;
      switch (mode) {
        case 'passive':
          deps.wake.process(pcm, false);
          return;
        case 'gated':
          deps.wake.process(pcm, true); // +0.15 threshold applied by the adapter
          return;
        case 'stream': {
          const copy = pcm.slice();
          deps.send({ t: 'frame', pcm: copy.buffer }, [copy.buffer]);
          const transition = await deps.vad.process(pcm);
          if (transition) deps.send({ t: 'vad', speech: transition.speech });
          return;
        }
      }
    },

    modeOf(): string {
      return muted ? 'muted' : mode;
    },
  };
}

export type WorkerCore = ReturnType<typeof createWorkerCore>;
