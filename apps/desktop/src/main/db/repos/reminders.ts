import { newId, nowMs, MS } from '@apollo/shared';
import { type Db } from '../connection';

export interface ReminderRow {
  id: string; text: string; dueTs: number; rrule: string | null;
  firedAt: number | null; done: boolean; createdAt: number; updatedAt: number; deletedAt: number | null;
}

interface Raw {
  id: string; text: string; due_ts: number; rrule: string | null; fired_at: number | null;
  done: number; created_at: number; updated_at: number; deleted_at: number | null;
}

function toRow(r: Raw): ReminderRow {
  return {
    id: r.id, text: r.text, dueTs: r.due_ts, rrule: r.rrule, firedAt: r.fired_at,
    done: r.done === 1, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

export function createRemindersRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM reminders WHERE id = ?');

  function get(id: string): ReminderRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    create(input: { text: string; dueTs: number; rrule?: string | null }): ReminderRow {
      const id = newId();
      const ts = nowMs();
      db.prepare(
        'INSERT INTO reminders(id,text,due_ts,rrule,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      ).run(id, input.text, input.dueTs, input.rrule ?? null, ts, ts);
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    listPending(): ReminderRow[] {
      return (
        db.prepare('SELECT * FROM reminders WHERE done=0 AND deleted_at IS NULL ORDER BY due_ts LIMIT 50').all() as Raw[]
      ).map(toRow);
    },
    due(now: number): ReminderRow[] {
      return (
        db
          .prepare('SELECT * FROM reminders WHERE fired_at IS NULL AND done=0 AND deleted_at IS NULL AND due_ts <= ? ORDER BY due_ts')
          .all(now) as Raw[]
      ).map(toRow);
    },
    markFired(id: string, at: number): boolean {
      return db.prepare('UPDATE reminders SET fired_at=?, updated_at=? WHERE id=?').run(at, nowMs(), id).changes > 0;
    },
    complete(id: string): boolean {
      return db.prepare('UPDATE reminders SET done=1, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), id).changes > 0;
    },
    uncomplete(id: string): boolean {
      return db.prepare('UPDATE reminders SET done=0, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
    snooze(id: string, minutes: number, now: number = nowMs()): ReminderRow | null {
      const changed =
        db
          .prepare('UPDATE reminders SET due_ts=?, fired_at=NULL, updated_at=? WHERE id=? AND deleted_at IS NULL')
          .run(now + minutes * MS.minute, nowMs(), id).changes > 0;
      return changed ? get(id) : null;
    },
    /** Recurring reminder fired: arm the next occurrence. */
    rearm(id: string, nextDueTs: number): boolean {
      return db.prepare('UPDATE reminders SET due_ts=?, fired_at=NULL, updated_at=? WHERE id=?').run(nextDueTs, nowMs(), id).changes > 0;
    },
    softDelete(id: string): boolean {
      return db.prepare('UPDATE reminders SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), nowMs(), id).changes > 0;
    },
    restore(id: string): boolean {
      return db.prepare('UPDATE reminders SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
  };
}

export type RemindersRepo = ReturnType<typeof createRemindersRepo>;
