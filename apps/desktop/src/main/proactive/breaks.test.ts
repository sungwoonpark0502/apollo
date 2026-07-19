import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Settings } from '@apollo/shared';
import { breakDecision, createBreakScheduler } from './breaks';

const MIN = 60_000;

function cfg(over: Partial<Settings['breaks']> = {}): Settings {
  const s = defaultSettings();
  return { ...s, breaks: { ...s.breaks, enabled: true, everyMin: 60, onlyWhenActive: true, ...over } };
}

function deps(over: Partial<Parameters<typeof breakDecision>[0]> = {}, settings = cfg()) {
  return {
    settings: () => settings,
    busy: () => false,
    userActive: () => true,
    isDnd: () => false,
    ...over,
  };
}

describe('break reminders: when they fire', () => {
  it('fires once a full interval has passed', () => {
    expect(breakDecision(deps(), 61 * MIN, 0)).toEqual({ kind: 'fire' });
  });

  it('does not fire before the interval is up', () => {
    expect(breakDecision(deps(), 59 * MIN, 0)).toEqual({ kind: 'skip', why: 'tooSoon' });
  });

  it('is off by default, so it never fires unless asked for', () => {
    // The default matters: an assistant that starts interrupting on its own is
    // the behavior people uninstall over.
    expect(defaultSettings().breaks.enabled).toBe(false);
    expect(breakDecision(deps({}, defaultSettings()), 999 * MIN, 0)).toEqual({ kind: 'skip', why: 'disabled' });
  });

  it('respects the configured interval', () => {
    const s = cfg({ everyMin: 90 });
    expect(breakDecision(deps({}, s), 89 * MIN, 0).kind).toBe('skip');
    expect(breakDecision(deps({}, s), 91 * MIN, 0)).toEqual({ kind: 'fire' });
  });
});

describe('break reminders: when they stay quiet', () => {
  it('never fires during quiet hours', () => {
    expect(breakDecision(deps({ isDnd: () => true }), 999 * MIN, 0)).toEqual({ kind: 'skip', why: 'dnd' });
  });

  it('never interrupts a turn in flight', () => {
    expect(breakDecision(deps({ busy: () => true }), 999 * MIN, 0)).toEqual({ kind: 'skip', why: 'busy' });
  });

  it('skips while the user is away, when asked to', () => {
    expect(breakDecision(deps({ userActive: () => false }), 999 * MIN, 0)).toEqual({ kind: 'skip', why: 'inactive' });
  });

  it('fires while away when the user opted out of that check', () => {
    const s = cfg({ onlyWhenActive: false });
    expect(breakDecision(deps({ userActive: () => false }, s), 999 * MIN, 0)).toEqual({ kind: 'fire' });
  });

  it('quiet hours win over a long-overdue reminder', () => {
    // Ordering matters: a reminder deferred for hours must not burst out at 3am.
    expect(breakDecision(deps({ isDnd: () => true }), 10_000 * MIN, 0)).toEqual({ kind: 'skip', why: 'dnd' });
  });
});

describe('break scheduler', () => {
  it('does not fire immediately at launch', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    let now = 0;
    const s = createBreakScheduler({
      settings: () => cfg(),
      now: () => now,
      busy: () => false,
      userActive: () => true,
      isDnd: () => false,
      notify,
    });
    s.start();
    now = 59 * MIN;
    s.tick();
    expect(notify).not.toHaveBeenCalled();
    now = 61 * MIN;
    s.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    s.stop();
    vi.useRealTimers();
  });

  it('restarts the interval after firing, rather than firing every tick', () => {
    const notify = vi.fn();
    let now = 0;
    const s = createBreakScheduler({
      settings: () => cfg(),
      now: () => now,
      busy: () => false,
      userActive: () => true,
      isDnd: () => false,
      notify,
    });
    now = 61 * MIN;
    s.tick();
    now = 62 * MIN;
    s.tick();
    now = 63 * MIN;
    s.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    now = 122 * MIN;
    s.tick();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('a deferred reminder fires once the blocker clears, without piling up', () => {
    const notify = vi.fn();
    let now = 0;
    let busy = true;
    const s = createBreakScheduler({
      settings: () => cfg(),
      now: () => now,
      busy: () => busy,
      userActive: () => true,
      isDnd: () => false,
      notify,
    });
    now = 61 * MIN;
    s.tick();
    now = 65 * MIN;
    s.tick();
    expect(notify).not.toHaveBeenCalled(); // deferred while busy
    busy = false;
    now = 70 * MIN;
    s.tick();
    expect(notify).toHaveBeenCalledTimes(1); // exactly one, not one per missed tick
  });

  it('reset() pushes the next reminder out instead of firing on a settings change', () => {
    const notify = vi.fn();
    let now = 0;
    const s = createBreakScheduler({
      settings: () => cfg(),
      now: () => now,
      busy: () => false,
      userActive: () => true,
      isDnd: () => false,
      notify,
    });
    now = 61 * MIN;
    s.reset();
    s.tick();
    expect(notify).not.toHaveBeenCalled();
    now = 122 * MIN;
    s.tick();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stop() ends the interval', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const s = createBreakScheduler({
      settings: () => cfg(),
      now: () => Date.now(),
      busy: () => false,
      userActive: () => true,
      isDnd: () => false,
      notify,
    });
    s.start();
    s.stop();
    vi.advanceTimersByTime(10 * 60 * MIN);
    expect(notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
