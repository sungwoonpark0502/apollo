import { type Db } from './connection';
import m0001 from './migrations/0001_init.sql?raw';
import m0002 from './migrations/0002_workspace.sql?raw';

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: m0001 },
  { version: 2, sql: m0002 },
];

/** Applies pending numbered migrations in one transaction; returns the schema version. */
export function migrate(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  let current = row.v ?? 0;
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
