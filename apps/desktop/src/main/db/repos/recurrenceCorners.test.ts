import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../connection';
import { migrate } from '../migrate';
import { createRepos, type Repos } from './index';
import { isValidRrule } from './events';

let db: Db;
let repos: Repos;
const NY = 'America/New_York';

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

function occStartsIso(startTs: number, endTs: number, tz = NY): string[] {
  return repos.events.expandOccurrences(startTs, endTs).map((o) => DateTime.fromMillis(o.occStartTs, { zone: tz }).toISO()!);
}

describe('J4 recurrence corner cases', () => {
  it('DST spring-forward: a daily 9am event keeps 9:00 wall time across the March boundary', () => {
    // 2026 US DST begins Sun Mar 8. A 9am daily event must stay 9am local on both sides.
    const start = DateTime.fromISO('2026-03-06T09:00:00', { zone: NY });
    repos.events.create({ title: 'standup', startTs: start.toMillis(), endTs: start.plus({ minutes: 30 }).toMillis(), tz: NY, rrule: 'FREQ=DAILY' });
    const isos = occStartsIso(DateTime.fromISO('2026-03-06', { zone: NY }).toMillis(), DateTime.fromISO('2026-03-11', { zone: NY }).toMillis());
    // every occurrence is at 09:00 local regardless of the DST shift
    for (const iso of isos) expect(iso).toMatch(/T09:00:00/);
    expect(isos.length).toBeGreaterThanOrEqual(4);
  });

  it('DST fall-back: a daily 9am event keeps 9:00 wall time across the November boundary', () => {
    const start = DateTime.fromISO('2026-10-31T09:00:00', { zone: NY });
    repos.events.create({ title: 'standup', startTs: start.toMillis(), endTs: start.plus({ minutes: 30 }).toMillis(), tz: NY, rrule: 'FREQ=DAILY' });
    const isos = occStartsIso(DateTime.fromISO('2026-10-31', { zone: NY }).toMillis(), DateTime.fromISO('2026-11-04', { zone: NY }).toMillis());
    for (const iso of isos) expect(iso).toMatch(/T09:00:00/);
  });

  it('RRULE with COUNT yields exactly COUNT occurrences', () => {
    const start = DateTime.fromISO('2026-07-01T10:00:00', { zone: NY });
    repos.events.create({ title: 'c', startTs: start.toMillis(), endTs: start.plus({ hours: 1 }).toMillis(), tz: NY, rrule: 'FREQ=DAILY;COUNT=3' });
    const occ = repos.events.expandOccurrences(start.toMillis(), start.plus({ days: 30 }).toMillis());
    expect(occ).toHaveLength(3);
  });

  it('RRULE with UNTIL stops at the boundary', () => {
    const start = DateTime.fromISO('2026-07-01T10:00:00', { zone: NY });
    repos.events.create({ title: 'u', startTs: start.toMillis(), endTs: start.plus({ hours: 1 }).toMillis(), tz: NY, rrule: 'FREQ=DAILY;UNTIL=20260705T140000Z' });
    const occ = repos.events.expandOccurrences(start.toMillis(), start.plus({ days: 30 }).toMillis());
    expect(occ.length).toBeLessThanOrEqual(5);
    expect(occ.length).toBeGreaterThanOrEqual(4);
  });

  it('monthly-on-31st skips months that have no 31st', () => {
    const start = DateTime.fromISO('2026-01-31T12:00:00', { zone: NY });
    repos.events.create({ title: 'm', startTs: start.toMillis(), endTs: start.plus({ hours: 1 }).toMillis(), tz: NY, rrule: 'FREQ=MONTHLY;BYMONTHDAY=31' });
    const isos = occStartsIso(start.toMillis(), DateTime.fromISO('2026-05-01', { zone: NY }).toMillis());
    const months = isos.map((i) => i.slice(0, 7));
    expect(months).toContain('2026-01'); // Jan 31
    expect(months).toContain('2026-03'); // Mar 31
    expect(months).not.toContain('2026-02'); // no Feb 31
    expect(months).not.toContain('2026-04'); // no Apr 31
  });

  it('all-day multi-day event is returned by a range spanning a month boundary', () => {
    const start = DateTime.fromISO('2026-07-30', { zone: NY });
    repos.events.create({ title: 'trip', startTs: start.toMillis(), endTs: start.plus({ days: 3 }).toMillis(), tz: NY, allDay: true });
    const occ = repos.events.expandOccurrences(DateTime.fromISO('2026-08-01', { zone: NY }).toMillis(), DateTime.fromISO('2026-08-02', { zone: NY }).toMillis());
    expect(occ.some((o) => o.title === 'trip')).toBe(true); // visible in August even though it starts in July
  });
});

describe('J4 degenerate inputs', () => {
  it('isValidRrule accepts good rules and rejects malformed ones', () => {
    expect(isValidRrule('FREQ=WEEKLY;BYDAY=MO')).toBe(true);
    expect(isValidRrule('FREQ=DAILY;COUNT=3')).toBe(true);
    expect(isValidRrule('')).toBe(false);
    expect(isValidRrule('not a rule')).toBe(false);
    expect(isValidRrule('BYDAY=MO')).toBe(false); // no FREQ
    expect(isValidRrule('FREQ=NONSENSE')).toBe(false);
  });
});
