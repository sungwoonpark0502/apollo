import { type VoiceState } from '@apollo/shared';

/**
 * J2 FSM priority order (Phase 10). When more than one subsystem wants the orb,
 * the mic, or the speaker, this strict order arbitrates:
 *
 *   active user speech  >  ringing alarm sound  >  TTS reply  >  proactive delivery
 *
 * Encoded once here and used by the alert/voice/proactive paths so the ordering
 * can never drift. Higher priority = lower index.
 */
export type Contender = 'userSpeech' | 'ringingAlarm' | 'ttsReply' | 'proactive';

export const FSM_PRIORITY: readonly Contender[] = ['userSpeech', 'ringingAlarm', 'ttsReply', 'proactive'];

export function rank(c: Contender): number {
  return FSM_PRIORITY.indexOf(c);
}

/** The winner (higher priority) of two contenders for an exclusive resource. */
export function arbitrate(a: Contender, b: Contender): Contender {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * Resource ownership when user speech and a ringing alarm coincide (J2): the
 * voice command wins the mic, the alarm keeps ringing *visually*, and its sound
 * ducks under active speech. TTS also ducks under both.
 */
export interface ResourceOwners {
  mic: Contender | null;
  sound: Contender | null;
  visualAlarm: boolean;
}
export function resolveResources(active: { userSpeaking: boolean; alarmRinging: boolean; ttsSpeaking: boolean }): ResourceOwners {
  const mic = active.userSpeaking ? 'userSpeech' : null;
  // Sound: user speech ducks everything; else a ringing alarm outranks TTS.
  const sound: Contender | null = active.userSpeaking
    ? null // mic is live; alarm sound ducks, TTS pauses
    : active.alarmRinging
      ? 'ringingAlarm'
      : active.ttsSpeaking
        ? 'ttsReply'
        : null;
  return { mic, sound, visualAlarm: active.alarmRinging };
}

/**
 * Proactive deferral (J2 / F3.2 step 6): a nudge defers whenever the voice FSM
 * is engaged — treating `followup` (and `waking`) exactly like `listening`.
 */
export const VOICE_BUSY_STATES: readonly VoiceState[] = ['waking', 'listening', 'thinking', 'speaking', 'followup'];
export function isVoiceBusy(state: VoiceState): boolean {
  return VOICE_BUSY_STATES.includes(state);
}

/**
 * Indexer gating (J3): the background indexer drains ONLY when no turn is active
 * and the voice FSM is idle or muted — explicitly not while listening/thinking/
 * speaking/followup, so indexing never competes with an in-flight interaction.
 */
export const INDEXER_DRAIN_STATES: readonly VoiceState[] = ['idle', 'muted'];
export function canDrainIndex(state: VoiceState): boolean {
  return INDEXER_DRAIN_STATES.includes(state);
}
