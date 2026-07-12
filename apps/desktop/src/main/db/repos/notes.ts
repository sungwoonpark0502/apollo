import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export interface NoteRow {
  id: string; content: string; tags: string[]; createdAt: number; updatedAt: number; deletedAt: number | null;
}

export interface NoteHit { id: string; snippet: string; content: string }

interface Raw { id: string; content: string; tags: string | null; created_at: number; updated_at: number; deleted_at: number | null }

function toRow(r: Raw): NoteRow {
  return {
    id: r.id, content: r.content, tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

/** Escape a user query into quoted FTS5 terms so raw input can't break MATCH syntax. */
function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(' ');
}

export function createNotesRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM notes WHERE id = ?');
  const rowidOf = db.prepare('SELECT rowid AS rid FROM notes WHERE id = ?');

  function get(id: string): NoteRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  function ftsDelete(id: string): void {
    const r = rowidOf.get(id) as { rid: number } | undefined;
    if (!r) return;
    const note = byId.get(id) as Raw | undefined;
    if (!note) return;
    db.prepare("INSERT INTO notes_fts(notes_fts, rowid, content) VALUES ('delete', ?, ?)").run(r.rid, note.content);
  }

  return {
    save(input: { content: string; tags?: string[] }): NoteRow {
      const id = newId();
      const ts = nowMs();
      db.prepare('INSERT INTO notes(id,content,tags,created_at,updated_at) VALUES (?,?,?,?,?)').run(
        id, input.content, input.tags && input.tags.length ? JSON.stringify(input.tags) : null, ts, ts,
      );
      const r = rowidOf.get(id) as { rid: number };
      db.prepare('INSERT INTO notes_fts(rowid, content) VALUES (?, ?)').run(r.rid, input.content);
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    update(id: string, content: string): NoteRow | null {
      const cur = get(id);
      if (!cur || cur.deletedAt) return null;
      ftsDelete(id);
      db.prepare('UPDATE notes SET content=?, updated_at=? WHERE id=?').run(content, nowMs(), id);
      const r = rowidOf.get(id) as { rid: number };
      db.prepare('INSERT INTO notes_fts(rowid, content) VALUES (?, ?)').run(r.rid, content);
      return get(id);
    },
    search(q: string, limit = 10): NoteHit[] {
      const query = ftsQuery(q);
      if (!query) return [];
      return db
        .prepare(
          `SELECT n.id AS id, n.content AS content, snippet(notes_fts, 0, '[', ']', '…', 10) AS snippet
           FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
           WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
           ORDER BY rank LIMIT ?`,
        )
        .all(query, limit) as NoteHit[];
    },
    softDelete(id: string): boolean {
      const cur = get(id);
      if (!cur || cur.deletedAt) return false;
      ftsDelete(id);
      return db.prepare('UPDATE notes SET deleted_at=?, updated_at=? WHERE id=?').run(nowMs(), nowMs(), id).changes > 0;
    },
    restore(id: string): boolean {
      const ok = db.prepare('UPDATE notes SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
      if (ok) {
        const note = byId.get(id) as Raw;
        const r = rowidOf.get(id) as { rid: number };
        db.prepare('INSERT INTO notes_fts(rowid, content) VALUES (?, ?)').run(r.rid, note.content);
      }
      return ok;
    },
  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
