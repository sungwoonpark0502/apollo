import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createReminderTools } from './reminder';
import { createUndoTool } from './undo';
import { createRegistry, type Registry } from './registry';
import { makeCtx } from './registry.test';
import { createScheduler, nextOccurrence } from '../scheduler/scheduler';

const LA = 'America/Los_Angeles';
let db: Db;
let repos: Repos;
let reg: Registry;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  reg = createRegistry([...createReminderTools({ reminders: repos.reminders, undo: repos.undo }), createUndoTool(repos)]);
});

describe('reminder tools', () => {
  it('create with LOCAL tz + undo removes it', async () => {
    const res = await reg.execute('reminder.create', { text: 'take out trash', dueIso: '2026-07-11T21:00:00' }, makeCtx());
    expect(res.llmText).toContain('Reminder set');
    expect(repos.reminders.listPending()).toHaveLength(1);
    await reg.execute('undo.last', {}, makeCtx());
    expect(repos.reminders.listPending()).toHaveLength(0);
  });

  it('complete: fuzzy match, ambiguity lists candidates, undo reopens', async () => {
    await reg.execute('reminder.create', { text: 'call mom', dueIso: '2026-07-11T18:00:00' }, makeCtx());
    await reg.execute('reminder.create', { text: 'call the plumber', dueIso: '2026-07-11T19:00:00' }, makeCtx());

    const ambiguous = await reg.execute('reminder.complete', { text: 'call' }, makeCtx());
    expect(ambiguous.llmText).toMatch(/^WARNING 2 reminders match/);

    const done = await reg.execute('reminder.complete', { text: 'call mom' }, makeCtx());
    expect(done.llmText).toContain('Done: "call mom"');
    expect(repos.reminders.listPending()).toHaveLength(1);

    await reg.execute('undo.last', {}, makeCtx());
    expect(repos.reminders.listPending()).toHaveLength(2);
  });

  it('snooze sets due to now + minutes (default 10)', async () => {
    await reg.execute('reminder.create', { text: 'stretch', dueIso: '2026-07-11T09:00:00' }, makeCtx());
    const res = await reg.execute('reminder.snooze', { text: 'stretch' }, makeCtx());
    expect(res.llmText).toContain('Snoozed "stretch" until 10:10 AM');
    const r = repos.reminders.listPending()[0]!;
    expect(r.dueTs).toBe(makeCtx().now().getTime() + 10 * 60_000);
  });

  it('list shows recurring marker and ids', async () => {
    await reg.execute('reminder.create', { text: 'standup', dueIso: '2026-07-13T09:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }, makeCtx());
    const res = await reg.execute('reminder.list', {}, makeCtx());
    expect(res.llmText).toContain('(recurring)');
    expect(res.llmText).toMatch(/\(id [0-9a-f-]+\)/);
  });
});

describe('recurring re-arm (C19)', () => {
  afterEach(() => vi.useRealTimers());

  it('nextOccurrence preserves 9:00 wall time across the DST fall-back', () => {
    const anchor = DateTime.fromObject({ year: 2026, month: 10, day: 30, hour: 9 }, { zone: LA }).toMillis(); // Fri before DST end
    const after = DateTime.fromObject({ year: 2026, month: 10, day: 30, hour: 9, minute: 1 }, { zone: LA }).toMillis();
    const hours: number[] = [];
    let cursor = after;
    for (let i = 0; i < 3; i++) {
      const n = nextOccurrence('FREQ=DAILY', anchor, cursor, LA);
      expect(n).not.toBeNull();
      hours.push(DateTime.fromMillis(n!, { zone: LA }).hour);
      cursor = n!;
    }
    expect(hours).toEqual([9, 9, 9]); // Oct 31, Nov 1 (DST ends), Nov 2 — all 9 AM local
  });

  it('a recurring reminder fires and re-arms for the next occurrence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DateTime.fromObject({ year: 2026, month: 7, day: 13, hour: 8, minute: 59 }, { zone: LA }).toJSDate());
    const due = DateTime.fromObject({ year: 2026, month: 7, day: 13, hour: 9 }, { zone: LA }).toMillis();
    repos.reminders.create({ text: 'weekday standup', dueTs: due, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });

    const fired: number[] = [];
    const sched = createScheduler({
      repos,
      tz: () => LA,
      onTimerFire: () => undefined,
      onReminderFire: (r) => fired.push(r.dueTs),
    });
    sched.start();
    vi.advanceTimersByTime(90_000);
    expect(fired).toHaveLength(1);

    // re-armed for Tuesday 9:00, not left dead
    const pending = repos.reminders.listPending()[0]!;
    expect(pending.firedAt).toBeNull();
    expect(DateTime.fromMillis(pending.dueTs, { zone: LA }).toFormat('ccc HH:mm')).toBe('Tue 09:00');
    sched.stop();
  });

  it('GATE: missed reminders fire once on boot, grouped in the start() result', () => {
    vi.useFakeTimers();
    const now = Date.now();
    repos.reminders.create({ text: 'missed one', dueTs: now - 3_600_000 });
    repos.reminders.create({ text: 'missed two', dueTs: now - 60_000 });
    repos.timers.start({ label: 'missed timer', endsAt: now - 1_000 });

    const fired: string[] = [];
    const sched = createScheduler({
      repos,
      tz: () => LA,
      onTimerFire: (t) => fired.push(`timer:${t.label}`),
      onReminderFire: (r) => fired.push(`rem:${r.text}`),
    });
    const missed = sched.start();
    expect(missed.reminders).toHaveLength(2);
    expect(missed.timers).toHaveLength(1);
    expect(fired.sort()).toEqual(['rem:missed one', 'rem:missed two', 'timer:missed timer']);

    // nothing double-fires afterwards
    vi.advanceTimersByTime(60_000);
    expect(fired).toHaveLength(3);
    sched.stop();
  });
});
