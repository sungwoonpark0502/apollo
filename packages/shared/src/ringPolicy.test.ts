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
