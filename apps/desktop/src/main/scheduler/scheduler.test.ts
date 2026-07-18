import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createScheduler } from './scheduler';

let db: Db;
let repos: Repos;

beforeEach(() => {
  vi.useFakeTimers();
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduler (C19)', () => {
  it('fires a timer at its due time with a single armed timeout', () => {
    const fired: string[] = [];
    const sched = createScheduler({ repos, onTimerFire: (t) => fired.push(t.id) });
    const t = repos.timers.start({ endsAt: Date.now() + 5_000 });
    sched.start();

    vi.advanceTimersByTime(4_999);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(fired).toEqual([t.id]);
    expect(repos.timers.listActive()).toHaveLength(0);
    sched.stop();
  });

  it('rearms to the next timer after firing (multiple concurrent timers)', () => {
    const fired: Array<string | null> = [];
    const sched = createScheduler({ repos, onTimerFire: (t) => fired.push(t.label) });
    repos.timers.start({ label: 'first', endsAt: Date.now() + 1_000 });
    repos.timers.start({ label: 'second', endsAt: Date.now() + 3_000 });
    sched.start();

    vi.advanceTimersByTime(1_100);
    expect(fired).toEqual(['first']);
    vi.advanceTimersByTime(2_000);
    expect(fired).toEqual(['first', 'second']);
    sched.stop();
  });

  it('GATE 0.7: a persisted timer fires after an app restart (catch-up on boot)', () => {
    // "App session 1": timer set, app quits before it fires.
    const t = repos.timers.start({ label: 'pasta', endsAt: Date.now() + 60_000 });

    // Time passes while the app is closed.
    vi.setSystemTime(Date.now() + 120_000);

    // "App session 2": same db, fresh scheduler. Boot catch-up must fire it.
    const fired: string[] = [];
    const sched = createScheduler({ repos, onTimerFire: (x) => fired.push(x.id) });
    const missed = sched.start();
    expect(fired).toEqual([t.id]);
    expect(missed.timers.map((x) => x.id)).toEqual([t.id]);
    expect(repos.timers.due(Date.now())).toHaveLength(0); // marked fired, not refired
    sched.stop();
  });

  it('a future timer set before restart still fires on time in the new session', () => {
    repos.timers.start({ label: 'later', endsAt: Date.now() + 300_000 });
    const fired: Array<string | null> = [];
    const sched = createScheduler({ repos, onTimerFire: (t) => fired.push(t.label) });
    expect(sched.start().timers).toHaveLength(0); // nothing missed
    vi.advanceTimersByTime(300_001);
    expect(fired).toEqual(['later']);
    sched.stop();
  });

  // J3 wall-clock jump resilience: the 60s sanity check recomputes from absolute targets.
  it('J3: a forward wall-clock jump fires an overdue timer within one sanity tick', () => {
    const fired: string[] = [];
    const start = Date.now();
    const sched = createScheduler({ repos, onTimerFire: (t) => fired.push(t.id) });
    const t = repos.timers.start({ endsAt: start + 5 * 60_000 }); // due in 5 min
    sched.start();
    // Manual clock change forward 10 min WITHOUT elapsed monotonic time.
    vi.setSystemTime(start + 10 * 60_000);
    expect(fired).toHaveLength(0); // the armed setTimeout hasn't elapsed monotonically
    vi.advanceTimersByTime(60_000); // one sanity tick recomputes from the absolute target
    expect(fired).toEqual([t.id]);
    sched.stop();
  });

  it('J3: a backward wall-clock jump does not fire early; the item still fires at its absolute target', () => {
    const fired: string[] = [];
    const start = Date.now();
    const sched = createScheduler({ repos, onTimerFire: (t) => fired.push(t.id) });
    repos.timers.start({ endsAt: start + 5 * 60_000 });
    sched.start();
    vi.setSystemTime(start - 60 * 60_000); // clock jumps back an hour
    vi.advanceTimersByTime(60_000); // sanity tick
    expect(fired).toHaveLength(0); // not yet due against the (now earlier) wall clock
    vi.setSystemTime(start + 5 * 60_000); // reach the absolute target
    vi.advanceTimersByTime(60_000);
    expect(fired).toHaveLength(1);
    sched.stop();
  });

  it('J3 resume storm: catchUp fires timer+reminder+alarm all overdue after a suspend, grouped once', () => {
    const start = Date.now();
    const fired: string[] = [];
    const sched = createScheduler({
      repos,
      onTimerFire: (t) => fired.push(`timer:${t.id}`),
      onReminderFire: (r) => fired.push(`rem:${r.id}`),
      onAlarmFire: (a) => fired.push(`alarm:${a.id}`),
    });
    repos.timers.start({ endsAt: start + 60_000 });
    repos.reminders.create({ text: 'r', dueTs: start + 90_000 });
    repos.alarms.set({ atTs: start + 120_000, label: 'a' });
    sched.start();
    // Machine suspends; wall clock advances past all three; resume fires them together.
    vi.setSystemTime(start + 10 * 60_000);
    const missed = sched.catchUp();
    expect(missed.timers.length + missed.reminders.length + missed.alarms.length).toBe(3);
    expect(fired).toHaveLength(3);
    // A second catchUp does not re-fire (already marked fired).
    expect(sched.catchUp().timers).toHaveLength(0);
    sched.stop();
  });

  it('canceled timers never fire; rearm reflects mutations', () => {
    const fired: string[] = [];
    const sched = createScheduler({ repos, onTimerFire: (t) => fired.push(t.id) });
    const t = repos.timers.start({ endsAt: Date.now() + 1_000 });
    sched.start();
    repos.timers.cancel(t.id);
    sched.rearm();
    vi.advanceTimersByTime(2_000);
    expect(fired).toHaveLength(0);
    sched.stop();
  });

  it('fires due reminders and alarms too', () => {
    const got: string[] = [];
    const sched = createScheduler({
      repos,
      onTimerFire: () => undefined,
      onReminderFire: (r) => got.push(`rem:${r.text}`),
      onAlarmFire: (a) => got.push(`alarm:${a.label}`),
    });
    repos.reminders.create({ text: 'stretch', dueTs: Date.now() + 1_000 });
    repos.alarms.set({ label: 'wake', atTs: Date.now() + 2_000 });
    sched.start();
    vi.advanceTimersByTime(2_100);
    expect(got).toEqual(['rem:stretch', 'alarm:wake']);
    sched.stop();
  });
});
