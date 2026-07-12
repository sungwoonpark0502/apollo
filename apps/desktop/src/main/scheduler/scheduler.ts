import { DateTime } from 'luxon';
import * as rrulePkg from 'rrule';
import { type Repos } from '../db/repos/index';
import { type TimerRow } from '../db/repos/timers';
import { type ReminderRow } from '../db/repos/reminders';
import { type AlarmRow } from '../db/repos/alarms';

const { RRule } = (rrulePkg as { default?: typeof rrulePkg }).default ?? rrulePkg;

/**
 * Next occurrence strictly after `afterMs`, preserving local wall time across
 * DST (same fake-UTC technique as eventsRepo.expandOccurrences).
 */
export function nextOccurrence(rule: string, anchorMs: number, afterMs: number, tz: string): number | null {
  let opts;
  try {
    opts = RRule.parseString(rule);
  } catch {
    return null;
  }
  const anchor = DateTime.fromMillis(anchorMs, { zone: tz });
  opts.dtstart = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day, anchor.hour, anchor.minute, anchor.second));
  const r = new RRule(opts);
  const after = DateTime.fromMillis(afterMs, { zone: tz });
  const wallAfter = new Date(Date.UTC(after.year, after.month - 1, after.day, after.hour, after.minute, after.second));
  const next = r.after(wallAfter, false);
  if (!next) return null;
  return DateTime.fromObject(
    {
      year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(),
      hour: next.getUTCHours(), minute: next.getUTCMinutes(), second: next.getUTCSeconds(),
    },
    { zone: tz },
  ).toMillis();
}

/**
 * C19 tick strategy: one setTimeout armed to the next due timestamp,
 * recomputed on any mutation — never per-second polling. On boot (and on
 * power resume) catchUp() fires missed items; callers group them into one
 * "While you were away" notification.
 */
export interface SchedulerDeps {
  repos: Repos;
  now?: () => number;
  tz?: () => string;
  onTimerFire: (t: TimerRow) => void;
  onReminderFire?: (r: ReminderRow) => void;
  onAlarmFire?: (a: AlarmRow) => void;
  log?: (msg: string) => void;
}

const MAX_DELAY = 2 ** 31 - 1;

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? Date.now;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function nextDueTs(): number | null {
    const candidates: number[] = [];
    const t = deps.repos.timers.listActive()[0];
    if (t) candidates.push(t.endsAt);
    const r = deps.repos.reminders.listPending().find((x) => x.firedAt === null);
    if (r) candidates.push(r.dueTs);
    const a = deps.repos.alarms.listEnabled().find((x) => x.firedAt === null);
    if (a) candidates.push(a.atTs);
    return candidates.length ? Math.min(...candidates) : null;
  }

  function fireDue(): { timers: TimerRow[]; reminders: ReminderRow[]; alarms: AlarmRow[] } {
    const at = now();
    const timers = deps.repos.timers.due(at);
    for (const t of timers) {
      deps.repos.timers.markFired(t.id, at);
      deps.onTimerFire(t);
    }
    const tz = deps.tz?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const reminders = deps.repos.reminders.due(at);
    for (const r of reminders) {
      deps.repos.reminders.markFired(r.id, at);
      deps.onReminderFire?.(r);
      if (r.rrule) {
        const next = nextOccurrence(r.rrule, r.dueTs, at, tz);
        if (next !== null) deps.repos.reminders.rearm(r.id, next);
      }
    }
    const alarms = deps.repos.alarms.due(at);
    for (const a of alarms) {
      deps.repos.alarms.markFired(a.id, at);
      deps.onAlarmFire?.(a);
      if (a.rrule) {
        const next = nextOccurrence(a.rrule, a.atTs, at, tz);
        if (next !== null) deps.repos.alarms.rearm(a.id, next);
      }
    }
    return { timers, reminders, alarms };
  }

  function arm(): void {
    if (stopped) return;
    if (handle) clearTimeout(handle);
    handle = null;
    const next = nextDueTs();
    if (next === null) return;
    const delay = Math.min(Math.max(0, next - now()), MAX_DELAY);
    handle = setTimeout(() => {
      fireDue();
      arm();
    }, delay);
    deps.log?.(`scheduler armed in ${delay}ms`);
  }

  return {
    /** Boot / power-resume entry: fires everything missed, then arms the tick. */
    start(): { timers: TimerRow[]; reminders: ReminderRow[]; alarms: AlarmRow[] } {
      stopped = false;
      const missed = fireDue();
      arm();
      return missed;
    },
    /** Call after any timer/reminder/alarm mutation. */
    rearm: arm,
    stop(): void {
      stopped = true;
      if (handle) clearTimeout(handle);
      handle = null;
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
