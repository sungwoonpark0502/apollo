import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createSyncEngine, type ConflictInfo } from './syncEngine';
import { GEtagError, type GCalListEntry, type GEvent, type GEventsPage, type GoogleCalendarClient } from './types';

const CAL = 'google:cal-1';

class MockGoogle implements GoogleCalendarClient {
  calendars: GCalListEntry[] = [];
  pages: GEventsPage[] = [];
  lastSyncTokens: Array<string | null | undefined> = [];
  inserted: GEvent[] = [];
  patched: Array<{ remoteId: string; etag: string; body: Partial<GEvent> }> = [];
  deleted: string[] = [];
  etagFailFor = new Set<string>();
  insertImpl: ((e: Partial<GEvent>) => Promise<GEvent>) | null = null;

  async listCalendars(): Promise<GCalListEntry[]> {
    return this.calendars;
  }
  async listEvents(_c: string, opts: { syncToken?: string | null }): Promise<GEventsPage> {
    this.lastSyncTokens.push(opts.syncToken);
    return this.pages.shift() ?? { items: [] };
  }
  async insertEvent(_c: string, e: Partial<GEvent>): Promise<GEvent> {
    if (this.insertImpl) return this.insertImpl(e);
    const g: GEvent = { id: e.id ?? `r_${this.inserted.length + 1}`, etag: 'etag-new', ...e } as GEvent;
    this.inserted.push(g);
    return g;
  }
  async patchEvent(_c: string, remoteId: string, body: Partial<GEvent>, etag: string): Promise<GEvent> {
    if (this.etagFailFor.has(remoteId)) throw new GEtagError(remoteId);
    this.patched.push({ remoteId, etag, body });
    return { id: remoteId, etag: 'etag-2', ...body } as GEvent;
  }
  async deleteEvent(_c: string, remoteId: string, _etag: string): Promise<void> {
    if (this.etagFailFor.has(remoteId)) throw new GEtagError(remoteId);
    this.deleted.push(remoteId);
  }
}

let db: Db;
let repos: Repos;
let google: MockGoogle;
let conflicts: ConflictInfo[];

function engine(direction: 'read-only' | 'two-way' = 'two-way') {
  return createSyncEngine({
    client: google,
    events: repos.events,
    sync: repos.sync,
    syncedCalendars: () => [CAL],
    directionOf: () => direction,
    now: () => 1_800_000_000_000,
    onConflict: (c) => conflicts.push(c),
  });
}

const timed = (id: string, start: string, opts: Partial<GEvent> = {}): GEvent => ({
  id, etag: `etag-${id}`, status: 'confirmed', summary: `Event ${id}`,
  start: { dateTime: start, timeZone: 'America/Los_Angeles' },
  end: { dateTime: DateTime.fromISO(start, { setZone: true }).plus({ hours: 1 }).toISO()!, timeZone: 'America/Los_Angeles' },
  ...opts,
});

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  google = new MockGoogle();
  conflicts = [];
});

describe('I7 sync engine — pull', () => {
  it('does an incremental pull and stores the next sync token', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 'tok-1' }];
    const eng = engine();
    const changed = await eng.pull(CAL);
    expect(changed).toBe(1);
    expect(repos.sync.getToken(CAL)).toBe('tok-1');
    const row = repos.events.getByRemoteId('a')!;
    expect(row.title).toBe('Event a');
    // second pull sends the stored token
    google.pages = [{ items: [], nextSyncToken: 'tok-2' }];
    await eng.pull(CAL);
    expect(google.lastSyncTokens).toEqual([null, 'tok-1']);
  });

  it('converts timezones correctly (LA offset → epoch ms)', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 't' }];
    await engine().pull(CAL);
    const row = repos.events.getByRemoteId('a')!;
    expect(row.startTs).toBe(DateTime.fromISO('2026-07-15T09:00:00-07:00').toMillis());
    expect(row.tz).toBe('America/Los_Angeles');
  });

  it('maps Google recurrence to RRULE + EXDATE with expansion parity', async () => {
    google.pages = [{
      items: [timed('r', '2026-07-13T09:00:00-07:00', { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;VALUE=DATE:20260720'] })],
      nextSyncToken: 't',
    }];
    await engine().pull(CAL);
    const row = repos.events.getByRemoteId('r')!;
    expect(row.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(row.exdates).toContain('2026-07-20');
    // the exdated Monday is skipped by expansion
    const occ = repos.events.expandOccurrences(DateTime.fromISO('2026-07-20').toMillis(), DateTime.fromISO('2026-07-21').toMillis());
    expect(occ.find((o) => o.eventId === row.id)).toBeUndefined();
  });

  it('full-resyncs on 410 GONE, dropping the stale token', async () => {
    repos.sync.setToken(CAL, 'stale', 1);
    google.pages = [{ items: [], gone: true }, { items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 'fresh' }];
    await engine().pull(CAL);
    expect(google.lastSyncTokens).toEqual(['stale', null]); // retried with a null token
    expect(repos.sync.getToken(CAL)).toBe('fresh');
    expect(repos.events.getByRemoteId('a')).not.toBeNull();
  });

  it('tombstones a remotely-cancelled event locally', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 't1' }];
    const eng = engine();
    await eng.pull(CAL);
    const row = repos.events.getByRemoteId('a')!;
    google.pages = [{ items: [{ id: 'a', etag: 'e2', status: 'cancelled' }], nextSyncToken: 't2' }];
    await eng.pull(CAL);
    expect(repos.events.get(row.id)?.deletedAt).toBeTruthy();
  });
});

describe('I7 sync engine — push', () => {
  it('pushes a queued update with an etag precondition', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 't' }];
    const eng = engine();
    await eng.pull(CAL);
    const row = repos.events.getByRemoteId('a')!;
    repos.events.update(row.id, { title: 'Renamed' });
    repos.sync.enqueue({ opId: 'op1', calendarId: CAL, eventId: row.id, op: 'update', payload: null, createdAt: 1 });
    const changed = await eng.push(CAL);
    expect(changed).toBe(1);
    expect(google.patched[0]!.etag).toBe('etag-a'); // used the stored etag
    expect(repos.sync.pending(CAL)).toHaveLength(0); // dequeued on success
    expect(repos.events.get(row.id)?.etag).toBe('etag-2');
  });

  it('read-only calendars never push', async () => {
    const eng = engine('read-only');
    repos.sync.enqueue({ opId: 'op1', calendarId: CAL, eventId: 'x', op: 'create', payload: null, createdAt: 1 });
    expect(await eng.push(CAL)).toBe(0);
    expect(repos.sync.pending(CAL)).toHaveLength(1); // left intact
  });

  it('raises a conflict (never silently overwrites) on an etag mismatch, and resolves it', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 't' }];
    const eng = engine();
    await eng.pull(CAL);
    const row = repos.events.getByRemoteId('a')!;
    repos.events.update(row.id, { title: 'Mine' });
    google.etagFailFor.add('a'); // remote changed underneath us
    // the re-pull returns the remote's version
    google.pages = [{ items: [timed('a', '2026-07-15T10:00:00-07:00', { summary: 'Theirs' })], nextSyncToken: 't2' }];
    repos.sync.enqueue({ opId: 'op1', calendarId: CAL, eventId: row.id, op: 'update', payload: null, createdAt: 1 });
    await eng.push(CAL);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.local.title).toBe('Mine');
    expect(conflicts[0]!.remote.title).toBe('Theirs');
    expect(repos.sync.pending(CAL)).toHaveLength(0);

    // keep mine → re-enqueues a push and restores local title
    eng.resolveConflict(row.id, 'mine');
    expect(repos.events.get(row.id)?.title).toBe('Mine');
    expect(repos.sync.pending(CAL)).toHaveLength(1);
  });

  it('conflict "keep both" leaves the remote synced and adds a local copy', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 't' }];
    const eng = engine();
    await eng.pull(CAL);
    const row = repos.events.getByRemoteId('a')!;
    repos.events.update(row.id, { title: 'Mine' });
    google.etagFailFor.add('a');
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00', { summary: 'Theirs' })], nextSyncToken: 't2' }];
    repos.sync.enqueue({ opId: 'op1', calendarId: CAL, eventId: row.id, op: 'update', payload: null, createdAt: 1 });
    await eng.push(CAL);
    eng.resolveConflict(row.id, 'both');
    const local = repos.events.allActive().filter((e) => e.calendarId === 'default' && e.title === 'Mine');
    expect(local).toHaveLength(1);
    expect(repos.events.get(row.id)?.title).toBe('Theirs'); // remote kept
  });

  it('offline queue: a network failure keeps the op; a later flush applies it exactly once', async () => {
    const localRow = repos.events.create({ title: 'New', startTs: Date.UTC(2026, 6, 15, 16, 0), endTs: Date.UTC(2026, 6, 15, 17, 0), tz: 'UTC', calendarId: CAL });
    repos.sync.enqueue({ opId: 'op1', calendarId: CAL, eventId: localRow.id, op: 'create', payload: null, createdAt: 1 });
    const eng = engine();
    // first flush: network error → op stays queued, nothing inserted
    google.insertImpl = () => Promise.reject(new Error('network down'));
    await eng.push(CAL);
    expect(google.inserted).toHaveLength(0);
    expect(repos.sync.pending(CAL)).toHaveLength(1);
    // reconnect: insert succeeds → applied once, op dequeued
    google.insertImpl = null;
    await eng.push(CAL);
    expect(google.inserted).toHaveLength(1);
    expect(repos.sync.pending(CAL)).toHaveLength(0);
    // a redundant flush does nothing (no double-apply)
    await eng.push(CAL);
    expect(google.inserted).toHaveLength(1);
  });
});

describe('I7 sync engine — cross-boundary move', () => {
  it('moving off a synced calendar queues a remote delete and drops remote identity', async () => {
    google.pages = [{ items: [timed('a', '2026-07-15T09:00:00-07:00')], nextSyncToken: 't' }];
    const eng = engine();
    await eng.pull(CAL);
    const row = repos.events.getByRemoteId('a')!;
    eng.moveEvent(row.id, 'default');
    const moved = repos.events.get(row.id)!;
    expect(moved.calendarId).toBe('default');
    expect(moved.remoteId).toBeNull();
    const del = repos.sync.pending(CAL).find((o) => o.op === 'delete');
    expect(del?.payload).toMatchObject({ remoteId: 'a' });
  });

  it('moving onto a synced two-way calendar queues a remote create', async () => {
    const local = repos.events.create({ title: 'Local', startTs: Date.UTC(2026, 6, 15, 16, 0), endTs: null, tz: 'UTC', calendarId: 'default' });
    const eng = engine();
    eng.moveEvent(local.id, CAL);
    expect(repos.events.get(local.id)?.calendarId).toBe(CAL);
    expect(repos.sync.pending(CAL).find((o) => o.op === 'create')).toBeDefined();
  });
});
