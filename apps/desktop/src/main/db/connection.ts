import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Opens the SQLite database (':memory:' for tests) with the C6 pragmas. */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  return db;
}
