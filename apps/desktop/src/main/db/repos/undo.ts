import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export interface UndoEntry {
  id: string; turnId: string; convId: string; tool: string; data: Record<string, unknown>; createdAt: number;
}

interface Raw { id: string; turn_id: string; tool: string; payload: string; created_at: number }

function toEntry(r: Raw): UndoEntry {
  const payload = JSON.parse(r.payload) as { convId: string; data: Record<string, unknown> };
  return { id: r.id, turnId: r.turn_id, convId: payload.convId, tool: r.tool, data: payload.data, createdAt: r.created_at };
}

export function createUndoRepo(db: Db) {
  return {
    /** Registers an inverse-operation payload; returns the undo token (row id). */
    push(input: { turnId: string; convId: string; tool: string; data: Record<string, unknown> }): string {
      const id = newId();
      db.prepare('INSERT INTO undo_log(id,turn_id,tool,payload,created_at) VALUES (?,?,?,?,?)').run(
        id, input.turnId, input.tool, JSON.stringify({ convId: input.convId, data: input.data }), nowMs(),
      );
      return id;
    },
    /** Pops (returns and removes) the most recent entry for a conversation. */
    popLatest(convId: string): UndoEntry | null {
      const r = db
        .prepare("SELECT * FROM undo_log WHERE json_extract(payload,'$.convId') = ? ORDER BY created_at DESC, id DESC LIMIT 1")
        .get(convId) as Raw | undefined;
      if (!r) return null;
      db.prepare('DELETE FROM undo_log WHERE id=?').run(r.id);
      return toEntry(r);
    },
    countFor(convId: string): number {
      return (db.prepare("SELECT COUNT(*) AS c FROM undo_log WHERE json_extract(payload,'$.convId') = ?").get(convId) as { c: number }).c;
    },
    /** Pops a specific entry by its token (E1 undo.apply for UI undo toasts). */
    popById(id: string): UndoEntry | null {
      const r = db.prepare('SELECT * FROM undo_log WHERE id = ?').get(id) as Raw | undefined;
      if (!r) return null;
      db.prepare('DELETE FROM undo_log WHERE id=?').run(r.id);
      return toEntry(r);
    },
  };
}

export type UndoRepo = ReturnType<typeof createUndoRepo>;
