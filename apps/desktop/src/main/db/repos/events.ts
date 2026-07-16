import { DateTime } from 'luxon';
import * as rrulePkg from 'rrule';

// rrule ships CJS; under Electron's ESM main the classes live on the default export.
const { RRule } = (rrulePkg as { default?: typeof rrulePkg }).default ?? rrulePkg;
import { newId, nowMs, MS, type OccurrenceDTO } from '@apollo/shared';
import { type Db } from '../connection';

export type SyncStatus = 'synced' | 'local-dirty' | 'remote-deleted';

export interface EventRow {
  id: string; title: string; startTs: number; endTs: number | null;
  tz: string; allDay: boolean; rrule: string | null; exdates: string[];
  location: string | null; notes: string | null; reminderMin: number | null;
  calendarId: string; remoteId: string | null; etag: string | null; syncStatus: SyncStatus | null;
  createdAt: number; updatedAt: number; deletedAt: number | null;
}

export interface EventInput {
  title: string; startTs: number; endTs?: number | null; tz: string;
  allDay?: boolean; rrule?: string | null; location?: string | null;
  notes?: string | null; reminderMin?: number | null; calendarId?: string;
  remoteId?: string | null; etag?: string | null; syncStatus?: SyncStatus | null;
}

interface RawRow {
  id: string; title: string; start_ts: number; end_ts: number | null; tz: string;
  all_day: number; rrule: string | null; exdates: string | null; location: string | null;
  notes: string | null; reminder_min: number | null; created_at: number; updated_at: number;
  deleted_at: number | null; calendar_id: string; remote_id: string | null; etag: string | null;
  sync_status: string | null;
}

function toRow(r: RawRow): EventRow {
  return {
    id: r.id, title: r.title, startTs: r.start_ts, endTs: r.end_ts, tz: r.tz,
    allDay: r.all_day === 1, rrule: r.rrule, exdates: r.exdates ? (JSON.parse(r.exdates) as string[]) : [],
    location: r.location, notes: r.notes, reminderMin: r.reminder_min,
    calendarId: r.calendar_id ?? 'default', remoteId: r.remote_id, etag: r.etag,
    syncStatus: (r.sync_status as SyncStatus | null) ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

/** Interprets `d`'s UTC fields as wall time in `zone` (rrule works in fake-UTC wall time). */
function wallToZone(d: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
    },
    { zone },
  );
}

function zoneToWall(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

function durationOf(ev: EventRow): number {
  return (ev.endTs ?? ev.startTs + MS.hour) - ev.startTs;
}

export function createEventsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO events(id,title,start_ts,end_ts,tz,all_day,rrule,exdates,location,notes,reminder_min,calendar_id,remote_id,etag,sync_status,created_at,updated_at)
     VALUES (@id,@title,@start_ts,@end_ts,@tz,@all_day,@rrule,@exdates,@location,@notes,@reminder_min,@calendar_id,@remote_id,@etag,@sync_status,@created_at,@updated_at)`,
  );
  const byId = db.prepare('SELECT * FROM events WHERE id = ?');
  const liveRange = db.prepare(
    `SELECT * FROM events WHERE deleted_at IS NULL AND (rrule IS NOT NULL OR start_ts < @end AND COALESCE(end_ts, start_ts + ${MS.hour}) > @start)`,
  );
  const likeSearch = db.prepare(
    `SELECT * FROM events WHERE deleted_at IS NULL AND (title LIKE @q OR location LIKE @q OR notes LIKE @q) ORDER BY start_ts LIMIT 20`,
  );

  function get(id: string): EventRow | null {
    const r = byId.get(id) as RawRow | undefined;
    return r ? toRow(r) : null;
  }

  function expandOccurrences(rangeStartMs: number, rangeEndMs: number): OccurrenceDTO[] {
    const out: OccurrenceDTO[] = [];
    for (const raw of liveRange.all({ start: rangeStartMs, end: rangeEndMs }) as RawRow[]) {
      const ev = toRow(raw);
      const dur = durationOf(ev);
      if (!ev.rrule) {
        const dateIso = DateTime.fromMillis(ev.startTs, { zone: ev.tz }).toISODate() ?? '';
        out.push({
          eventId: ev.id, occStartTs: ev.startTs, occEndTs: ev.startTs + dur, title: ev.title, tz: ev.tz,
          allDay: ev.allDay, isRecurring: false, location: ev.location, notes: ev.notes, dateIso, rrule: null,
          calendarId: ev.calendarId,
        });
        continue;
      }
      // Recurrence expansion in the event's own zone, preserving wall time across DST.
      const start = DateTime.fromMillis(ev.startTs, { zone: ev.tz });
      let opts;
      try {
        opts = RRule.parseString(ev.rrule);
      } catch {
        continue; // malformed rule: treat as non-expanding rather than crash
      }
      opts.dtstart = zoneToWall(start);
      const rule = new RRule(opts);
      const lo = zoneToWall(DateTime.fromMillis(rangeStartMs, { zone: ev.tz }).minus({ days: 1 }));
      const hi = zoneToWall(DateTime.fromMillis(rangeEndMs, { zone: ev.tz }).plus({ days: 1 }));
      for (const d of rule.between(lo, hi, true)) {
        const local = wallToZone(d, ev.tz);
        const startTs = local.toMillis();
        const dateIso = local.toISODate() ?? '';
        if (ev.exdates.includes(dateIso)) continue;
        if (startTs >= rangeEndMs || startTs + dur <= rangeStartMs) continue;
        out.push({
          eventId: ev.id, occStartTs: startTs, occEndTs: startTs + dur, title: ev.title, tz: ev.tz,
          allDay: ev.allDay, isRecurring: true, location: ev.location, notes: ev.notes, dateIso, rrule: ev.rrule,
          calendarId: ev.calendarId,
        });
      }
    }
    return out.sort((a, b) => a.occStartTs - b.occStartTs);
  }

  return {
    create(input: EventInput): EventRow {
      const ts = nowMs();
      const id = newId();
      insert.run({
        id, title: input.title, start_ts: input.startTs, end_ts: input.endTs ?? null, tz: input.tz,
        all_day: input.allDay ? 1 : 0, rrule: input.rrule ?? null, exdates: JSON.stringify([]),
        location: input.location ?? null, notes: input.notes ?? null, reminder_min: input.reminderMin ?? null,
        calendar_id: input.calendarId ?? 'default', remote_id: input.remoteId ?? null,
        etag: input.etag ?? null, sync_status: input.syncStatus ?? null,
        created_at: ts, updated_at: ts,
      });
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },

    get,

    update(id: string, patch: Partial<EventInput>): EventRow | null {
      const cur = get(id);
      if (!cur || cur.deletedAt) return null;
      const next = { ...cur, ...patch };
      db.prepare(
        `UPDATE events SET title=@title, start_ts=@start_ts, end_ts=@end_ts, tz=@tz, all_day=@all_day,
         rrule=@rrule, location=@location, notes=@notes, reminder_min=@reminder_min,
         calendar_id=@calendar_id, remote_id=@remote_id, etag=@etag, sync_status=@sync_status, updated_at=@updated_at WHERE id=@id`,
      ).run({
        id, title: next.title, start_ts: next.startTs, end_ts: next.endTs ?? null, tz: next.tz,
        all_day: next.allDay ? 1 : 0, rrule: next.rrule ?? null, location: next.location ?? null,
        notes: next.notes ?? null, reminder_min: next.reminderMin ?? null,
        calendar_id: next.calendarId ?? 'default', remote_id: next.remoteId ?? null,
        etag: next.etag ?? null, sync_status: next.syncStatus ?? null, updated_at: nowMs(),
      });
      return get(id);
    },

    softDelete(id: string): boolean {
      return db.prepare('UPDATE events SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), nowMs(), id).changes > 0;
    },

    restore(id: string): boolean {
      return db.prepare('UPDATE events SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },

    addExdate(id: string, dateIso: string): boolean {
      const cur = get(id);
      if (!cur) return false;
      const ex = [...new Set([...cur.exdates, dateIso])];
      return db.prepare('UPDATE events SET exdates=?, updated_at=? WHERE id=?').run(JSON.stringify(ex), nowMs(), id).changes > 0;
    },

    removeExdate(id: string, dateIso: string): boolean {
      const cur = get(id);
      if (!cur) return false;
      const ex = cur.exdates.filter((d) => d !== dateIso);
      return db.prepare('UPDATE events SET exdates=?, updated_at=? WHERE id=?').run(JSON.stringify(ex), nowMs(), id).changes > 0;
    },

    search(q: string): EventRow[] {
      return (likeSearch.all({ q: `%${q}%` }) as RawRow[]).map(toRow);
    },

    /** All non-deleted events (H2 export). */
    allActive(): EventRow[] {
      return (db.prepare('SELECT * FROM events WHERE deleted_at IS NULL ORDER BY start_ts').all() as RawRow[]).map(toRow);
    },
    /** H2 import: insert preserving id; false if id exists. */
    importRow(ev: EventRow): boolean {
      if (db.prepare('SELECT 1 FROM events WHERE id=?').get(ev.id)) return false;
      const ts = nowMs();
      db.prepare(
        `INSERT INTO events(id,title,start_ts,end_ts,tz,all_day,rrule,exdates,location,notes,reminder_min,calendar_id,remote_id,etag,sync_status,created_at,updated_at)
         VALUES (@id,@title,@start_ts,@end_ts,@tz,@all_day,@rrule,@exdates,@location,@notes,@reminder_min,@calendar_id,@remote_id,@etag,@sync_status,@created_at,@updated_at)`,
      ).run({
        id: ev.id, title: ev.title, start_ts: ev.startTs, end_ts: ev.endTs, tz: ev.tz, all_day: ev.allDay ? 1 : 0,
        rrule: ev.rrule, exdates: JSON.stringify(ev.exdates ?? []), location: ev.location, notes: ev.notes,
        reminder_min: ev.reminderMin, calendar_id: ev.calendarId ?? 'default', remote_id: ev.remoteId ?? null,
        etag: ev.etag ?? null, sync_status: ev.syncStatus ?? null,
        created_at: ev.createdAt || ts, updated_at: ev.updatedAt || ts,
      });
      return true;
    },

    /** I2: count non-deleted events on a calendar (delete-with-events guard). */
    countByCalendar(calendarId: string): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL AND calendar_id=?').get(calendarId) as { n: number }).n;
    },

    /** I2: move every event from one calendar to another (delete-with-reassign). */
    reassignCalendar(from: string, to: string): number {
      return db.prepare('UPDATE events SET calendar_id=?, updated_at=? WHERE calendar_id=? AND deleted_at IS NULL').run(to, nowMs(), from).changes;
    },

    /** I7: events on a synced calendar, by remote id (sync engine). */
    getByRemoteId(remoteId: string): EventRow | null {
      const r = db.prepare('SELECT * FROM events WHERE remote_id=? AND deleted_at IS NULL').get(remoteId) as RawRow | undefined;
      return r ? toRow(r) : null;
    },

    expandOccurrences,

    findOverlapping(startMs: number, endMs: number, excludeId?: string): OccurrenceDTO[] {
      return expandOccurrences(startMs, endMs).filter((o) => o.eventId !== excludeId);
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
