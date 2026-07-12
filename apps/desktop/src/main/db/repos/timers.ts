import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export interface TimerRow {
  id: string; label: string | null; endsAt: number; canceled: boolean; firedAt: number | null; createdAt: number;
}

interface Raw { id: string; label: string | null; ends_at: number; canceled: number; fired_at: number | null; created_at: number }

function toRow(r: Raw): TimerRow {
  return { id: r.id, label: r.label, endsAt: r.ends_at, canceled: r.canceled === 1, firedAt: r.fired_at, createdAt: r.created_at };
}

export function createTimersRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM timers WHERE id = ?');

  function get(id: string): TimerRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    start(input: { label?: string | null; endsAt: number }): TimerRow {
      const id = newId();
      db.prepare('INSERT INTO timers(id,label,ends_at,created_at) VALUES (?,?,?,?)').run(id, input.label ?? null, input.endsAt, nowMs());
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    listActive(): TimerRow[] {
      return (db.prepare('SELECT * FROM timers WHERE canceled=0 AND fired_at IS NULL ORDER BY ends_at').all() as Raw[]).map(toRow);
    },
    due(now: number): TimerRow[] {
      return (db.prepare('SELECT * FROM timers WHERE canceled=0 AND fired_at IS NULL AND ends_at <= ? ORDER BY ends_at').all(now) as Raw[]).map(toRow);
    },
    cancel(id: string): boolean {
      return db.prepare('UPDATE timers SET canceled=1 WHERE id=? AND canceled=0 AND fired_at IS NULL').run(id).changes > 0;
    },
    uncancel(id: string): boolean {
      return db.prepare('UPDATE timers SET canceled=0 WHERE id=?').run(id).changes > 0;
    },
    markFired(id: string, at: number): boolean {
      return db.prepare('UPDATE timers SET fired_at=? WHERE id=?').run(at, id).changes > 0;
    },
  };
}

export type TimersRepo = ReturnType<typeof createTimersRepo>;
