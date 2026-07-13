import { DateTime } from 'luxon';

/**
 * C19 daily brief scheduler. Fires at the configured time (default 08:30) if
 * the user is active (input in the last 10 min); otherwise defers to the next
 * activity. Re-arms for the next day after firing. Independent of the
 * timer/reminder scheduler.
 */
export interface DailyBriefDeps {
  getBriefTimeHHMM: () => string;
  tz: () => string;
  isUserActive: () => boolean; // input within the last 10 minutes
  runBrief: () => void;
  now?: () => number;
  log?: (msg: string) => void;
}

const MAX_DELAY = 2 ** 31 - 1;

export function computeNextBrief(hhmm: string, tz: string, nowMs: number): number {
  const [hh, mm] = hhmm.split(':').map((x) => parseInt(x, 10));
  const nowDt = DateTime.fromMillis(nowMs, { zone: tz });
  let target = nowDt.set({ hour: hh ?? 8, minute: mm ?? 30, second: 0, millisecond: 0 });
  if (target.toMillis() <= nowMs) target = target.plus({ days: 1 });
  return target.toMillis();
}

export function createDailyBrief(deps: DailyBriefDeps) {
  const now = deps.now ?? Date.now;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let pending = false; // brief time passed while the user was away
  let stopped = false;

  function fire(): void {
    if (deps.isUserActive()) {
      pending = false;
      deps.log?.('daily brief firing (user active)');
      deps.runBrief();
    } else {
      pending = true;
      deps.log?.('daily brief deferred (user away)');
    }
    arm();
  }

  function arm(): void {
    if (stopped) return;
    if (handle) clearTimeout(handle);
    const target = computeNextBrief(deps.getBriefTimeHHMM(), deps.tz(), now());
    const delay = Math.min(MAX_DELAY, Math.max(0, target - now()));
    handle = setTimeout(fire, delay);
    deps.log?.(`daily brief armed in ${delay}ms`);
  }

  return {
    start(): void {
      stopped = false;
      arm();
    },
    stop(): void {
      stopped = true;
      if (handle) clearTimeout(handle);
      handle = null;
    },
    /** Called when the user interacts; fires a deferred brief once they return. */
    noteActivity(): void {
      if (pending && deps.isUserActive()) {
        pending = false;
        deps.log?.('daily brief firing (deferred, user returned)');
        deps.runBrief();
      }
    },
    isPending(): boolean {
      return pending;
    },
    rearm: arm,
  };
}

export type DailyBrief = ReturnType<typeof createDailyBrief>;
