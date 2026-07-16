import { DateTime } from 'luxon';
import { icsDate, nearestPaletteColor, type CalendarCollection } from '@apollo/shared';
import { type EventInput, type EventRow } from '../db/repos/events';
import { type GCalListEntry, type GEvent } from './types';

/**
 * I7 pure converters between Google Calendar events and Apollo's event model.
 * Timezones convert via luxon; recurrence maps to our RRULE + EXDATE model.
 * No DB or network here so the sync engine's mapping is unit-testable.
 */

function rruleFromRecurrence(recurrence: string[] | undefined): string | null {
  if (!recurrence) return null;
  const line = recurrence.find((l) => l.startsWith('RRULE:'));
  return line ? line.slice('RRULE:'.length) : null;
}

function exdatesFromRecurrence(recurrence: string[] | undefined): string[] {
  if (!recurrence) return [];
  const out: string[] = [];
  for (const line of recurrence) {
    if (!line.startsWith('EXDATE')) continue;
    const val = line.slice(line.indexOf(':') + 1);
    for (const raw of val.split(',')) {
      const d = raw.replace(/T.*$/, '').replace(/[^0-9]/g, '');
      if (d.length >= 8) out.push(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
    }
  }
  return out;
}

/** Google event → EventInput fields (synced). Returns null for events we can't place in time. */
export function gEventToInput(g: GEvent, calendarId: string): (EventInput & { exdates: string[] }) | null {
  const allDay = !!g.start?.date;
  const tz = g.start?.timeZone ?? g.end?.timeZone ?? 'UTC';
  const startMs = allDay
    ? DateTime.fromISO(g.start!.date!, { zone: tz }).startOf('day').toMillis()
    : g.start?.dateTime
      ? DateTime.fromISO(g.start.dateTime, { setZone: true }).toMillis()
      : NaN;
  if (!Number.isFinite(startMs)) return null;
  const endMs = allDay
    ? g.end?.date
      ? DateTime.fromISO(g.end.date, { zone: tz }).startOf('day').toMillis()
      : null
    : g.end?.dateTime
      ? DateTime.fromISO(g.end.dateTime, { setZone: true }).toMillis()
      : null;

  return {
    title: g.summary ?? '(no title)',
    startTs: startMs,
    endTs: endMs,
    tz,
    allDay,
    rrule: rruleFromRecurrence(g.recurrence),
    location: g.location ?? null,
    notes: g.description ?? null,
    calendarId,
    remoteId: g.id,
    etag: g.etag,
    syncStatus: 'synced',
    exdates: exdatesFromRecurrence(g.recurrence),
  };
}

/** Apollo event row → Google event body for insert/patch. */
export function rowToGEvent(row: EventRow): Partial<GEvent> {
  const body: Partial<GEvent> = {
    summary: row.title,
    ...(row.location ? { location: row.location } : {}),
    ...(row.notes ? { description: row.notes } : {}),
  };
  if (row.allDay) {
    body.start = { date: icsDateIsoDay(row.startTs, row.tz) };
    body.end = { date: icsDateIsoDay(row.endTs ?? row.startTs, row.tz) };
  } else {
    body.start = { dateTime: DateTime.fromMillis(row.startTs, { zone: row.tz }).toISO() ?? undefined, timeZone: row.tz };
    body.end = { dateTime: DateTime.fromMillis(row.endTs ?? row.startTs + 3_600_000, { zone: row.tz }).toISO() ?? undefined, timeZone: row.tz };
  }
  const recurrence: string[] = [];
  if (row.rrule) recurrence.push(row.rrule.startsWith('RRULE:') ? row.rrule : `RRULE:${row.rrule}`);
  if (row.exdates.length > 0) recurrence.push(`EXDATE;VALUE=DATE:${row.exdates.map((d) => d.replace(/-/g, '')).join(',')}`);
  if (recurrence.length > 0) body.recurrence = recurrence;
  return body;
}

/** YYYY-MM-DD in the event's zone (Google all-day date form). */
function icsDateIsoDay(ms: number, tz: string): string {
  const k = icsDate(ms, tz); // YYYYMMDD
  return `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
}

/** A Google calendar list entry → a local calendar collection (kind google, nearest palette color). */
export function gCalendarToCollection(entry: GCalListEntry): CalendarCollection {
  return {
    id: `google:${entry.id}`,
    name: entry.summary || entry.id,
    color: entry.backgroundColor ? nearestPaletteColor(entry.backgroundColor) : '#4C8BF5',
    kind: 'google',
    readOnly: entry.accessRole === 'reader' || entry.accessRole === 'freeBusyReader',
  };
}

/** The remote calendar id ('primary' or the Google id) behind a local collection id. */
export function remoteCalendarId(collectionId: string): string {
  return collectionId.startsWith('google:') ? collectionId.slice('google:'.length) : collectionId;
}
