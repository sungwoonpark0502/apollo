import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { CALENDAR_PALETTE } from '@apollo/shared';
import { type EventRow } from '../db/repos/events';
import { gCalendarToCollection, remoteCalendarId, rowToGEvent } from './mapping';

const row = (over: Partial<EventRow> = {}): EventRow => ({
  id: 'e1', title: 'Standup', startTs: DateTime.fromISO('2026-07-15T09:00:00-07:00').toMillis(),
  endTs: DateTime.fromISO('2026-07-15T09:30:00-07:00').toMillis(), tz: 'America/Los_Angeles',
  allDay: false, rrule: null, exdates: [], location: null, notes: null, reminderMin: null,
  calendarId: 'google:primary', remoteId: 'r1', etag: 'e', syncStatus: 'synced',
  createdAt: 0, updatedAt: 0, deletedAt: null, ...over,
});

describe('I7 mapping — Apollo → Google', () => {
  it('emits timed events with dateTime + timeZone', () => {
    const g = rowToGEvent(row());
    expect(g.start?.timeZone).toBe('America/Los_Angeles');
    expect(g.start?.dateTime).toContain('2026-07-15T09:00:00');
    expect(g.summary).toBe('Standup');
  });

  it('emits all-day events with a date and no time', () => {
    const g = rowToGEvent(row({ allDay: true, startTs: DateTime.fromISO('2026-07-15', { zone: 'UTC' }).toMillis(), tz: 'UTC', endTs: null }));
    expect(g.start?.date).toBe('2026-07-15');
    expect(g.start?.dateTime).toBeUndefined();
  });

  it('emits RRULE + EXDATE recurrence lines', () => {
    const g = rowToGEvent(row({ rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-07-20'] }));
    expect(g.recurrence).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(g.recurrence).toContain('EXDATE;VALUE=DATE:20260720');
  });
});

describe('I7 mapping — Google calendar list → collection', () => {
  it('maps color to the nearest palette entry and flags read-only calendars', () => {
    const owner = gCalendarToCollection({ id: 'primary', summary: 'Me', accessRole: 'owner', backgroundColor: '#4986e7' });
    expect(owner).toMatchObject({ id: 'google:primary', kind: 'google', readOnly: false });
    expect(CALENDAR_PALETTE).toContain(owner.color);
    const reader = gCalendarToCollection({ id: 'holidays', summary: 'Holidays', accessRole: 'reader' });
    expect(reader.readOnly).toBe(true);
    expect(remoteCalendarId(reader.id)).toBe('holidays');
  });
});
