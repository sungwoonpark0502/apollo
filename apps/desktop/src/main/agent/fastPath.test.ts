import { describe, expect, it } from 'vitest';
import { matchFastPath } from './fastPath';

describe('fast path full matches', () => {
  it('timer variants', () => {
    expect(matchFastPath('set a timer for 5 minutes')).toEqual({ kind: 'timer', seconds: 300 });
    expect(matchFastPath('Set a timer for 5 minutes, please.')).toEqual({ kind: 'timer', seconds: 300 });
    expect(matchFastPath('hey apollo, timer for 30 seconds')).toEqual({ kind: 'timer', seconds: 30 });
    expect(matchFastPath('5 minute timer')).toEqual({ kind: 'timer', seconds: 300 });
    expect(matchFastPath('timer 2 hours')).toEqual({ kind: 'timer', seconds: 7200 });
  });

  it('time and date', () => {
    expect(matchFastPath('what time is it')).toEqual({ kind: 'timeNow' });
    expect(matchFastPath("What's the time?")).toEqual({ kind: 'timeNow' });
    expect(matchFastPath("what's today's date")).toEqual({ kind: 'dateToday' });
    expect(matchFastPath('what is the date today')).toEqual({ kind: 'dateToday' });
  });

  it('apps, volume, mute, media, stop', () => {
    expect(matchFastPath('open Spotify')).toEqual({ kind: 'openApp', app: 'spotify' });
    expect(matchFastPath('launch visual studio code')).toEqual({ kind: 'openApp', app: 'visual studio code' });
    expect(matchFastPath('turn the volume up')).toEqual({ kind: 'volume', op: 'up' });
    expect(matchFastPath('volume down')).toEqual({ kind: 'volume', op: 'down' });
    expect(matchFastPath('set volume to 40 percent')).toEqual({ kind: 'volume', op: 'set', value: 40 });
    expect(matchFastPath('mute yourself')).toEqual({ kind: 'mute', on: true });
    expect(matchFastPath('unmute')).toEqual({ kind: 'mute', on: false });
    expect(matchFastPath('stop talking')).toEqual({ kind: 'stopTalking' });
    expect(matchFastPath('pause the music')).toEqual({ kind: 'media', op: 'playpause' });
    expect(matchFastPath('next track')).toEqual({ kind: 'media', op: 'next' });
  });

  it('good morning triggers the daily brief', () => {
    expect(matchFastPath('good morning')).toEqual({ kind: 'brief' });
    expect(matchFastPath('Good morning, Apollo!')).toEqual({ kind: 'brief' });
    expect(matchFastPath('hey apollo, good morning')).toEqual({ kind: 'brief' });
  });

  it('E5 weather now variants', () => {
    for (const u of ["what's the weather", "how's the weather", 'hows the weather like', "what's the weather today", "what's the weather right now", "how's the weather now"]) {
      expect(matchFastPath(u)).toEqual({ kind: 'weatherNow' });
    }
    expect(matchFastPath('hey apollo, what\'s the weather?')).toEqual({ kind: 'weatherNow' });
  });

  it('E5 weather forecast variants', () => {
    expect(matchFastPath("what's the weather tomorrow")).toEqual({ kind: 'weatherForecast', when: 'tomorrow' });
    expect(matchFastPath("how's the weather this weekend")).toEqual({ kind: 'weatherForecast', when: 'weekend' });
  });
});

describe('H5 repeat + new-conversation fast path', () => {
  it('matches repeat-that phrasings', () => {
    expect(matchFastPath('repeat that')).toEqual({ kind: 'repeat' });
    expect(matchFastPath('say that again')).toEqual({ kind: 'repeat' });
    expect(matchFastPath('repeat')).toEqual({ kind: 'repeat' });
    expect(matchFastPath('what did you say?')).toEqual({ kind: 'repeat' });
  });
  it('matches new-conversation phrasings', () => {
    expect(matchFastPath('new conversation')).toEqual({ kind: 'newConversation' });
    expect(matchFastPath('start a new chat')).toEqual({ kind: 'newConversation' });
  });
  it('does NOT match "repeat after me" (reaches the LLM)', () => {
    expect(matchFastPath('repeat after me')).toBeNull();
  });
});

describe('fast path residue routes to LLM (returns null)', () => {
  const nearMisses = [
    'set a timer for 5 minutes and remind me to stretch', // residue after timer
    'set a timer',                                        // no duration
    'what time is it in tokyo',                           // residue
    'open the garage door',                               // openApp is greedy but full-match…
    'volume up a little bit',
    'set volume to 400',                                  // out of range
    'timer for five minutes',                             // words, not digits (LLM handles)
    'pause for a second and think',
    'what date is my dentist appointment',
    "what's the weather in paris",          // place given → LLM/weather tool, not fast path
    "what's the weather going to be like",  // residue
    'is it going to rain tomorrow',         // not the exact template
    "what's the weather next week",         // unsupported horizon
    'repeat after me the following words',  // H5: must NOT hit the repeat fast path
    'new conversation starter ideas',       // H5: residue after "new conversation"
  ];
  for (const utt of nearMisses) {
    it(`"${utt}"`, () => {
      const hit = matchFastPath(utt);
      // 'open the garage door' is the one intentional exception: openApp accepts
      // arbitrary names and lets the tool's allowlist reject non-apps.
      if (utt === 'open the garage door') {
        expect(hit).toEqual({ kind: 'openApp', app: 'the garage door' });
      } else {
        expect(hit).toBeNull();
      }
    });
  }
});
