import { newId, nowMs, type Feed } from '@apollo/shared';
import { type Db } from '../connection';

export function createCapabilityMissesRepo(db: Db) {
  return {
    add(utterance: string): void {
      db.prepare('INSERT INTO capability_misses(id, utterance, ts) VALUES (?,?,?)').run(newId(), utterance, nowMs());
    },
    count(): number {
      return (db.prepare('SELECT COUNT(*) AS c FROM capability_misses').get() as { c: number }).c;
    },
    list(limit = 100): Array<{ id: string; utterance: string; ts: number }> {
      return db.prepare('SELECT * FROM capability_misses ORDER BY ts DESC LIMIT ?').all(limit) as Array<{ id: string; utterance: string; ts: number }>;
    },
  };
}

export function createFeedsRepo(db: Db) {
  return {
    upsert(feed: { id?: string; url: string; category: string; enabled?: boolean }): Feed {
      const id = feed.id ?? newId();
      db.prepare(
        'INSERT INTO feeds(id,url,category,enabled) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, category=excluded.category, enabled=excluded.enabled',
      ).run(id, feed.url, feed.category, feed.enabled === false ? 0 : 1);
      return { id, url: feed.url, category: feed.category, enabled: feed.enabled !== false };
    },
    list(opts: { category?: string; enabledOnly?: boolean } = {}): Feed[] {
      const rows = db.prepare('SELECT * FROM feeds').all() as Array<{ id: string; url: string; category: string; enabled: number }>;
      return rows
        .filter((r) => (opts.enabledOnly ? r.enabled === 1 : true))
        .filter((r) => (opts.category ? r.category === opts.category : true))
        .map((r) => ({ id: r.id, url: r.url, category: r.category, enabled: r.enabled === 1 }));
    },
    setEnabled(id: string, on: boolean): boolean {
      return db.prepare('UPDATE feeds SET enabled=? WHERE id=?').run(on ? 1 : 0, id).changes > 0;
    },
    remove(id: string): boolean {
      return db.prepare('DELETE FROM feeds WHERE id=?').run(id).changes > 0;
    },
    /** Seeds defaults only when the table is empty. */
    seed(defaults: Array<{ url: string; category: string }>): void {
      const count = (db.prepare('SELECT COUNT(*) AS c FROM feeds').get() as { c: number }).c;
      if (count > 0) return;
      for (const f of defaults) db.prepare('INSERT INTO feeds(id,url,category,enabled) VALUES (?,?,?,1)').run(newId(), f.url, f.category);
    },
  };
}

export function createPerfRepo(db: Db) {
  return {
    record(turnId: string, name: string, durMs: number): void {
      db.prepare('INSERT INTO perf_spans(id,turn_id,name,dur_ms,ts) VALUES (?,?,?,?,?)').run(newId(), turnId, name, Math.round(durMs), nowMs());
    },
    /** p50/p95 per span name over the most recent `sample` spans of each name. */
    aggregates(sample = 500): Array<{ name: string; count: number; p50: number; p95: number }> {
      const names = db.prepare('SELECT DISTINCT name FROM perf_spans').all() as Array<{ name: string }>;
      return names.map(({ name }) => {
        const durs = (db.prepare('SELECT dur_ms FROM perf_spans WHERE name=? ORDER BY ts DESC LIMIT ?').all(name, sample) as Array<{ dur_ms: number }>)
          .map((r) => r.dur_ms)
          .sort((a, b) => a - b);
        const pick = (p: number): number => durs[Math.min(durs.length - 1, Math.floor((p / 100) * durs.length))] ?? 0;
        return { name, count: durs.length, p50: pick(50), p95: pick(95) };
      });
    },
  };
}

export function createSettingsRepo(db: Db) {
  return {
    get(key: string): string | null {
      const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
      return r ? r.value : null;
    },
    set(key: string, value: string): void {
      db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    },
    delete(key: string): boolean {
      return db.prepare('DELETE FROM settings WHERE key=?').run(key).changes > 0;
    },
    all(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const r of db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>) out[r.key] = r.value;
      return out;
    },
  };
}

export type CapabilityMissesRepo = ReturnType<typeof createCapabilityMissesRepo>;
export type FeedsRepo = ReturnType<typeof createFeedsRepo>;
export type PerfRepo = ReturnType<typeof createPerfRepo>;
export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
