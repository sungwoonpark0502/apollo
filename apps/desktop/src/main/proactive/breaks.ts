import type { Settings } from '@apollo/shared';

/**
 * Break reminders. Pure decision function plus a thin scheduler, so the
 * politeness rules are testable against a clock rather than observed by waiting
 * an hour.
 *
 * The rules exist because a break reminder is the easiest feature in the app to
 * make annoying:
 *  - never during quiet hours, which is when the user already said not to;
 *  - never mid-turn, so it cannot interrupt an answer being spoken;
 *  - only when the user has actually been at the machine, or an idle laptop
 *    accumulates reminders that all fire the moment they sit down;
 *  - the interval restarts after any reminder, so a missed window does not
 *    immediately fire on the next tick.
 */
export interface BreakDeps {
  settings: () => Settings;
  now: () => number;
  /** True while a turn is in flight or voice is active. */
  busy: () => boolean;
  /** True when there has been recent user input (C19 uses a 10-minute window). */
  userActive: () => boolean;
  /** True inside quiet hours. */
  isDnd: (atMs: number) => boolean;
  notify: () => void;
}

export type BreakDecision =
  | { kind: 'fire' }
  | { kind: 'skip'; why: 'disabled' | 'tooSoon' | 'dnd' | 'busy' | 'inactive' };

/**
 * Whether a break reminder should fire now, given when the last one did.
 * `lastFiredMs` of 0 means none yet, in which case the first is due one full
 * interval after the session starts rather than immediately.
 */
export function breakDecision(
  deps: Pick<BreakDeps, 'settings' | 'busy' | 'userActive' | 'isDnd'>,
  nowMs: number,
  lastFiredMs: number,
): BreakDecision {
  const cfg = deps.settings().breaks;
  if (!cfg.enabled) return { kind: 'skip', why: 'disabled' };
  if (nowMs - lastFiredMs < cfg.everyMin * 60_000) return { kind: 'skip', why: 'tooSoon' };
  if (deps.isDnd(nowMs)) return { kind: 'skip', why: 'dnd' };
  // Deferred rather than dropped: busy and inactive both mean "not now", and
  // the caller keeps the timer running so the next tick can reconsider.
  if (deps.busy()) return { kind: 'skip', why: 'busy' };
  if (cfg.onlyWhenActive && !deps.userActive()) return { kind: 'skip', why: 'inactive' };
  return { kind: 'fire' };
}

const TICK_MS = 60_000;

export function createBreakScheduler(deps: BreakDeps) {
  let timer: ReturnType<typeof setInterval> | null = null;
  // Seeded to "now" so the first reminder is a full interval away, not
  // immediate on launch.
  let lastFired = deps.now();

  function tick(): void {
    const decision = breakDecision(deps, deps.now(), lastFired);
    if (decision.kind !== 'fire') return;
    lastFired = deps.now();
    deps.notify();
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(tick, TICK_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Settings changed: restart the interval from now, never fire on the spot. */
    reset(): void {
      lastFired = deps.now();
    },
    /** Test seam. */
    tick,
  };
}

export type BreakScheduler = ReturnType<typeof createBreakScheduler>;
