import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeNextBrief, createDailyBrief } from './dailyBrief';

const TZ = 'America/Los_Angeles';

describe('computeNextBrief', () => {
  it('picks today when the time is still ahead', () => {
    const now = Date.parse('2026-07-12T07:00:00-07:00');
    const next = computeNextBrief('08:30', TZ, now);
    expect(new Date(next).toISOString()).toBe('2026-07-12T15:30:00.000Z'); // 08:30 PDT
  });
  it('rolls to tomorrow when the time has passed', () => {
    const now = Date.parse('2026-07-12T09:00:00-07:00');
    const next = computeNextBrief('08:30', TZ, now);
    expect(new Date(next).toISOString()).toBe('2026-07-13T15:30:00.000Z');
  });
});

describe('daily brief scheduler (C19)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires at the configured time when the user is active', () => {
    vi.setSystemTime(Date.parse('2026-07-12T08:29:00-07:00'));
    const runBrief = vi.fn();
    const b = createDailyBrief({ getBriefTimeHHMM: () => '08:30', tz: () => TZ, isUserActive: () => true, runBrief });
    b.start();
    vi.advanceTimersByTime(61_000);
    expect(runBrief).toHaveBeenCalledTimes(1);
  });

  it('defers when the user is away, then fires on their next activity', () => {
    vi.setSystemTime(Date.parse('2026-07-12T08:29:00-07:00'));
    const runBrief = vi.fn();
    let active = false;
    const b = createDailyBrief({ getBriefTimeHHMM: () => '08:30', tz: () => TZ, isUserActive: () => active, runBrief });
    b.start();
    vi.advanceTimersByTime(61_000);
    expect(runBrief).not.toHaveBeenCalled();
    expect(b.isPending()).toBe(true);

    active = true;
    b.noteActivity();
    expect(runBrief).toHaveBeenCalledTimes(1);
    expect(b.isPending()).toBe(false);
  });

  it('re-arms for the next day after firing', () => {
    vi.setSystemTime(Date.parse('2026-07-12T08:29:00-07:00'));
    const runBrief = vi.fn();
    const b = createDailyBrief({ getBriefTimeHHMM: () => '08:30', tz: () => TZ, isUserActive: () => true, runBrief });
    b.start();
    vi.advanceTimersByTime(61_000); // fire day 1
    expect(runBrief).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 3600 * 1000); // next day
    expect(runBrief).toHaveBeenCalledTimes(2);
  });
});
