import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export interface TodoRow {
  id: string; content: string; dueTs: number | null; done: boolean;
  createdAt: number; updatedAt: number; deletedAt: number | null;
}

interface Raw { id: string; content: string; due_ts: number | null; done: number; created_at: number; updated_at: number; deleted_at: number | null }

function toRow(r: Raw): TodoRow {
  return { id: r.id, content: r.content, dueTs: r.due_ts, done: r.done === 1, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at };
}

export function createTodosRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM todos WHERE id = ?');

  function get(id: string): TodoRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    add(input: { content: string; dueTs?: number | null }): TodoRow {
      const id = newId();
      const ts = nowMs();
      db.prepare('INSERT INTO todos(id,content,due_ts,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, input.content, input.dueTs ?? null, ts, ts);
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    /** H2 export: all non-deleted todos. */
    allActive(): TodoRow[] {
      return (db.prepare('SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY created_at').all() as Raw[]).map(toRow);
    },
    /** H2 import: insert preserving id; false if id exists. */
    importRow(row: { id: string; content: string; dueTs?: number | null; done?: boolean; createdAt?: number; updatedAt?: number }): boolean {
      if (db.prepare('SELECT 1 FROM todos WHERE id=?').get(row.id)) return false;
      const ts = nowMs();
      db.prepare('INSERT INTO todos(id,content,due_ts,done,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
        row.id, row.content, row.dueTs ?? null, row.done ? 1 : 0, row.createdAt ?? ts, row.updatedAt ?? ts,
      );
      return true;
    },
    listOpen(limit = 50): TodoRow[] {
      return (db.prepare('SELECT * FROM todos WHERE done=0 AND deleted_at IS NULL ORDER BY COALESCE(due_ts, 9e15), created_at LIMIT ?').all(limit) as Raw[]).map(toRow);
    },
    /** Workspace list: open first (due order), then done (recent first). */
    listAll(limit = 100): TodoRow[] {
      return (
        db
          .prepare('SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY done ASC, COALESCE(due_ts, 9e15), created_at LIMIT ?')
          .all(limit) as Raw[]
      ).map(toRow);
    },
    complete(id: string): boolean {
      return db.prepare('UPDATE todos SET done=1, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), id).changes > 0;
    },
    uncomplete(id: string): boolean {
      return db.prepare('UPDATE todos SET done=0, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
    /** Fuzzy content match over open todos: all query tokens must appear (case-insensitive). */
    fuzzyByContent(content: string): TodoRow[] {
      const tokens = content.toLowerCase().split(/\s+/).filter(Boolean);
      const open = (db.prepare('SELECT * FROM todos WHERE done=0 AND deleted_at IS NULL').all() as Raw[]).map(toRow);
      return open.filter((t) => {
        const c = t.content.toLowerCase();
        return tokens.every((tok) => c.includes(tok));
      });
    },
    softDelete(id: string): boolean {
      return db.prepare('UPDATE todos SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), nowMs(), id).changes > 0;
    },
    restore(id: string): boolean {
      return db.prepare('UPDATE todos SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
  };
}

export type TodosRepo = ReturnType<typeof createTodosRepo>;
