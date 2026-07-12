import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export interface ContactRow {
  id: string; name: string; email: string | null; createdAt: number; updatedAt: number; deletedAt: number | null;
}

interface Raw { id: string; name: string; email: string | null; created_at: number; updated_at: number; deleted_at: number | null }

function toRow(r: Raw): ContactRow {
  return { id: r.id, name: r.name, email: r.email, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at };
}

export function createContactsRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM contacts WHERE id = ?');

  function get(id: string): ContactRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    add(input: { name: string; email?: string | null }): ContactRow {
      const id = newId();
      const ts = nowMs();
      db.prepare('INSERT INTO contacts(id,name,email,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, input.name, input.email ?? null, ts, ts);
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    update(id: string, patch: { name?: string; email?: string | null }): ContactRow | null {
      const cur = get(id);
      if (!cur || cur.deletedAt) return null;
      db.prepare('UPDATE contacts SET name=?, email=?, updated_at=? WHERE id=?').run(
        patch.name ?? cur.name, patch.email === undefined ? cur.email : patch.email, nowMs(), id,
      );
      return get(id);
    },
    list(): ContactRow[] {
      return (db.prepare('SELECT * FROM contacts WHERE deleted_at IS NULL ORDER BY name').all() as Raw[]).map(toRow);
    },
    /** Fuzzy find: exact (case-insensitive) first, then prefix, then substring on any name token. */
    find(name: string): ContactRow[] {
      const q = name.trim().toLowerCase();
      if (!q) return [];
      const all = (db.prepare('SELECT * FROM contacts WHERE deleted_at IS NULL').all() as Raw[]).map(toRow);
      const scored = all
        .map((c) => {
          const n = c.name.toLowerCase();
          const tokens = n.split(/\s+/);
          let score = 0;
          if (n === q) score = 100;
          else if (tokens.some((t) => t === q)) score = 90;
          else if (n.startsWith(q) || tokens.some((t) => t.startsWith(q))) score = 70;
          else if (n.includes(q)) score = 50;
          return { c, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.map((s) => s.c);
    },
    softDelete(id: string): boolean {
      return db.prepare('UPDATE contacts SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), nowMs(), id).changes > 0;
    },
  };
}

export type ContactsRepo = ReturnType<typeof createContactsRepo>;
