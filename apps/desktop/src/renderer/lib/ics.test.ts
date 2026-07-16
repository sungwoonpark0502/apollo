import { describe, expect, it } from 'vitest';
import { eventToIcs } from './ics';
import type { EventDTO } from '@apollo/shared';

const base: EventDTO = {
  id: 'e1', title: 'Team; sync', startTs: Date.UTC(2026, 6, 15, 16, 0), endTs: Date.UTC(2026, 6, 15, 17, 0),
  tz: 'UTC', allDay: false, rrule: null, location: 'Room 2, floor 3', notes: 'bring notes', calendarId: 'default', color: '#D97757',
};

describe('eventToIcs', () => {
  it('emits a valid single-event VCALENDAR with escaped fields', () => {
    const ics = eventToIcs(base);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Team\\; sync'); // ';' escaped
    expect(ics).toContain('LOCATION:Room 2\\, floor 3'); // ',' escaped
    expect(ics).toContain('DTSTART;TZID=UTC:20260715T160000');
    expect(ics).toContain('DTEND;TZID=UTC:20260715T170000');
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
  });

  it('uses VALUE=DATE for all-day events and includes RRULE', () => {
    const ics = eventToIcs({ ...base, allDay: true, endTs: null, rrule: 'FREQ=WEEKLY;BYDAY=WE' });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260715');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=WE');
    expect(ics).not.toContain('DTEND');
  });
});
