import { type Db } from './connection';
import m0001 from './migrations/0001_init.sql?raw';
import m0002 from './migrations/0002_workspace.sql?raw';
import m0003 from './migrations/0003_proactive.sql?raw';
import m0004 from './migrations/0004_memory.sql?raw';
import m0005 from './migrations/0005_hardening.sql?raw';

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: m0001 },
  { version: 2, sql: m0002 },
  { version: 3, sql: m0003 },
  { version: 4, sql: m0004 },
  { version: 5, sql: m0005 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Applies pending numbered migrations in one transaction; returns the schema version.
 *  onBeforeMigrate fires once (H2 pre-migrate backup) only when migrations are pending. */
export function migrate(db: Db, opts: { onBeforeMigrate?: (fromVersion: number) => void } = {}): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  let current = row.v ?? 0;
  if (opts.onBeforeMigrate && current < LATEST_SCHEMA_VERSION) opts.onBeforeMigrate(current);
  db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (m.version > current) {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(m.version);
        current = m.version;
      }
    }
  })();
  return current;
}
