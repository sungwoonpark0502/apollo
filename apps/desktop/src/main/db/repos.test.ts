import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { openDb, type Db } from './connection';
import { migrate } from './migrate';
import { createRepos, type Repos } from './repos/index';

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

describe('migrations', () => {
  it('applies to version 4 and is idempotent', () => {
    expect(migrate(db)).toBe(4);
    expect(migrate(db)).toBe(4);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ['events', 'reminders', 'timers', 'alarms', 'notes', 'todos', 'contacts', 'conversations', 'messages', 'memory_facts', 'oauth_accounts', 'capability_misses', 'feeds', 'perf_spans', 'undo_log', 'settings']) {
      expect(tables).toContain(t);
    }
  });
});

describe('events: recurrence expansion', () => {
  const LA = 'America/Los_Angeles';

  it('weekly event crossing 2026-11-01 DST end keeps local wall time (C11 golden case)', () => {
    // Sundays 09:00 local, starting 2026-10-18 (PDT, UTC-7). DST ends 2026-11-01.
    const start = DateTime.fromObject({ year: 2026, month: 10, day: 18, hour: 9 }, { zone: LA });
    repos.events.create({ title: 'Standup', startTs: start.toMillis(), tz: LA, rrule: 'FREQ=WEEKLY;BYDAY=SU' });

    const lo = DateTime.fromObject({ year: 2026, month: 10, day: 15 }, { zone: LA }).toMillis();
    const hi = DateTime.fromObject({ year: 2026, month: 11, day: 12 }, { zone: LA }).toMillis();
    const occ = repos.events.expandOccurrences(lo, hi);

    expect(occ.map((o) => o.dateIso)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08']);
    for (const o of occ) {
      const local = DateTime.fromMillis(o.occStartTs, { zone: LA });
      expect(local.hour).toBe(9); // wall time preserved across the DST boundary
      expect(local.minute).toBe(0);
    }
    // Across the fall-back weekend the epoch gap is 7 days + 1 hour.
    const gap = occ[2]!.occStartTs - occ[1]!.occStartTs;
    expect(gap).toBe((7 * 24 + 1) * 3_600_000);
    // Offsets flip from PDT to PST.
    expect(DateTime.fromMillis(occ[1]!.occStartTs, { zone: LA }).offset).toBe(-420);
    expect(DateTime.fromMillis(occ[2]!.occStartTs, { zone: LA }).offset).toBe(-480);
  });

  it('honors exdates (JSON array of ISO dates)', () => {
    const start = DateTime.fromObject({ year: 2026, month: 7, day: 6, hour: 10 }, { zone: LA }); // Monday
    const ev = repos.events.create({ title: 'Gym', startTs: start.toMillis(), tz: LA, rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    repos.events.addExdate(ev.id, '2026-07-13');
    const lo = DateTime.fromObject({ year: 2026, month: 7, day: 1 }, { zone: LA }).toMillis();
    const hi = DateTime.fromObject({ year: 2026, month: 7, day: 28 }, { zone: LA }).toMillis();
    expect(repos.events.expandOccurrences(lo, hi).map((o) => o.dateIso)).toEqual(['2026-07-06', '2026-07-20', '2026-07-27']);
  });

  it('respects the event tz independent of host tz', () => {
    const tokyo = DateTime.fromObject({ year: 2026, month: 7, day: 20, hour: 9 }, { zone: 'Asia/Tokyo' });
    repos.events.create({ title: 'Call Tokyo', startTs: tokyo.toMillis(), tz: 'Asia/Tokyo', rrule: 'FREQ=DAILY;COUNT=3' });
    const lo = tokyo.minus({ days: 1 }).toMillis();
    const hi = tokyo.plus({ days: 5 }).toMillis();
    const occ = repos.events.expandOccurrences(lo, hi);
    expect(occ).toHaveLength(3);
    for (const o of occ) expect(DateTime.fromMillis(o.occStartTs, { zone: 'Asia/Tokyo' }).hour).toBe(9);
  });

  it('findOverlapping catches recurring occurrences and one-offs; soft-deleted events vanish', () => {
    const base = DateTime.fromObject({ year: 2026, month: 7, day: 14, hour: 15 }, { zone: LA });
    const oneOff = repos.events.create({ title: 'Dentist', startTs: base.toMillis(), endTs: base.plus({ hours: 1 }).toMillis(), tz: LA });
    repos.events.create({ title: 'Weekly sync', startTs: base.minus({ weeks: 2 }).toMillis(), tz: LA, rrule: 'FREQ=WEEKLY' });

    const overlaps = repos.events.findOverlapping(base.plus({ minutes: 30 }).toMillis(), base.plus({ minutes: 90 }).toMillis());
    expect(overlaps.map((o) => o.title).sort()).toEqual(['Dentist', 'Weekly sync']);

    repos.events.softDelete(oneOff.id);
    const after = repos.events.findOverlapping(base.plus({ minutes: 30 }).toMillis(), base.plus({ minutes: 90 }).toMillis());
    expect(after.map((o) => o.title)).toEqual(['Weekly sync']);
    expect(repos.events.restore(oneOff.id)).toBe(true);
    expect(repos.events.findOverlapping(base.plus({ minutes: 30 }).toMillis(), base.plus({ minutes: 90 }).toMillis())).toHaveLength(2);
  });
});

describe('reminders', () => {
  it('due/fire/snooze lifecycle', () => {
    const now = Date.now();
    const r = repos.reminders.create({ text: 'take out trash', dueTs: now - 1000 });
    expect(repos.reminders.due(now).map((x) => x.id)).toEqual([r.id]);

    repos.reminders.markFired(r.id, now);
    expect(repos.reminders.due(now)).toHaveLength(0);

    repos.reminders.snooze(r.id, 10, now);
    expect(repos.reminders.due(now)).toHaveLength(0);
    expect(repos.reminders.due(now + 10 * 60_000 + 1).map((x) => x.id)).toEqual([r.id]);

    repos.reminders.complete(r.id);
    expect(repos.reminders.due(now + 10 * 60_000 + 1)).toHaveLength(0);
  });
});

describe('timers', () => {
  it('persist, cancel, and due queries', () => {
    const now = Date.now();
    const t1 = repos.timers.start({ label: 'pasta', endsAt: now + 60_000 });
    const t2 = repos.timers.start({ endsAt: now + 120_000 });
    expect(repos.timers.listActive().map((t) => t.id)).toEqual([t1.id, t2.id]);

    repos.timers.cancel(t2.id);
    expect(repos.timers.listActive().map((t) => t.id)).toEqual([t1.id]);
    expect(repos.timers.due(now + 61_000).map((t) => t.id)).toEqual([t1.id]);

    repos.timers.markFired(t1.id, now + 61_000);
    expect(repos.timers.due(now + 61_000)).toHaveLength(0);
  });
});

describe('alarms', () => {
  it('recurring alarm rearms; one-shot stays fired', () => {
    const now = Date.now();
    const a = repos.alarms.set({ label: 'wake', atTs: now - 1, rrule: 'FREQ=DAILY' });
    expect(repos.alarms.due(now).map((x) => x.id)).toEqual([a.id]);
    repos.alarms.markFired(a.id, now);
    expect(repos.alarms.due(now)).toHaveLength(0);
    repos.alarms.rearm(a.id, now + 86_400_000);
    expect(repos.alarms.due(now + 86_400_001).map((x) => x.id)).toEqual([a.id]);
  });
});

describe('notes FTS', () => {
  it('search returns snippets; update and soft delete stay in sync with the index', () => {
    repos.notes.save({ content: 'The wifi password for the cabin is hunter2' });
    const n2 = repos.notes.save({ content: 'Grocery list: milk, eggs, coffee beans' });

    const hits = repos.notes.search('wifi password');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain('[wifi]');

    repos.notes.update(n2.id, 'Grocery list: milk, eggs, oat milk');
    expect(repos.notes.search('coffee')).toHaveLength(0);
    expect(repos.notes.search('oat')).toHaveLength(1);

    repos.notes.softDelete(n2.id);
    expect(repos.notes.search('oat')).toHaveLength(0);
  });

  it('quotes hostile query input instead of throwing', () => {
    repos.notes.save({ content: 'plain note' });
    expect(() => repos.notes.search('plain AND (malformed')).not.toThrow();
  });
});

describe('todos + contacts fuzzy matching', () => {
  it('todo fuzzy match requires all tokens; ambiguous matches return all candidates', () => {
    repos.todos.add({ content: 'Buy milk at the store' });
    repos.todos.add({ content: 'Buy stamps at the post office' });
    expect(repos.todos.fuzzyByContent('buy milk')).toHaveLength(1);
    expect(repos.todos.fuzzyByContent('buy')).toHaveLength(2);
    expect(repos.todos.fuzzyByContent('buy unicorn')).toHaveLength(0);
  });

  it('contact find ranks exact > token > prefix > substring', () => {
    repos.contacts.add({ name: 'Jane Doe', email: 'jane@x.com' });
    repos.contacts.add({ name: 'Janet Smith', email: 'janet@x.com' });
    repos.contacts.add({ name: 'Bob Jane', email: 'bobjane@x.com' });
    const hits = repos.contacts.find('jane');
    expect(hits[0]!.name).toBe('Jane Doe'); // exact token match outranks prefix 'Janet'
    expect(hits.map((h) => h.name)).toContain('Janet Smith');
  });
});

describe('conversations', () => {
  it('lastMessages returns the most recent n in chronological order', () => {
    repos.conversations.ensure('c1');
    for (let i = 0; i < 25; i++) repos.conversations.addMessage({ convId: 'c1', role: 'user', content: `m${i}`, ts: 1000 + i });
    const last = repos.conversations.lastMessages('c1', 20);
    expect(last).toHaveLength(20);
    expect(last[0]!.content).toBe('m5');
    expect(last[19]!.content).toBe('m24');
  });
});

describe('memory', () => {
  it('digest is newest-first and budget-capped; forgetFuzzy removes the best match', () => {
    repos.memory.save({ category: 'person', fact: "user's partner lives in Columbus" });
    repos.memory.save({ category: 'preference', fact: 'prefers metric units' });
    const digest = repos.memory.digest();
    expect(digest.indexOf('metric')).toBeLessThan(digest.indexOf('Columbus'));

    const tiny = repos.memory.digest(40);
    expect(tiny.split('\n')).toHaveLength(1);

    const forgotten = repos.memory.forgetFuzzy('partner Columbus');
    expect(forgotten?.fact).toContain('Columbus');
    expect(repos.memory.digest()).not.toContain('Columbus');
    expect(repos.memory.forgetFuzzy('nonexistent gibberish zzz')).toBeNull();
  });
});

describe('undo log', () => {
  it('push/pop is LIFO per conversation and empties', () => {
    repos.undo.push({ turnId: 't1', convId: 'c1', tool: 'calendar.create', data: { id: 'e1' } });
    repos.undo.push({ turnId: 't2', convId: 'c1', tool: 'note.save', data: { id: 'n1' } });
    repos.undo.push({ turnId: 't3', convId: 'c2', tool: 'todo.add', data: { id: 'td1' } });

    const top = repos.undo.popLatest('c1');
    expect(top?.tool).toBe('note.save');
    expect(repos.undo.popLatest('c1')?.tool).toBe('calendar.create');
    expect(repos.undo.popLatest('c1')).toBeNull();
    expect(repos.undo.countFor('c2')).toBe(1);
  });
});

describe('perf + settings + feeds', () => {
  it('perf aggregates compute p50/p95 per name', () => {
    for (let i = 1; i <= 100; i++) repos.perf.record('t', 'llm_first_token', i);
    const agg = repos.perf.aggregates().find((a) => a.name === 'llm_first_token');
    expect(agg?.count).toBe(100);
    expect(agg?.p50).toBeGreaterThanOrEqual(50);
    expect(agg?.p95).toBeGreaterThanOrEqual(95);
  });

  it('settings kv upserts; feeds seed only when empty', () => {
    repos.settings.set('k', 'v1');
    repos.settings.set('k', 'v2');
    expect(repos.settings.get('k')).toBe('v2');

    repos.feeds.seed([{ url: 'https://example.com/rss', category: 'news' }]);
    repos.feeds.seed([{ url: 'https://other.com/rss', category: 'news' }]);
    expect(repos.feeds.list()).toHaveLength(1);
    const f = repos.feeds.list()[0]!;
    repos.feeds.setEnabled(f.id, false);
    expect(repos.feeds.list({ enabledOnly: true })).toHaveLength(0);
  });
});
