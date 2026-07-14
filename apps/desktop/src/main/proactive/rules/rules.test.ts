import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { defaultSettings, type Settings } from '@apollo/shared';
import { openDb, type Db } from '../../db/connection';
import { migrate } from '../../db/migrate';
import { createRepos, type Repos } from '../../db/repos/index';
import { meetingLead } from './meetingLead';
import { tomorrowPreview } from './tomorrowPreview';
import { overdueTodos } from './overdueTodos';
import { type RuleCtx } from '../types';

const TZ = 'America/Los_Angeles';
let db: Db;
let repos: Repos;

function ctx(nowIso: string, over: Partial<RuleCtx> = {}): RuleCtx {
  const settings: Settings = defaultSettings();
  return {
    now: DateTime.fromISO(nowIso, { zone: TZ }).toMillis(),
    tz: TZ,
    repos,
    settings,
    gmailConnected: false,
    ...over,
  };
}

function mkEvent(startIso: string, opts: { durMin?: number; allDay?: boolean; location?: string; rrule?: string } = {}): void {
  const start = DateTime.fromISO(startIso, { zone: TZ });
  repos.events.create({
    title: 'Standup',
    startTs: start.toMillis(),
    endTs: start.plus({ minutes: opts.durMin ?? 30 }).toMillis(),
    tz: TZ,
    allDay: opts.allDay ?? false,
    location: opts.location ?? null,
    rrule: opts.rrule ?? null,
  });
}

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

describe('meeting_lead rule', () => {
  it('fires for a non-all-day occurrence starting within leadMin (positive)', async () => {
    mkEvent('2026-07-13T09:40:00'); // 10 min after 09:30
    const c = await meetingLead.evaluate(ctx('2026-07-13T09:30:00'));
    expect(c).toHaveLength(1);
    expect(c[0]!.urgency).toBe('time-sensitive');
    expect(c[0]!.dedupeKey).toMatch(/\+/);
    expect(c[0]!.expiresAt).toBe(DateTime.fromISO('2026-07-13T09:40:00', { zone: TZ }).toMillis());
  });

  it('does not fire before the lead window (negative)', async () => {
    mkEvent('2026-07-13T10:00:00'); // 30 min out, lead is 10
    expect(await meetingLead.evaluate(ctx('2026-07-13T09:30:00'))).toHaveLength(0);
  });

  it('never fires after start', async () => {
    mkEvent('2026-07-13T09:25:00');
    expect(await meetingLead.evaluate(ctx('2026-07-13T09:30:00'))).toHaveLength(0);
  });

  it('excludes all-day events (boundary)', async () => {
    mkEvent('2026-07-13T09:35:00', { allDay: true });
    expect(await meetingLead.evaluate(ctx('2026-07-13T09:30:00'))).toHaveLength(0);
  });

  it('dedupeKey is stable per occurrence (fires once)', async () => {
    mkEvent('2026-07-13T09:38:00');
    const a = await meetingLead.evaluate(ctx('2026-07-13T09:30:00'));
    const b = await meetingLead.evaluate(ctx('2026-07-13T09:31:00'));
    expect(a[0]!.dedupeKey).toBe(b[0]!.dedupeKey);
  });
});

describe('tomorrow_preview rule', () => {
  it('fires at 21:00 when tomorrow has >=3 events', async () => {
    mkEvent('2026-07-14T10:00:00');
    mkEvent('2026-07-14T12:00:00');
    mkEvent('2026-07-14T15:00:00');
    const c = await tomorrowPreview.evaluate(ctx('2026-07-13T21:00:00'));
    expect(c).toHaveLength(1);
    expect(c[0]!.card?.kind).toBe('eventList');
    expect(c[0]!.dedupeKey).toBe('2026-07-14');
  });

  it('fires when tomorrow has an early (<09:00) event even if only one', async () => {
    mkEvent('2026-07-14T07:30:00');
    expect(await tomorrowPreview.evaluate(ctx('2026-07-13T21:00:00'))).toHaveLength(1);
  });

  it('does not fire before atHH', async () => {
    mkEvent('2026-07-14T10:00:00');
    mkEvent('2026-07-14T12:00:00');
    mkEvent('2026-07-14T15:00:00');
    expect(await tomorrowPreview.evaluate(ctx('2026-07-13T20:00:00'))).toHaveLength(0);
  });

  it('does not fire for a light, late day (negative)', async () => {
    mkEvent('2026-07-14T14:00:00');
    mkEvent('2026-07-14T16:00:00');
    expect(await tomorrowPreview.evaluate(ctx('2026-07-13T21:00:00'))).toHaveLength(0);
  });
});

describe('overdue_todos rule', () => {
  it('fires at 16:00 for todos overdue more than 24h', async () => {
    repos.todos.add({ content: 'file taxes', dueTs: DateTime.fromISO('2026-07-11T10:00:00', { zone: TZ }).toMillis() });
    const c = await overdueTodos.evaluate(ctx('2026-07-13T16:00:00'));
    expect(c).toHaveLength(1);
    expect(c[0]!.urgency).toBe('low');
    expect(c[0]!.body).toContain('file taxes');
  });

  it('ignores todos overdue by less than 24h (boundary)', async () => {
    repos.todos.add({ content: 'recent', dueTs: DateTime.fromISO('2026-07-13T10:00:00', { zone: TZ }).toMillis() }); // 6h ago
    expect(await overdueTodos.evaluate(ctx('2026-07-13T16:00:00'))).toHaveLength(0);
  });

  it('ignores completed todos', async () => {
    const t = repos.todos.add({ content: 'done one', dueTs: DateTime.fromISO('2026-07-11T10:00:00', { zone: TZ }).toMillis() });
    repos.todos.complete(t.id);
    expect(await overdueTodos.evaluate(ctx('2026-07-13T16:00:00'))).toHaveLength(0);
  });

  it('does not fire before atHH', async () => {
    repos.todos.add({ content: 'file taxes', dueTs: DateTime.fromISO('2026-07-11T10:00:00', { zone: TZ }).toMillis() });
    expect(await overdueTodos.evaluate(ctx('2026-07-13T15:00:00'))).toHaveLength(0);
  });

  it('lists at most 5 items', async () => {
    for (let i = 0; i < 8; i++) repos.todos.add({ content: `task ${i}`, dueTs: DateTime.fromISO('2026-07-11T10:00:00', { zone: TZ }).toMillis() });
    const c = await overdueTodos.evaluate(ctx('2026-07-13T16:00:00'));
    expect(c[0]!.title).toContain('8'); // count reflects all
    expect((c[0]!.card as { kind: 'text'; body: string }).body.split('\n')).toHaveLength(5); // but lists 5
  });
});
