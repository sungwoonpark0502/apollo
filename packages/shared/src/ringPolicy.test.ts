import { describe, expect, it } from 'vitest';
import { defaultSnoozeMin, ringState } from './voice';

describe('ring policy (H6)', () => {
  it('timer loops for the first 60s then stops (card stays)', () => {
    expect(ringState('timer', 0).looping).toBe(true);
    expect(ringState('timer', 59_999).looping).toBe(true);
    expect(ringState('timer', 60_000).looping).toBe(false);
    expect(ringState('timer', 30_000).gain).toBe(1);
  });

  it('alarm rings indefinitely with a 20%/min ramp down to a floor', () => {
    expect(ringState('alarm', 0)).toEqual({ looping: true, gain: 1 });
    expect(ringState('alarm', 60_000).gain).toBeCloseTo(0.8, 5);
    expect(ringState('alarm', 120_000).gain).toBeCloseTo(0.64, 5);
    const far = ringState('alarm', 60 * 60_000);
    expect(far.looping).toBe(true);
    expect(far.gain).toBe(0.2);
  });

  it('default snooze minutes: timer 5, alarm 10', () => {
    expect(defaultSnoozeMin('timer')).toBe(5);
    expect(defaultSnoozeMin('alarm')).toBe(10);
  });
});

describe('reminder ring policy', () => {
  it('a reminder never rings, at any elapsed time', () => {
    // A reminder is a prompt, not an alarm. One that made noise would train
    // people to dismiss it fast, which defeats the point.
    for (const ms of [0, 1000, 60_000, 600_000]) {
      expect(ringState('reminder', ms)).toEqual({ looping: false, gain: 0 });
    }
  });

  it('timers and alarms are unchanged by the reminder addition', () => {
    expect(ringState('timer', 0)).toEqual({ looping: true, gain: 1 });
    expect(ringState('timer', 60_001).looping).toBe(false);
    expect(ringState('alarm', 0)).toEqual({ looping: true, gain: 1 });
    expect(ringState('alarm', 120_000).gain).toBeCloseTo(0.64, 5);
  });

  it('reminder snooze defaults to 10 minutes, not a timer 5', () => {
    expect(defaultSnoozeMin('reminder')).toBe(10);
    expect(defaultSnoozeMin('timer')).toBe(5);
    expect(defaultSnoozeMin('alarm')).toBe(10);
  });
});
