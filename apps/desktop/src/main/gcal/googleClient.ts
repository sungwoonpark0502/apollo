import { type HttpClient } from '../net/httpClient';
import { GEtagError, type GCalListEntry, type GEvent, type GEventsPage, type GoogleCalendarClient } from './types';

/**
 * I7 real Google Calendar client over the shared http client (net.fetch +
 * breaker + the already-allowlisted googleapis hosts — no new host). The token
 * comes from the incremental calendar-scope grant (see HUMAN_TODO for the live
 * auth). Uses raw fetch for etag preconditions since the http client's helpers
 * don't surface 412; every URL still passes the egress allowlist.
 */
const BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleClientDeps {
  http: HttpClient;
  getAccessToken: () => Promise<string | null>;
  fetchFn: typeof fetch; // net.fetch (egress is enforced by host allowlist: googleapis.com is listed)
}

export function createGoogleClient(deps: GoogleClientDeps): GoogleCalendarClient {
  async function auth(): Promise<Record<string, string>> {
    const token = await deps.getAccessToken();
    if (!token) throw new Error('no calendar token');
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  }

  return {
    async listCalendars(): Promise<GCalListEntry[]> {
      const data = (await deps.http.getJson(`${BASE}/users/me/calendarList`, { headers: await auth() })) as { items?: GCalListEntry[] };
      return data.items ?? [];
    },
    async listEvents(calendarId, opts): Promise<GEventsPage> {
      const params = new URLSearchParams({ singleEvents: 'false', maxResults: '250' });
      if (opts.syncToken) params.set('syncToken', opts.syncToken);
      const url = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      const res = await deps.fetchFn(url, { headers: await auth() });
      if (res.status === 410) return { items: [], gone: true }; // sync token expired
      if (!res.ok) throw new Error(`listEvents ${res.status}`);
      const data = (await res.json()) as { items?: GEvent[]; nextSyncToken?: string };
      return { items: data.items ?? [], nextSyncToken: data.nextSyncToken };
    },
    async insertEvent(calendarId, event): Promise<GEvent> {
      const res = await deps.fetchFn(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST', headers: await auth(), body: JSON.stringify(event),
      });
      if (!res.ok) throw new Error(`insertEvent ${res.status}`);
      return (await res.json()) as GEvent;
    },
    async patchEvent(calendarId, remoteId, event, etag): Promise<GEvent> {
      const res = await deps.fetchFn(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}`, {
        method: 'PATCH', headers: { ...(await auth()), 'if-match': etag }, body: JSON.stringify(event),
      });
      if (res.status === 412) throw new GEtagError(remoteId);
      if (!res.ok) throw new Error(`patchEvent ${res.status}`);
      return (await res.json()) as GEvent;
    },
    async deleteEvent(calendarId, remoteId, etag): Promise<void> {
      const res = await deps.fetchFn(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}`, {
        method: 'DELETE', headers: { ...(await auth()), 'if-match': etag },
      });
      if (res.status === 412) throw new GEtagError(remoteId);
      if (!res.ok && res.status !== 410 && res.status !== 404) throw new Error(`deleteEvent ${res.status}`);
    },
  };
}
