/** I7 Google Calendar wire types (subset) + the client interface we depend on.
 *  The real client hits Google via net.fetch; tests inject a mock. */

export interface GCalListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  primary?: boolean;
}

export interface GDateTime {
  dateTime?: string; // RFC3339, e.g. "2026-07-15T09:00:00-07:00"
  date?: string; // all-day, e.g. "2026-07-15"
  timeZone?: string; // IANA, e.g. "America/Los_Angeles"
}

export interface GEvent {
  id: string;
  etag: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  location?: string;
  description?: string;
  start?: GDateTime;
  end?: GDateTime;
  recurrence?: string[]; // ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20260720"]
  recurringEventId?: string; // set on instances/exceptions of a recurring event
  originalStartTime?: GDateTime; // the instance's original start (exception anchor)
}

export interface GEventsPage {
  items: GEvent[];
  nextSyncToken?: string;
  gone?: boolean; // true = 410 GONE: caller must drop the token and full-resync
}

/** Minimal Google Calendar client. Errors: throw GEtagError on 412 precondition failure. */
export interface GoogleCalendarClient {
  listCalendars(): Promise<GCalListEntry[]>;
  listEvents(calendarId: string, opts: { syncToken?: string | null }): Promise<GEventsPage>;
  insertEvent(calendarId: string, event: Partial<GEvent>): Promise<GEvent>;
  patchEvent(calendarId: string, remoteId: string, event: Partial<GEvent>, etag: string): Promise<GEvent>;
  deleteEvent(calendarId: string, remoteId: string, etag: string): Promise<void>;
}

export class GEtagError extends Error {
  constructor(public readonly remoteId: string) {
    super(`etag precondition failed for ${remoteId}`);
    this.name = 'GEtagError';
  }
}
