/**
 * Pure debounce (E9 autosave/search debounce logic). Trailing-edge: the wrapped
 * fn runs `waitMs` after the last call. `flush()` runs a pending call now;
 * `cancel()` drops it. Timer functions are injectable so tests use fake clocks.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
): Debounced<A> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const run = (): void => {
    handle = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = ((...args: A): void => {
    lastArgs = args;
    if (handle) timers.clear(handle);
    handle = timers.set(run, waitMs);
  }) as Debounced<A>;

  debounced.flush = (): void => {
    if (handle) {
      timers.clear(handle);
      run();
    }
  };
  debounced.cancel = (): void => {
    if (handle) {
      timers.clear(handle);
      handle = null;
    }
    lastArgs = null;
  };
  debounced.pending = (): boolean => handle !== null;

  return debounced;
}

/** Word count for the notes footer (E3.3). Whitespace-separated, empty → 0. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
