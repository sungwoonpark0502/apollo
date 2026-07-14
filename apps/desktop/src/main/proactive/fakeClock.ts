/**
 * Deterministic fake clock + timer wheel for governor/engine tests (F7). `now()`
 * returns the current virtual time; `setTimer` registers callbacks; `advance(ms)`
 * moves time forward, firing due timers in order.
 */
export interface FakeClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { cancel: () => void };
  advance: (ms: number) => void;
  set: (ms: number) => void;
}

export function createFakeClock(startMs: number): FakeClock {
  let current = startMs;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();

  function fireDue(): void {
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at <= current && (t.at < nextAt || (t.at === nextAt && id < nextId))) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === -1) break;
      const t = timers.get(nextId);
      timers.delete(nextId);
      t?.fn();
    }
  }

  return {
    now: () => current,
    setTimer: (fn, ms) => {
      const id = seq++;
      timers.set(id, { at: current + Math.max(0, ms), fn });
      return { cancel: () => timers.delete(id) };
    },
    advance: (ms) => {
      const target = current + ms;
      // fire timers step-by-step so chained deferrals resolve in virtual order
      for (;;) {
        let nextAt = Infinity;
        for (const t of timers.values()) if (t.at > current && t.at <= target && t.at < nextAt) nextAt = t.at;
        if (nextAt === Infinity) break;
        current = nextAt;
        fireDue();
      }
      current = target;
      fireDue();
    },
    set: (ms) => {
      current = ms;
      fireDue();
    },
  };
}
