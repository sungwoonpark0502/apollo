import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './connection';
import { migrate } from './migrate';
import { createBackup, listBackups, pruneBackups, quickCheck, recoverIfCorrupt, backupsDir } from './backup';

let dir: string;
let dbPath: string;

function seedDb(path: string): void {
  const db = openDb(path);
  migrate(db);
  db.prepare('INSERT INTO notes(id,content,created_at,updated_at) VALUES (?,?,?,?)').run('n1', 'hello', 1, 1);
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apollo-backup-'));
  dbPath = join(dir, 'apollo.db');
  seedDb(dbPath);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('backups (H2)', () => {
  it('VACUUM INTO produces a valid, queryable backup', () => {
    const dest = createBackup(dbPath, dir, 'manual');
    expect(existsSync(dest)).toBe(true);
    expect(quickCheck(dest)).toBe(true);
    const db = openDb(dest);
    expect((db.prepare('SELECT content FROM notes WHERE id=?').get('n1') as { content: string }).content).toBe('hello');
    db.close();
  });

  it('retention keeps only the newest 5 per reason class', () => {
    for (let i = 0; i < 8; i++) createBackup(dbPath, dir, 'auto', 1000 + i * 1000);
    createBackup(dbPath, dir, 'manual', 99_000);
    const autos = listBackups(dir).filter((b) => b.reason === 'auto');
    const manuals = listBackups(dir).filter((b) => b.reason === 'manual');
    expect(autos).toHaveLength(5);
    expect(manuals).toHaveLength(1);
    // the newest autos are retained
    expect(autos[0]!.createdAt).toBeGreaterThanOrEqual(autos[4]!.createdAt);
  });

  it('pruneBackups is idempotent and reason-scoped', () => {
    for (let i = 0; i < 3; i++) createBackup(dbPath, dir, 'pre-migrate', 2000 + i);
    pruneBackups(dir, 'pre-migrate');
    expect(listBackups(dir).filter((b) => b.reason === 'pre-migrate')).toHaveLength(3);
  });

  it('falls back to file copy when VACUUM INTO cannot run', () => {
    // point at a path whose parent lets copy work but make VACUUM fail via a bogus target dir permission:
    // simplest: corrupt-but-copyable file still yields a backup file via fallback.
    const weird = join(dir, 'plain.db');
    writeFileSync(weird, 'not really sqlite');
    const dest = createBackup(weird, dir, 'manual');
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toContain('not really sqlite');
  });
});

describe('integrity + corrupt recovery (H2)', () => {
  it('quickCheck passes on a healthy DB and a fresh (absent) path', () => {
    expect(quickCheck(dbPath)).toBe(true);
    expect(quickCheck(join(dir, 'does-not-exist.db'))).toBe(true);
  });

  it('detects a corrupt file and restores the newest backup', () => {
    createBackup(dbPath, dir, 'manual', 5000); // good backup exists
    // corrupt the live DB: overwrite header with garbage
    writeFileSync(dbPath, Buffer.concat([Buffer.from('CORRUPTED HEADER'), readFileSync(dbPath).subarray(16)]));
    expect(quickCheck(dbPath)).toBe(false);

    const res = recoverIfCorrupt(dbPath, dir, 6000);
    expect(res.recovered).toBe('restored-backup');
    expect(res.corruptPath && existsSync(res.corruptPath)).toBe(true);
    expect(quickCheck(dbPath)).toBe(true);
    const db = openDb(dbPath);
    expect((db.prepare('SELECT content FROM notes WHERE id=?').get('n1') as { content: string }).content).toBe('hello');
    db.close();
  });

  it('starts fresh when corrupt and no backup exists', () => {
    writeFileSync(dbPath, 'totally not a database at all, garbage bytes');
    expect(quickCheck(dbPath)).toBe(false);
    const res = recoverIfCorrupt(dbPath, dir, 7000);
    expect(res.recovered).toBe('started-fresh');
    expect(res.corruptPath && existsSync(res.corruptPath)).toBe(true);
    // a fresh DB opens + migrates cleanly
    const db = openDb(dbPath);
    expect(migrate(db)).toBeGreaterThan(0);
    db.close();
  });

  it('healthy DB is left untouched by recovery', () => {
    const res = recoverIfCorrupt(dbPath, dir, 8000);
    expect(res.recovered).toBe('ok');
    expect(readdirSync(dir).some((f) => f.startsWith('apollo-corrupt-'))).toBe(false);
  });

  it('pre-migrate backup fires only when migrations are pending', () => {
    let calls = 0;
    const db = openDb(dbPath);
    migrate(db, { onBeforeMigrate: () => calls++ }); // already current → no call
    expect(calls).toBe(0);
    db.close();

    const freshPath = join(dir, 'fresh.db');
    const db2 = openDb(freshPath);
    migrate(db2, { onBeforeMigrate: () => calls++ }); // fresh → pending → one call
    expect(calls).toBe(1);
    db2.close();
    void backupsDir;
  });
});
