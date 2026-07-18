/**
 * L0.1 persistence boundary. Users + usage only — the backend is an inference
 * and identity proxy, never a store of user content (notes/events stay local on
 * the device). Abstracted so the test suite runs fully in-memory with no
 * Postgres, keeping the offline CI story intact.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  plan: string;
  /** Subject claim from the identity provider (OIDC `sub`). */
  subject: string;
}

export interface RefreshRecord {
  /** SHA-256 of the token; raw refresh tokens are never stored. */
  tokenHash: string;
  userId: string;
  expiresAt: number;
  /** Set when the token has been consumed by a rotation. */
  rotatedAt: number | null;
}

export interface UsageWindow {
  used: number;
  limit: number;
  resetIso: string;
}

export interface Store {
  upsertUserBySubject(input: { subject: string; name: string; email: string }): Promise<User>;
  getUser(id: string): Promise<User | null>;

  putRefresh(rec: RefreshRecord): Promise<void>;
  getRefresh(tokenHash: string): Promise<RefreshRecord | null>;
  markRefreshRotated(tokenHash: string, at: number): Promise<void>;
  /** Revoke every refresh token for a user (logout, or reuse-detection). */
  revokeUserRefresh(userId: string): Promise<void>;

  /** Increments the period counter and returns the window AFTER the increment. */
  recordTurn(userId: string, limit: number, now: number): Promise<UsageWindow>;
  getUsage(userId: string, limit: number, now: number): Promise<UsageWindow>;
}

/** First day of next month, UTC — the usage period boundary. */
export function periodResetIso(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

function periodKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createMemoryStore(): Store {
  const users = new Map<string, User>();
  const bySubject = new Map<string, string>();
  const refresh = new Map<string, RefreshRecord>();
  const usage = new Map<string, number>(); // `${userId}:${period}` → turns

  let seq = 0;
  return {
    async upsertUserBySubject({ subject, name, email }) {
      const existingId = bySubject.get(subject);
      if (existingId) {
        const u = users.get(existingId)!;
        const updated: User = { ...u, name, email };
        users.set(u.id, updated);
        return updated;
      }
      seq += 1;
      const user: User = { id: `usr_${seq}`, name, email, plan: 'free', subject };
      users.set(user.id, user);
      bySubject.set(subject, user.id);
      return user;
    },
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async putRefresh(rec) {
      refresh.set(rec.tokenHash, rec);
    },
    async getRefresh(tokenHash) {
      return refresh.get(tokenHash) ?? null;
    },
    async markRefreshRotated(tokenHash, at) {
      const r = refresh.get(tokenHash);
      if (r) refresh.set(tokenHash, { ...r, rotatedAt: at });
    },
    async revokeUserRefresh(userId) {
      for (const [hash, rec] of refresh) if (rec.userId === userId) refresh.delete(hash);
    },
    async recordTurn(userId, limit, now) {
      const key = `${userId}:${periodKey(now)}`;
      const used = (usage.get(key) ?? 0) + 1;
      usage.set(key, used);
      return { used, limit, resetIso: periodResetIso(now) };
    },
    async getUsage(userId, limit, now) {
      return { used: usage.get(`${userId}:${periodKey(now)}`) ?? 0, limit, resetIso: periodResetIso(now) };
    },
  };
}
