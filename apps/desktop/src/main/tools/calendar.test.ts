import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createCalendarTools } from './calendar';
import { createUndoTool } from './undo';
import { createRegistry, type Registry } from './registry';
import { makeCtx } from './registry.test';

const LA = 'America/Los_Angeles';
let db: Db;
let repos: Repos;
let reg: Registry;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  reg = createRegistry([...createCalendarTools({ events: repos.events, undo: repos.undo }), createUndoTool(repos)]);
});

describe('J1.2 EventDTO calendar defaults', () => {
  it('an event created via the Phase-0-era calendar.create path lands with a valid calendarId and derived color', async () => {
    const res = await reg.execute('calendar.create', { title: 'Standup', startIso: '2026-07-14T09:00:00' }, makeCtx());
    const card = res.card as { kind: 'event'; event: { calendarId: string; color: string } };
    expect(card.event.calendarId).toBe('default');
    expect(card.event.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('honors a configured non-default calendar for AI-created events', async () => {
    const reg2 = createRegistry([
      ...createCalendarTools({ events: repos.events, undo: repos.undo, defaultCalendarId: () => 'work' }),
      createUndoTool(repos),
    ]);
    const res = await reg2.execute('calendar.create', { title: 'Sync', startIso: '2026-07-14T10:00:00' }, makeCtx());
    const card = res.card as { kind: 'event'; event: { calendarId: string } };
    expect(card.event.calendarId).toBe('work');
  });
});

describe('calendar.create', () => {
  it('creates with LOCAL tz, default 1h end, event card, undo token', async () => {
    const res = await reg.execute('calendar.create', { title: 'Dentist', startIso: '2026-07-14T15:00:00' }, makeCtx());
    expect(res.llmText).toContain('Created "Dentist"');
    expect(res.card).toMatchObject({ kind: 'event', event: { title: 'Dentist', tz: LA } });
    expect(res.undoToken).toBeTruthy();

    const undo = await reg.execute('undo.last', {}, makeCtx());
    expect(undo.llmText).toContain('removed the event');
    expect(repos.events.search('Dentist')).toHaveLength(0);
  });

  it('honors an explicit per-event tz', async () => {
    await reg.execute('calendar.create', { title: 'Tokyo call', startIso: '2026-07-20T09:00:00', tz: 'Asia/Tokyo' }, makeCtx());
    const ev = repos.events.search('Tokyo call')[0]!;
    expect(ev.tz).toBe('Asia/Tokyo');
    expect(DateTime.fromMillis(ev.startTs, { zone: 'Asia/Tokyo' }).hour).toBe(9);
  });

  it('warns on overlap and past start', async () => {
    await reg.execute('calendar.create', { title: 'Existing', startIso: '2026-07-14T15:00:00' }, makeCtx());
    const overlap = await reg.execute('calendar.create', { title: 'Clash', startIso: '2026-07-14T15:30:00' }, makeCtx());
    expect(overlap.llmText).toContain('WARNING overlaps: Existing');

    const past = await reg.execute('calendar.create', { title: 'Old', startIso: '2020-01-01T10:00:00' }, makeCtx());
    expect(past.llmText).toContain('WARNING start time is in the past');
  });

  it('rejects invalid times and end before start', async () => {
    expect((await reg.execute('calendar.create', { title: 'X', startIso: 'garbage' }, makeCtx())).llmText).toMatch(/^ERROR invalid start/);
    expect(
      (await reg.execute('calendar.create', { title: 'X', startIso: '2026-07-14T15:00:00', endIso: '2026-07-14T14:00:00' }, makeCtx())).llmText,
    ).toMatch(/^ERROR invalid end/);
  });
});

describe('calendar.list / search', () => {
  it('expands recurrence within range, caps at 20, returns eventList card', async () => {
    await reg.execute(
      'calendar.create',
      { title: 'Daily standup', startIso: '2026-07-01T09:30:00', rrule: 'FREQ=DAILY' },
      makeCtx(),
    );
    const res = await reg.execute('calendar.list', { startIso: '2026-07-13T00:00:00', endIso: '2026-08-13T00:00:00' }, makeCtx());
    expect(res.card).toMatchObject({ kind: 'eventList' });
    const card = res.card as { kind: 'eventList'; events: unknown[] };
    expect(card.events).toHaveLength(20); // cap
  });

  it('defaults to today and includes ids', async () => {
    await reg.execute('calendar.create', { title: 'Today thing', startIso: '2026-07-11T14:00:00' }, makeCtx());
    const res = await reg.execute('calendar.list', {}, makeCtx());
    expect(res.llmText).toContain('Today thing');
    expect(res.llmText).toMatch(/\(id [0-9a-f-]+\)/);
  });

  it('search finds by title/location', async () => {
    await reg.execute('calendar.create', { title: 'Lunch', startIso: '2026-07-15T12:00:00', location: 'Blue Door Cafe' }, makeCtx());
    expect((await reg.execute('calendar.search', { query: 'blue door' }, makeCtx())).llmText).toContain('Lunch');
  });
});

describe('calendar.update', () => {
  it('scope all: reschedules keeping duration; undo restores original time', async () => {
    const created = await reg.execute(
      'calendar.create',
      { title: 'Review', startIso: '2026-07-14T15:00:00', endIso: '2026-07-14T16:30:00' },
      makeCtx(),
    );
    const id = (created.card as { event: { id: string } }).event.id;
    const res = await reg.execute('calendar.update', { id, startIso: '2026-07-16T10:00:00' }, makeCtx());
    expect(res.llmText).toContain('Thu, Jul 16, 10:00 AM');
    const ev = repos.events.get(id)!;
    expect(ev.endTs! - ev.startTs).toBe(90 * 60_000); // duration preserved

    await reg.execute('undo.last', {}, makeCtx());
    const back = repos.events.get(id)!;
    expect(DateTime.fromMillis(back.startTs, { zone: LA }).toISODate()).toBe('2026-07-14');
  });

  it('scope single on a recurring event: exdate + detached event; series unchanged; undoable', async () => {
    const created = await reg.execute(
      'calendar.create',
      { title: 'Standup', startIso: '2026-07-06T09:30:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' },
      makeCtx(),
    );
    const id = (created.card as { event: { id: string } }).event.id;

    const res = await reg.execute(
      'calendar.update',
      { id, scope: 'single', occurrenceDateIso: '2026-07-20', startIso: '2026-07-20T14:00:00' },
      makeCtx(),
    );
    expect(res.llmText).toContain('Moved the 2026-07-20 occurrence');

    const lo = DateTime.fromISO('2026-07-19', { zone: LA }).toMillis();
    const hi = DateTime.fromISO('2026-07-22', { zone: LA }).toMillis();
    const occs = repos.events.expandOccurrences(lo, hi);
    expect(occs).toHaveLength(1); // original Monday 9:30 replaced by detached 14:00
    expect(DateTime.fromMillis(occs[0]!.occStartTs, { zone: LA }).hour).toBe(14);

    // other weeks untouched
    const nextWeek = repos.events.expandOccurrences(
      DateTime.fromISO('2026-07-26', { zone: LA }).toMillis(),
      DateTime.fromISO('2026-07-29', { zone: LA }).toMillis(),
    );
    expect(DateTime.fromMillis(nextWeek[0]!.occStartTs, { zone: LA }).hour).toBe(9);

    await reg.execute('undo.last', {}, makeCtx());
    const restored = repos.events.expandOccurrences(lo, hi);
    expect(restored).toHaveLength(1);
    expect(DateTime.fromMillis(restored[0]!.occStartTs, { zone: LA }).hour).toBe(9);
  });

  it('scope single without occurrenceDateIso errors clearly', async () => {
    const created = await reg.execute(
      'calendar.create',
      { title: 'Gym', startIso: '2026-07-07T18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
      makeCtx(),
    );
    const id = (created.card as { event: { id: string } }).event.id;
    expect((await reg.execute('calendar.update', { id, scope: 'single', startIso: '2026-07-14T19:00:00' }, makeCtx())).llmText).toMatch(
      /^ERROR scope "single" needs/,
    );
  });
});

describe('calendar.delete', () => {
  it('scope single removes one occurrence via exdate; undo restores it', async () => {
    const created = await reg.execute(
      'calendar.create',
      { title: 'Standup', startIso: '2026-07-06T09:30:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' },
      makeCtx(),
    );
    const id = (created.card as { event: { id: string } }).event.id;
    await reg.execute('calendar.delete', { id, scope: 'single', occurrenceDateIso: '2026-07-13' }, makeCtx());

    const lo = DateTime.fromISO('2026-07-12', { zone: LA }).toMillis();
    const hi = DateTime.fromISO('2026-07-15', { zone: LA }).toMillis();
    expect(repos.events.expandOccurrences(lo, hi)).toHaveLength(0);

    await reg.execute('undo.last', {}, makeCtx());
    expect(repos.events.expandOccurrences(lo, hi)).toHaveLength(1);
  });

  it('scope all soft-deletes the series; undo restores', async () => {
    const created = await reg.execute(
      'calendar.create',
      { title: 'Series', startIso: '2026-07-06T09:00:00', rrule: 'FREQ=DAILY' },
      makeCtx(),
    );
    const id = (created.card as { event: { id: string } }).event.id;
    const res = await reg.execute('calendar.delete', { id }, makeCtx());
    expect(res.llmText).toContain('whole series');
    expect(repos.events.get(id)!.deletedAt).not.toBeNull();

    await reg.execute('undo.last', {}, makeCtx());
    expect(repos.events.get(id)!.deletedAt).toBeNull();
  });
});
