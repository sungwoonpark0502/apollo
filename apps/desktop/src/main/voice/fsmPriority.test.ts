import { describe, expect, it } from 'vitest';
import { type VoiceState } from '@apollo/shared';
import { arbitrate, canDrainIndex, FSM_PRIORITY, isVoiceBusy, rank, resolveResources } from './fsmPriority';

const ALL_STATES: VoiceState[] = ['idle', 'waking', 'listening', 'thinking', 'speaking', 'followup', 'muted', 'error'];

describe('J2 FSM priority order', () => {
  it('encodes: active user speech > ringing alarm > TTS reply > proactive', () => {
    expect(FSM_PRIORITY).toEqual(['userSpeech', 'ringingAlarm', 'ttsReply', 'proactive']);
    expect(rank('userSpeech')).toBeLessThan(rank('ringingAlarm'));
    expect(rank('ringingAlarm')).toBeLessThan(rank('ttsReply'));
    expect(rank('ttsReply')).toBeLessThan(rank('proactive'));
  });

  it('arbitrate returns the higher-priority contender', () => {
    expect(arbitrate('proactive', 'ringingAlarm')).toBe('ringingAlarm');
    expect(arbitrate('userSpeech', 'ringingAlarm')).toBe('userSpeech');
    expect(arbitrate('ttsReply', 'proactive')).toBe('ttsReply');
  });

  it('user speaking as an alarm rings: voice wins the mic, alarm keeps its visual, sound ducks', () => {
    const r = resolveResources({ userSpeaking: true, alarmRinging: true, ttsSpeaking: true });
    expect(r.mic).toBe('userSpeech');
    expect(r.sound).toBeNull(); // alarm sound + TTS both duck under active speech
    expect(r.visualAlarm).toBe(true); // alarm keeps ringing visually
  });

  it('ringing alarm outranks TTS for the speaker when the user is not speaking', () => {
    const r = resolveResources({ userSpeaking: false, alarmRinging: true, ttsSpeaking: true });
    expect(r.sound).toBe('ringingAlarm');
    expect(r.mic).toBeNull();
  });
});

describe('J2 proactive deferral states (follow-up treated like listening)', () => {
  it('voice is busy (defers nudges) in waking/listening/thinking/speaking/followup', () => {
    expect(isVoiceBusy('followup')).toBe(true); // the fix
    for (const s of ['waking', 'listening', 'thinking', 'speaking', 'followup'] as VoiceState[]) {
      expect(isVoiceBusy(s), s).toBe(true);
    }
  });
  it('voice is NOT busy when idle/muted/error', () => {
    for (const s of ['idle', 'muted', 'error'] as VoiceState[]) expect(isVoiceBusy(s), s).toBe(false);
  });
});

describe('J3 indexer drain states', () => {
  it('drains only in idle or muted', () => {
    expect(canDrainIndex('idle')).toBe(true);
    expect(canDrainIndex('muted')).toBe(true);
  });
  it('never drains while an interaction is live (incl. followup)', () => {
    for (const s of ['waking', 'listening', 'thinking', 'speaking', 'followup'] as VoiceState[]) {
      expect(canDrainIndex(s), s).toBe(false);
    }
  });
  it('busy and drain are mutually exclusive across all states', () => {
    for (const s of ALL_STATES) {
      if (s === 'error') continue; // error is neither busy nor drainable
      expect(isVoiceBusy(s) === canDrainIndex(s)).toBe(false);
    }
  });
});
