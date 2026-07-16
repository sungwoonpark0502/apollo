import { icsDate, icsDateTime, type EventDTO } from '@apollo/shared';

/** I5 "Copy as ICS": a single-event VCALENDAR string for the clipboard. */
export function eventToIcs(e: EventDTO): string {
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const dt = (ms: number): string => (e.allDay ? `;VALUE=DATE:${icsDate(ms, e.tz)}` : `;TZID=${e.tz}:${icsDateTime(ms, e.tz)}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apollo//EN',
    'BEGIN:VEVENT',
    `UID:${e.id}`,
    `SUMMARY:${esc(e.title)}`,
    `DTSTART${dt(e.startTs)}`,
    ...(e.endTs != null ? [`DTEND${dt(e.endTs)}`] : []),
    ...(e.rrule ? [e.rrule.startsWith('RRULE:') ? e.rrule : `RRULE:${e.rrule}`] : []),
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.notes ? [`DESCRIPTION:${esc(e.notes)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
