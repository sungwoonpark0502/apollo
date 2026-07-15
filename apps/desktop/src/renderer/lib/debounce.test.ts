import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce, wordCount } from './debounce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce (E9 autosave logic)', () => {
  it('runs once, waitMs after the last call, with the latest args', () => {
    const fn = vi.fn();
    const d = debounce(fn, 800);
    d('a');
    vi.advanceTimersByTime(400);
    d('b'); // resets the timer
    vi.advanceTimersByTime(799);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('flush() fires a pending call immediately (autosave on blur/close)', () => {
    const fn = vi.fn();
    const d = debounce(fn, 800);
    d('x');
    expect(d.pending()).toBe(true);
    d.flush();
    expect(fn).toHaveBeenCalledWith('x');
    expect(d.pending()).toBe(false);
  });

  it('flush() with nothing pending is a no-op', () => {
    const fn = vi.fn();
    const d = debounce(fn, 800);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() drops a pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 800);
    d('y');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending()).toBe(false);
  });

  it('coalesces a burst of edits into a single save', () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    for (let i = 0; i < 10; i++) {
      d(`edit-${i}`);
      vi.advanceTimersByTime(50); // faster than the debounce window
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('edit-9');
  });
});

describe('default timers (renderer safety)', () => {
  // The default timers must wrap the native functions so they keep this===window
  // in Chromium; bare setTimeout/clearTimeout refs throw "Illegal invocation".
  it('schedules + fires through the real default timers without throwing', async () => {
    vi.useRealTimers();
    const fn = vi.fn();
    const d = debounce(fn, 10); // default timers, no injection
    expect(() => d('x')).not.toThrow(); // calling must not throw (the bug threw here in Chromium)
    await new Promise((r) => setTimeout(r, 40));
    expect(fn).toHaveBeenCalledWith('x');
    expect(() => d.cancel()).not.toThrow();
    vi.useFakeTimers();
  });
});

describe('wordCount', () => {
  it('counts whitespace-separated words; empty is 0', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('hello')).toBe(1);
    expect(wordCount('the quick brown fox')).toBe(4);
    expect(wordCount('multiple\n\nlines  and   spaces')).toBe(4);
  });
});
