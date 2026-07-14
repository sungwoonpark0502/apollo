import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export type Db = Database.Database;

/** Opens the SQLite database (':memory:' for tests) with the C6 pragmas and the
 *  sqlite-vec extension loaded into the same connection (G2). */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  try {
    sqliteVec.load(db);
  } catch (e) {
    // Recall degrades to keyword-only if the extension can't load; never blocks boot.
    console.error(`sqlite-vec load failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return db;
}

/** True if the vector extension loaded (vec0 virtual tables usable). */
export function vecAvailable(db: Db): boolean {
  try {
    db.prepare('SELECT vec_version()').get();
    return true;
  } catch {
    return false;
  }
}
