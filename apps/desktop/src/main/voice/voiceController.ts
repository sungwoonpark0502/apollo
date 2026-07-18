import { AUDIO, STRINGS, type VoiceState, type WorkerToMain } from '@apollo/shared';
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
  onAudioSeconds?: (seconds: number) => void;              // H4 usage metering (Deepgram seconds)
  getFollowupWindowSec?: () => number;                     // H5 follow-up window (0 disables)
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
  let audioFramesSent = 0;
  let sttFailures = 0;
  let voiceDisabled = false;

  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let hardCapTimer: ReturnType<typeof setTimeout> | null = null;
  let followupTimer: ReturnType<typeof setTimeout> | null = null;

  // K2 dictation-into-composer: reuses the audio worker + STT adapter but NEVER
  // dispatches to the orchestrator — transcripts stream to the composer instead.
  let dictation: { onText: (text: string, final: boolean) => void } | null = null;
  let dictSession: SttSession | null = null;
  let dictTranscript = '';

  function setState(next: VoiceState): void {
    state = next;
    deps.pushState(next);
  }

  function clearTimers(): void {
    for (const t of [silenceTimer, noSpeechTimer, hardCapTimer, followupTimer]) if (t) clearTimeout(t);
    silenceTimer = noSpeechTimer = hardCapTimer = followupTimer = null;
  }

  function closeSession(): void {
    session?.close();
    session = null;
  }

  /** H5 follow-up: keep the mic warm (VAD on, STT closed) for windowSec so the
   *  user can continue without the wake word. Speech → listening (same convo). */
  function enterFollowup(windowSec: number): void {
    clearTimers();
    closeSession();
    setState('followup');
    deps.workerSend({ t: 'mode', mode: 'stream' }); // VAD active, frames flow for detection
    followupTimer = setTimeout(() => {
      if (state === 'followup') toIdle(); // timeout: no end earcon, back to passive
    }, windowSec * 1000);
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
    // H4: report the audio duration streamed to Deepgram this listen (512 samples @ 16 kHz).
    if (audioFramesSent > 0) {
      deps.onAudioSeconds?.((audioFramesSent * AUDIO.frameSamples) / AUDIO.sampleRate);
      audioFramesSent = 0;
    }
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

  function finishDictation(): void {
    if (!dictation) return;
    const cb = dictation;
    const text = dictTranscript.trim();
    dictation = null;
    dictSession?.close();
    dictSession = null;
    dictTranscript = '';
    if (text) cb.onText(text, true);
    toIdle();
  }

  return {
    state: (): VoiceState => state,

    /** idle + wake / hotkey / PTT → listening (C12.3 row 1). */
    onWake(): void {
      if (dictation) return; // the mic belongs to the composer right now
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
          if (dictation) {
            dictSession?.sendFrame(msg.pcm);
            return;
          }
          if (state !== 'listening' || !session) return;
          const pcm = new Int16Array(msg.pcm);
          let sum = 0;
          for (let i = 0; i < pcm.length; i++) sum += (pcm[i] as number) ** 2;
          lastRms = Math.sqrt(sum / pcm.length) / 32768;
          session.sendFrame(msg.pcm);
          audioFramesSent += 1; // H4: 512 samples @ 16 kHz per frame
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
          } else if (state === 'followup' && msg.speech) {
            // H5 follow-up continuation: open STT, same conversation, no wake word
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

    /** Playback queue drained → follow-up window (H5) or idle. Echo-safe: only
     *  after the queue fully drains do we open the mic again. */
    ttsFinished(): void {
      if (state === 'speaking') {
        const win = deps.getFollowupWindowSec?.() ?? 0;
        if (win > 0) enterFollowup(win);
        else toIdle(); // card lingers in the orb (C12.3)
      }
    },

    /** Turn finished without any TTS (text-only reply). */
    turnDone(): void {
      if (state === 'thinking') toIdle();
    },

    /**
     * K2 dictation-into-composer. Opens STT and streams transcripts to onText
     * (partials with final=false, then once with final=true); never dispatches.
     * Returns false when voice is unavailable or the mic is busy with a turn.
     */
    async startDictation(onText: (text: string, final: boolean) => void): Promise<boolean> {
      if (voiceDisabled || dictation || state !== 'idle') return false;
      dictation = { onText };
      dictTranscript = '';
      setState('listening'); // the orb honestly shows a hot mic
      deps.workerSend({ t: 'mode', mode: 'stream' });
      try {
        dictSession = await deps.stt.open({
          onPartial: (text, isFinal) => {
            if (!dictation) return;
            dictTranscript = isFinal && dictTranscript && !text.startsWith(dictTranscript) ? `${dictTranscript} ${text}` : text;
            dictation.onText(dictTranscript, false);
          },
          onEndpoint: () => finishDictation(), // utterance done → finalize, no dispatch
          onError: (code) => {
            deps.log?.(`dictation stt error: ${code}`);
            finishDictation();
          },
        });
        return true;
      } catch (e) {
        deps.log?.(`dictation open failed: ${e instanceof Error ? e.message : String(e)}`);
        dictation = null;
        toIdle();
        return false;
      }
    },

    /** Stop dictating early (mic tap): emits the transcript so far as final. */
    stopDictation(): void {
      finishDictation();
    },

    isDictating(): boolean {
      return dictation !== null;
    },

    setMuted(on: boolean): void {
      if (on) {
        if (dictation) finishDictation(); // mute wins; composer keeps what was heard
        if (state !== 'muted') stateBeforeMute = state === 'listening' || state === 'speaking' || state === 'followup' ? 'idle' : state;
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
