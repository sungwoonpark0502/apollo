import { newId, nowMs, type NoteListItem } from '@apollo/shared';
import { type Db } from '../connection';

export interface NoteRow {
  id: string; content: string; tags: string[]; pinned: boolean;
  createdAt: number; updatedAt: number; deletedAt: number | null;
}

export interface NoteHit { id: string; snippet: string; content: string }

interface Raw {
  id: string; content: string; tags: string | null; pinned: number;
  created_at: number; updated_at: number; deleted_at: number | null;
}

function toRow(r: Raw): NoteRow {
  return {
    id: r.id, content: r.content, tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    pinned: r.pinned === 1, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
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

/** E2: title = first non-empty line trimmed to 80 chars (fallback "Untitled"); snippet = next 120 chars. */
export function deriveTitleSnippet(content: string): { title: string; snippet: string } {
  const lines = content.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return { title: 'Untitled', snippet: '' };
  const title = (lines[firstIdx] as string).trim().slice(0, 80);
  const rest = lines.slice(firstIdx + 1).join('\n').trim();
  return { title, snippet: rest.slice(0, 120) };
}

function toListItem(r: Raw): NoteListItem {
  const { title, snippet } = deriveTitleSnippet(r.content);
  return { id: r.id, title, snippet, updatedAt: r.updated_at, pinned: r.pinned === 1 };
}

// FTS sync is owned by the 0002 triggers (notes_ai/notes_au/notes_ad); this repo
// never writes notes_fts directly. Soft-deleted rows keep their FTS entry and
// are filtered out by the deleted_at IS NULL join in search queries.
export function createNotesRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM notes WHERE id = ?');

  function get(id: string): NoteRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    save(input: { content: string; tags?: string[] }): NoteRow {
      const id = newId();
      const ts = nowMs();
      db.prepare('INSERT INTO notes(id,content,tags,created_at,updated_at) VALUES (?,?,?,?,?)').run(
        id, input.content, input.tags && input.tags.length ? JSON.stringify(input.tags) : null, ts, ts,
      );
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    /** All non-deleted notes with full content (H2 export). */
    allFull(): NoteRow[] {
      return (db.prepare('SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as Raw[]).map(toRow);
    },
    /** H2 import: insert preserving id; returns false if the id already exists. */
    importRow(row: { id: string; content: string; tags?: string[]; createdAt?: number; updatedAt?: number; pinned?: boolean }): boolean {
      if (db.prepare('SELECT 1 FROM notes WHERE id=?').get(row.id)) return false;
      const ts = nowMs();
      db.prepare('INSERT INTO notes(id,content,tags,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
        row.id, row.content, row.tags && row.tags.length ? JSON.stringify(row.tags) : null,
        row.pinned ? 1 : 0, row.createdAt ?? ts, row.updatedAt ?? ts,
      );
      return true;
    },
    update(id: string, content: string): NoteRow | null {
      const cur = get(id);
      if (!cur || cur.deletedAt) return null;
      db.prepare('UPDATE notes SET content=?, updated_at=? WHERE id=?').run(content, nowMs(), id);
      return get(id);
    },
    setPinned(id: string, pinned: boolean): boolean {
      return db.prepare('UPDATE notes SET pinned=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(pinned ? 1 : 0, nowMs(), id).changes > 0;
    },
    /** Workspace list (E1 notes.list): pinned first then updated desc; FTS when query given. */
    list(opts: { query?: string; limit?: number } = {}): NoteListItem[] {
      const limit = opts.limit ?? 50;
      if (opts.query && opts.query.trim()) {
        const query = ftsQuery(opts.query);
        if (!query) return [];
        return (
          db
            .prepare(
              `SELECT n.* FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
               WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
               ORDER BY n.pinned DESC, rank LIMIT ?`,
            )
            .all(query, limit) as Raw[]
        ).map(toListItem);
      }
      return (
        db
          .prepare('SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC LIMIT ?')
          .all(limit) as Raw[]
      ).map(toListItem);
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
      return db.prepare('UPDATE notes SET deleted_at=?, updated_at=? WHERE id=?').run(nowMs(), nowMs(), id).changes > 0;
    },
    restore(id: string): boolean {
      return db.prepare('UPDATE notes SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
