import { type Db } from '../connection';

/**
 * I7 Google Calendar sync state. sync_state holds the per-calendar incremental
 * sync token; sync_queue is the durable outbox of local push operations for
 * two-way calendars (idempotent by op_id so a flush can never double-apply).
 */
export interface SyncQueueOp {
  opId: string;
  calendarId: string;
  eventId: string;
  op: 'create' | 'update' | 'delete';
  payload: Record<string, unknown> | null;
  createdAt: number;
}

interface RawOp {
  op_id: string; calendar_id: string; event_id: string; op: string; payload: string | null; created_at: number;
}

export function createSyncRepo(db: Db) {
  return {
    getToken(calendarId: string): string | null {
      const r = db.prepare('SELECT sync_token FROM sync_state WHERE calendar_id=?').get(calendarId) as { sync_token: string | null } | undefined;
      return r?.sync_token ?? null;
    },
    setToken(calendarId: string, token: string | null, lastSyncTs: number): void {
      db.prepare(
        `INSERT INTO sync_state(calendar_id, sync_token, last_sync_ts) VALUES (?,?,?)
         ON CONFLICT(calendar_id) DO UPDATE SET sync_token=excluded.sync_token, last_sync_ts=excluded.last_sync_ts`,
      ).run(calendarId, token, lastSyncTs);
    },
    clearToken(calendarId: string): void {
      db.prepare('DELETE FROM sync_state WHERE calendar_id=?').run(calendarId);
    },
    clearAll(): void {
      db.prepare('DELETE FROM sync_state').run();
      db.prepare('DELETE FROM sync_queue').run();
    },

    /** Enqueue an op; idempotent by opId (a re-enqueue replaces the payload). */
    enqueue(op: SyncQueueOp): void {
      db.prepare(
        `INSERT INTO sync_queue(op_id, calendar_id, event_id, op, payload, created_at) VALUES (@op_id,@calendar_id,@event_id,@op,@payload,@created_at)
         ON CONFLICT(op_id) DO UPDATE SET payload=excluded.payload, op=excluded.op`,
      ).run({
        op_id: op.opId, calendar_id: op.calendarId, event_id: op.eventId, op: op.op,
        payload: op.payload ? JSON.stringify(op.payload) : null, created_at: op.createdAt,
      });
    },
    /** Ops for a calendar in FIFO order. */
    pending(calendarId: string): SyncQueueOp[] {
      return (db.prepare('SELECT * FROM sync_queue WHERE calendar_id=? ORDER BY created_at, op_id').all(calendarId) as RawOp[]).map((r) => ({
        opId: r.op_id, calendarId: r.calendar_id, eventId: r.event_id, op: r.op as SyncQueueOp['op'],
        payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null, createdAt: r.created_at,
      }));
    },
    allPending(): SyncQueueOp[] {
      return (db.prepare('SELECT * FROM sync_queue ORDER BY created_at, op_id').all() as RawOp[]).map((r) => ({
        opId: r.op_id, calendarId: r.calendar_id, eventId: r.event_id, op: r.op as SyncQueueOp['op'],
        payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null, createdAt: r.created_at,
      }));
    },
    dequeue(opId: string): void {
      db.prepare('DELETE FROM sync_queue WHERE op_id=?').run(opId);
    },
  };
}

export type SyncRepo = ReturnType<typeof createSyncRepo>;
