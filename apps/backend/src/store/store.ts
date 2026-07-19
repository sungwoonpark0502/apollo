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
  /** Subject claim from the identity provider (OIDC `sub`). For a
   *  password account this is `local:<userId>`, so one users table serves
   *  both sign-in paths without a nullable discriminator. */
  subject: string;
  /** L1.4 scrypt record for password accounts; null for IdP accounts. */
  passwordHash?: string | null;
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

/**
 * Phase 13.4 web content. The user decided the web client must carry Notes and
 * Calendar, which means account content lives server-side — superseding the
 * "backend stores no user content" line for WEB-created content. Desktop data
 * remains device-local; desktop↔server sync is the recorded next milestone.
 * Every row is scoped by userId, and every accessor takes the caller's userId
 * so cross-account reads are unrepresentable at the interface.
 */
export interface WebNote {
  id: string;
  userId: string;
  title: string;
  content: string;
  pinned: boolean;
  updatedAt: number;
}

export interface WebEvent {
  id: string;
  userId: string;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  updatedAt: number;
}

export interface Store {
  listNotes(userId: string): Promise<WebNote[]>;
  upsertNote(userId: string, note: Omit<WebNote, 'userId'>): Promise<WebNote>;
  deleteNote(userId: string, id: string): Promise<boolean>;

  listEvents(userId: string, fromIso: string, toIso: string): Promise<WebEvent[]>;
  upsertEvent(userId: string, event: Omit<WebEvent, 'userId'>): Promise<WebEvent>;
  deleteEvent(userId: string, id: string): Promise<boolean>;

  upsertUserBySubject(input: { subject: string; name: string; email: string }): Promise<User>;
  getUser(id: string): Promise<User | null>;

  // L1.4 in-app password accounts.
  getUserByEmail(email: string): Promise<User | null>;
  createPasswordUser(input: { name: string; email: string; passwordHash: string }): Promise<User>;

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
  const notes = new Map<string, WebNote>();
  const events = new Map<string, WebEvent>();
  const bySubject = new Map<string, string>();
  const byEmail = new Map<string, string>();
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
      byEmail.set(email.toLowerCase(), user.id);
      return user;
    },
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async listNotes(userId) {
      return [...notes.values()]
        .filter((n) => n.userId === userId)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    },
    async upsertNote(userId, note) {
      const existing = notes.get(note.id);
      // An id collision across accounts must never let one user overwrite
      // another's row; the incoming write simply loses.
      if (existing && existing.userId !== userId) return existing;
      const row: WebNote = { ...note, userId };
      notes.set(note.id, row);
      return row;
    },
    async deleteNote(userId, id) {
      const n = notes.get(id);
      if (!n || n.userId !== userId) return false;
      return notes.delete(id);
    },
    async listEvents(userId, fromIso, toIso) {
      return [...events.values()]
        .filter((e) => e.userId === userId && e.startIso < toIso && e.endIso >= fromIso)
        .sort((a, b) => a.startIso.localeCompare(b.startIso));
    },
    async upsertEvent(userId, event) {
      const existing = events.get(event.id);
      if (existing && existing.userId !== userId) return existing;
      const row: WebEvent = { ...event, userId };
      events.set(event.id, row);
      return row;
    },
    async deleteEvent(userId, id) {
      const e = events.get(id);
      if (!e || e.userId !== userId) return false;
      return events.delete(id);
    },
    async getUserByEmail(email) {
      const id = byEmail.get(email.toLowerCase());
      return id ? (users.get(id) ?? null) : null;
    },
    async createPasswordUser({ name, email, passwordHash }) {
      seq += 1;
      // subject is synthesized so password and IdP accounts share one table.
      const user: User = { id: `usr_${seq}`, name, email, plan: 'free', subject: `local:usr_${seq}`, passwordHash };
      users.set(user.id, user);
      byEmail.set(email.toLowerCase(), user.id);
      bySubject.set(user.subject, user.id);
      return user;
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
