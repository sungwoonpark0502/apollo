import { STRINGS, type VoiceState, type WorkerToMain } from '@apollo/shared';
import { type SttAdapter, type SttSession } from './stt';

/**
 * C12.3 VoiceController FSM. Every table row is implemented here and covered
 * by voiceController.test.ts against FakeSTT with fake timers.
 */
export interface VoiceControllerDeps {
  stt: SttAdapter;
  workerSend: (msg: { t: 'mode'; mode: 'passive' | 'stream' | 'gated' } | { t: 'mute'; on: boolean }) => void;
  dispatch: (finalTranscript: string) => void;             // → orchestrator, source 'voice'
  pushState: (state: VoiceState) => void;
  pushPartial: (transcript: string, rms: number) => void;
  playEarcon: (name: 'wake' | 'done' | 'error') => void;
  stopTts: () => void;                                     // must take effect <100ms (C12.3 barge-in)
  notify?: (copy: string) => void;
  log?: (msg: string) => void;
}

const VAD_SILENCE_EOT_MS = 600;
const NO_SPEECH_IDLE_MS = 4_000;
const HARD_CAP_MS = 30_000;

export function createVoiceController(deps: VoiceControllerDeps) {
  let state: VoiceState = 'idle';
  let stateBeforeMute: VoiceState = 'idle';
  let session: SttSession | null = null;
  let transcript = '';
  let sawSpeech = false;
  let lastRms = 0;
  let sttFailures = 0;
  let voiceDisabled = false;

  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let hardCapTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: VoiceState): void {
    state = next;
    deps.pushState(next);
  }

  function clearTimers(): void {
    for (const t of [silenceTimer, noSpeechTimer, hardCapTimer]) if (t) clearTimeout(t);
    silenceTimer = noSpeechTimer = hardCapTimer = null;
  }

  function closeSession(): void {
    session?.close();
    session = null;
  }

  async function enterListening(): Promise<void> {
    if (voiceDisabled || state === 'muted') return;
    if (state === 'speaking') deps.stopTts();
    clearTimers();
    closeSession();
    transcript = '';
    sawSpeech = false;
    deps.playEarcon('wake');
    setState('listening');
    deps.workerSend({ t: 'mode', mode: 'stream' });

    noSpeechTimer = setTimeout(() => {
      // 4s with no speech → idle, no LLM call (C12.3)
      deps.playEarcon('done');
      toIdle();
    }, NO_SPEECH_IDLE_MS);
    hardCapTimer = setTimeout(() => endOfTurn(), HARD_CAP_MS);

    try {
      session = await deps.stt.open({
        onPartial: (text, isFinal) => {
          if (state !== 'listening') return;
          transcript = isFinal && transcript && !text.startsWith(transcript) ? `${transcript} ${text}` : text;
          deps.pushPartial(transcript, lastRms);
        },
        onEndpoint: () => {
          if (state === 'listening') endOfTurn(); // Deepgram endpoint (first wins vs VAD)
        },
        onError: (code) => {
          deps.log?.(`stt error: ${code}`);
          sttFailures += 1;
          if (sttFailures >= 2) degrade();
          else toIdle();
        },
      });
      sttFailures = 0;
    } catch (e) {
      deps.log?.(`stt open failed: ${e instanceof Error ? e.message : String(e)}`);
      sttFailures += 1;
      if (sttFailures >= 2) degrade();
      else toIdle();
    }
  }

  function degrade(): void {
    // STT down: voice off, text keeps working (C16)
    voiceDisabled = true;
    clearTimers();
    closeSession();
    deps.notify?.(STRINGS.errors.STT_DOWN);
    setState('error');
    deps.workerSend({ t: 'mode', mode: 'passive' });
  }

  function endOfTurn(): void {
    if (state !== 'listening') return;
    clearTimers();
    closeSession();
    if (!transcript.trim()) {
      deps.playEarcon('done');
      toIdle();
      return;
    }
    setState('thinking');
    deps.workerSend({ t: 'mode', mode: 'passive' });
    deps.dispatch(transcript.trim());
  }

  function toIdle(): void {
    clearTimers();
    closeSession();
    setState('idle');
    deps.workerSend({ t: 'mode', mode: 'passive' });
  }

  return {
    state: (): VoiceState => state,

    /** idle + wake / hotkey / PTT → listening (C12.3 row 1). */
    onWake(): void {
      if (state === 'idle' || state === 'speaking') void enterListening();
    },
    onHotkey(): void {
      this.onWake();
    },

    onWorkerMessage(msg: WorkerToMain): void {
      switch (msg.t) {
        case 'wake':
          this.onWake();
          return;
        case 'frame': {
          if (state !== 'listening' || !session) return;
          const pcm = new Int16Array(msg.pcm);
          let sum = 0;
          for (let i = 0; i < pcm.length; i++) sum += (pcm[i] as number) ** 2;
          lastRms = Math.sqrt(sum / pcm.length) / 32768;
          session.sendFrame(msg.pcm);
          return;
        }
        case 'vad':
          if (state === 'listening') {
            if (msg.speech) {
              sawSpeech = true;
              if (noSpeechTimer) clearTimeout(noSpeechTimer);
              noSpeechTimer = null;
              if (silenceTimer) clearTimeout(silenceTimer);
              silenceTimer = null;
            } else if (sawSpeech) {
              silenceTimer = setTimeout(() => endOfTurn(), VAD_SILENCE_EOT_MS); // VAD EOT (first wins)
            }
          } else if (state === 'speaking' && msg.speech) {
            // barge-in: stop TTS <100ms, reopen STT, mode stream (C12.3)
            deps.stopTts();
            void enterListening();
          }
          return;
        case 'fatal':
          deps.log?.(`audio worker fatal: ${msg.msg}`);
          return;
      }
    },

    /** First TTS chunk ready (from the TTS pipeline). */
    ttsStarted(): void {
      if (state === 'thinking') {
        setState('speaking');
        deps.workerSend({ t: 'mode', mode: 'gated' });
      }
    },

    /** Playback queue drained. */
    ttsFinished(): void {
      if (state === 'speaking') {
        toIdle(); // card lingers in the orb (C12.3)
      }
    },

    /** Turn finished without any TTS (text-only reply). */
    turnDone(): void {
      if (state === 'thinking') toIdle();
    },

    setMuted(on: boolean): void {
      if (on) {
        if (state !== 'muted') stateBeforeMute = state === 'listening' || state === 'speaking' ? 'idle' : state;
        clearTimers();
        closeSession();
        deps.stopTts();
        deps.workerSend({ t: 'mute', on: true });
        setState('muted');
      } else if (state === 'muted') {
        deps.workerSend({ t: 'mute', on: false });
        setState(stateBeforeMute === 'error' ? 'error' : 'idle');
        deps.workerSend({ t: 'mode', mode: 'passive' });
      }
    },

    isVoiceDisabled(): boolean {
      return voiceDisabled;
    },
  };
}

export type VoiceController = ReturnType<typeof createVoiceController>;
