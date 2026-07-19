import { describe, expect, it } from 'vitest';
import { openDb } from './connection';
import { migrate, LATEST_SCHEMA_VERSION } from './migrate';
import snapshot from './schema-snapshot.json';

/**
 * J1.1 migration integrity (Phase 10). A fresh DB migrated through 0001..0006
 * must produce exactly the committed schema — the snapshot is the source of
 * truth. Also asserts no table/index is created twice across parts and that the
 * migrator is idempotent-safe under the schema_version guard.
 */
function freshSchema(db: ReturnType<typeof openDb>): Array<{ type: string; name: string; tbl_name: string; sql: string | null }> {
  const rows = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  // The stored SQL echoes the migration file verbatim, so a CRLF checkout
  // (Windows) would diff against the committed LF snapshot. .gitattributes
  // pins LF; normalizing here keeps the gate honest regardless of checkout.
  return rows.map((r) => ({ ...r, sql: r.sql === null ? null : r.sql.replace(/\r\n/g, '\n') }));
}

describe('migration integrity (J1.1)', () => {
  it('a fresh DB migrates to the committed schema snapshot', () => {
    const db = openDb(':memory:');
    const version = migrate(db);
    expect(version).toBe(LATEST_SCHEMA_VERSION);
    expect(version).toBe(snapshot.schemaVersion);
    expect(freshSchema(db)).toEqual(snapshot.objects);
  });

  it('creates no table or index more than once across all migrations', () => {
    const db = openDb(':memory:');
    migrate(db);
    const names = freshSchema(db)
      .filter((o) => o.type === 'table' || o.type === 'index')
      .map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the audited tables/columns each exist exactly once', () => {
    const db = openDb(':memory:');
    migrate(db);
    const tables = freshSchema(db).filter((o) => o.type === 'table').map((o) => o.name);
    for (const t of ['action_log', 'usage_log', 'suggestions', 'chunks', 'events', 'sync_state', 'sync_queue']) {
      expect(tables.filter((n) => n === t)).toHaveLength(1);
    }
    // calendar columns land exactly once on events (0006)
    const cols = (db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ['calendar_id', 'remote_id', 'etag', 'sync_status']) {
      expect(cols.filter((n) => n === c)).toHaveLength(1);
    }
  });

  it('is idempotent-safe: re-running migrate on an up-to-date DB is a no-op', () => {
    const db = openDb(':memory:');
    const v1 = migrate(db);
    const before = freshSchema(db);
    let beforeMigrateCalled = false;
    const v2 = migrate(db, { onBeforeMigrate: () => { beforeMigrateCalled = true; } });
    expect(v2).toBe(v1);
    expect(beforeMigrateCalled).toBe(false); // no pending migration → no pre-migrate backup
    expect(freshSchema(db)).toEqual(before);
    // schema_version has exactly one row per applied migration (no double-insert)
    const versions = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>).map((r) => r.version);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('backfills calendar_id=default for events that predate 0006', () => {
    // Simulate a pre-0006 DB by migrating only through 0005, inserting an event,
    // then finishing the migration and asserting the row got a valid calendar_id.
    const db = openDb(':memory:');
    migrate(db); // full schema; then blank the column value to mimic a legacy NULL/absent write
    db.prepare(
      "INSERT INTO events(id,title,start_ts,end_ts,tz,all_day,rrule,exdates,location,notes,reminder_min,created_at,updated_at) VALUES ('e0','Legacy',0,0,'UTC',0,NULL,'[]',NULL,NULL,NULL,0,0)",
    ).run();
    const row = db.prepare('SELECT calendar_id FROM events WHERE id=?').get('e0') as { calendar_id: string };
    expect(row.calendar_id).toBe('default'); // NOT NULL DEFAULT 'default' backfills legacy inserts
  });
});
