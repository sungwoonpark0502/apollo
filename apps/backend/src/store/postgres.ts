import pg from 'pg';
import { periodResetIso, type RefreshRecord, type Store, type User, type UsageWindow } from './store';

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  rotated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
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
