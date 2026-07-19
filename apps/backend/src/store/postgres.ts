import pg from 'pg';
import { periodResetIso, type RefreshRecord, type Store, type User, type UsageWindow, type WebEvent, type WebNote } from './store';

/**
 * Postgres store (production). Schema is created on boot so a fresh deploy
 * works without a migration tool; the surface is tiny (users, refresh tokens,
 * usage counters) because the backend stores no user content.
 * Exercised in deployment, not CI — the suite uses createMemoryStore.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  subject TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- L1.4: added after the first deploy, so guard it for existing databases.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
-- One account per address, case-insensitive, across both sign-in paths.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  rotated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE TABLE IF NOT EXISTS web_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_notes_user ON web_notes(user_id);
CREATE TABLE IF NOT EXISTS web_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_iso TEXT NOT NULL,
  end_iso TEXT NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  notes TEXT,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_events_user ON web_events(user_id, start_iso);
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);
`;

function periodKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function createPostgresStore(connectionString: string): Promise<Store> {
  const pool = new pg.Pool({ connectionString });
  await pool.query(SCHEMA);

  return {
    async upsertUserBySubject({ subject, name, email }) {
      const { rows } = await pool.query<User>(
        `INSERT INTO users(id, subject, name, email)
         VALUES ('usr_' || substr(md5(random()::text), 1, 16), $1, $2, $3)
         ON CONFLICT (subject) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
         RETURNING id, name, email, plan, subject`,
        [subject, name, email],
      );
      return rows[0]!;
    },
    async getUser(id) {
      const { rows } = await pool.query<User>('SELECT id, name, email, plan, subject FROM users WHERE id=$1', [id]);
      return rows[0] ?? null;
    },
    async listNotes(userId) {
      const { rows } = await pool.query<{ id: string; user_id: string; title: string; content: string; pinned: boolean; updated_at: string }>(
        'SELECT * FROM web_notes WHERE user_id=$1 ORDER BY pinned DESC, updated_at DESC',
        [userId],
      );
      return rows.map((r): WebNote => ({ id: r.id, userId: r.user_id, title: r.title, content: r.content, pinned: r.pinned, updatedAt: Number(r.updated_at) }));
    },
    async upsertNote(userId, note) {
      // WHERE user_id on the conflict update: an id collision across accounts
      // must never overwrite another user's row.
      await pool.query(
        `INSERT INTO web_notes(id, user_id, title, content, pinned, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, pinned=EXCLUDED.pinned, updated_at=EXCLUDED.updated_at
         WHERE web_notes.user_id = $2`,
        [note.id, userId, note.title, note.content, note.pinned, note.updatedAt],
      );
      return { ...note, userId };
    },
    async deleteNote(userId, id) {
      return (await pool.query('DELETE FROM web_notes WHERE id=$1 AND user_id=$2', [id, userId])).rowCount === 1;
    },
    async listEvents(userId, fromIso, toIso) {
      const { rows } = await pool.query<{ id: string; user_id: string; title: string; start_iso: string; end_iso: string; all_day: boolean; location: string | null; notes: string | null; updated_at: string }>(
        'SELECT * FROM web_events WHERE user_id=$1 AND start_iso < $3 AND end_iso >= $2 ORDER BY start_iso',
        [userId, fromIso, toIso],
      );
      return rows.map((r): WebEvent => ({ id: r.id, userId: r.user_id, title: r.title, startIso: r.start_iso, endIso: r.end_iso, allDay: r.all_day, location: r.location, notes: r.notes, updatedAt: Number(r.updated_at) }));
    },
    async upsertEvent(userId, event) {
      await pool.query(
        `INSERT INTO web_events(id, user_id, title, start_iso, end_iso, all_day, location, notes, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, start_iso=EXCLUDED.start_iso, end_iso=EXCLUDED.end_iso, all_day=EXCLUDED.all_day, location=EXCLUDED.location, notes=EXCLUDED.notes, updated_at=EXCLUDED.updated_at
         WHERE web_events.user_id = $2`,
        [event.id, userId, event.title, event.startIso, event.endIso, event.allDay, event.location, event.notes, event.updatedAt],
      );
      return { ...event, userId };
    },
    async deleteEvent(userId, id) {
      return (await pool.query('DELETE FROM web_events WHERE id=$1 AND user_id=$2', [id, userId])).rowCount === 1;
    },
    async getUserByEmail(email) {
      const { rows } = await pool.query<User & { password_hash: string | null }>(
        'SELECT id, name, email, plan, subject, password_hash FROM users WHERE lower(email)=lower($1)',
        [email],
      );
      const r = rows[0];
      return r ? { id: r.id, name: r.name, email: r.email, plan: r.plan, subject: r.subject, passwordHash: r.password_hash } : null;
    },
    async createPasswordUser({ name, email, passwordHash }) {
      const { rows } = await pool.query<User>(
        `INSERT INTO users(id, subject, name, email, password_hash)
         VALUES ('usr_' || substr(md5(random()::text), 1, 16), 'local:pending', $1, $2, $3)
         RETURNING id, name, email, plan, subject`,
        [name, email, passwordHash],
      );
      const u = rows[0]!;
      // subject is derived from the id, which Postgres generates, so settle it
      // in a second statement rather than guessing the id client-side.
      await pool.query('UPDATE users SET subject = $1 WHERE id = $2', [`local:${u.id}`, u.id]);
      return { ...u, subject: `local:${u.id}`, passwordHash };
    },
    async putRefresh(rec) {
      await pool.query('INSERT INTO refresh_tokens(token_hash, user_id, expires_at, rotated_at) VALUES ($1,$2,$3,$4)', [
        rec.tokenHash,
        rec.userId,
        rec.expiresAt,
        rec.rotatedAt,
      ]);
    },
    async getRefresh(tokenHash) {
      const { rows } = await pool.query<{ token_hash: string; user_id: string; expires_at: string; rotated_at: string | null }>(
        'SELECT token_hash, user_id, expires_at, rotated_at FROM refresh_tokens WHERE token_hash=$1',
        [tokenHash],
      );
      const r = rows[0];
      if (!r) return null;
      const out: RefreshRecord = {
        tokenHash: r.token_hash,
        userId: r.user_id,
        expiresAt: Number(r.expires_at),
        rotatedAt: r.rotated_at === null ? null : Number(r.rotated_at),
      };
      return out;
    },
    async markRefreshRotated(tokenHash, at) {
      await pool.query('UPDATE refresh_tokens SET rotated_at=$2 WHERE token_hash=$1', [tokenHash, at]);
    },
    async revokeUserRefresh(userId) {
      await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [userId]);
    },
    async recordTurn(userId, limit, now): Promise<UsageWindow> {
      const { rows } = await pool.query<{ turns: number }>(
        `INSERT INTO usage_counters(user_id, period, turns) VALUES ($1,$2,1)
         ON CONFLICT (user_id, period) DO UPDATE SET turns = usage_counters.turns + 1
         RETURNING turns`,
        [userId, periodKey(now)],
      );
      return { used: rows[0]?.turns ?? 1, limit, resetIso: periodResetIso(now) };
    },
    async getUsage(userId, limit, now): Promise<UsageWindow> {
      const { rows } = await pool.query<{ turns: number }>('SELECT turns FROM usage_counters WHERE user_id=$1 AND period=$2', [
        userId,
        periodKey(now),
      ]);
      return { used: rows[0]?.turns ?? 0, limit, resetIso: periodResetIso(now) };
    },
  };
}
