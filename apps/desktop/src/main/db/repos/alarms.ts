import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export interface AlarmRow {
  id: string; label: string | null; atTs: number; rrule: string | null;
  enabled: boolean; firedAt: number | null; createdAt: number; updatedAt: number; deletedAt: number | null;
}

interface Raw {
  id: string; label: string | null; at_ts: number; rrule: string | null; enabled: number;
  fired_at: number | null; created_at: number; updated_at: number; deleted_at: number | null;
}

function toRow(r: Raw): AlarmRow {
  return {
    id: r.id, label: r.label, atTs: r.at_ts, rrule: r.rrule, enabled: r.enabled === 1,
    firedAt: r.fired_at, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

export function createAlarmsRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM alarms WHERE id = ?');

  function get(id: string): AlarmRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    set(input: { label?: string | null; atTs: number; rrule?: string | null }): AlarmRow {
      const id = newId();
      const ts = nowMs();
      db.prepare('INSERT INTO alarms(id,label,at_ts,rrule,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
        id, input.label ?? null, input.atTs, input.rrule ?? null, ts, ts,
      );
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    listEnabled(): AlarmRow[] {
      return (db.prepare('SELECT * FROM alarms WHERE enabled=1 AND deleted_at IS NULL ORDER BY at_ts').all() as Raw[]).map(toRow);
    },
    due(now: number): AlarmRow[] {
      return (
        db.prepare('SELECT * FROM alarms WHERE enabled=1 AND deleted_at IS NULL AND fired_at IS NULL AND at_ts <= ? ORDER BY at_ts').all(now) as Raw[]
      ).map(toRow);
    },
    setEnabled(id: string, on: boolean): boolean {
      return db.prepare('UPDATE alarms SET enabled=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(on ? 1 : 0, nowMs(), id).changes > 0;
    },
    markFired(id: string, at: number): boolean {
      return db.prepare('UPDATE alarms SET fired_at=?, updated_at=? WHERE id=?').run(at, nowMs(), id).changes > 0;
    },
    /** Recurring alarm fired: arm next occurrence. One-shots stay fired. */
    rearm(id: string, nextAtTs: number): boolean {
      return db.prepare('UPDATE alarms SET at_ts=?, fired_at=NULL, updated_at=? WHERE id=?').run(nextAtTs, nowMs(), id).changes > 0;
    },
    softDelete(id: string): boolean {
      return db.prepare('UPDATE alarms SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), nowMs(), id).changes > 0;
    },
    restore(id: string): boolean {
      return db.prepare('UPDATE alarms SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
  };
}

export type AlarmsRepo = ReturnType<typeof createAlarmsRepo>;
