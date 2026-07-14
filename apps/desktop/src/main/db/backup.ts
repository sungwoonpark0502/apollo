import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * H2 backups + integrity. Backups live in userData/backups/ as
 * apollo-{iso}-{reason}.db; retention keeps the newest 5 per reason class.
 */
export type BackupReason = 'pre-migrate' | 'auto' | 'manual';
const KEEP_PER_REASON = 5;

export interface BackupInfo {
  filename: string;
  reason: BackupReason;
  sizeBytes: number;
  createdAt: number;
}

function isoStamp(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, '-');
}

function parseReason(filename: string): BackupReason | null {
  const m = filename.match(/^apollo-.+-(pre-migrate|auto|manual)\.db$/);
  return m ? (m[1] as BackupReason) : null;
}

export function backupsDir(userData: string): string {
  return join(userData, 'backups');
}

/** VACUUM INTO (WAL-safe) with a checkpoint+copy fallback. Returns the backup path. */
export function createBackup(dbPath: string, userData: string, reason: BackupReason, at: number = Date.now()): string {
  const dir = backupsDir(userData);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `apollo-${isoStamp(at)}-${reason}.db`);
  try {
    const db = new Database(dbPath, { readonly: false });
    try {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  } catch {
    // Fallback: checkpoint then plain file copy.
    try {
      const db = new Database(dbPath);
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        db.close();
      }
    } catch {
      /* checkpoint best-effort */
    }
    copyFileSync(dbPath, dest);
  }
  pruneBackups(userData, reason);
  return dest;
}

/** Keep only the newest KEEP_PER_REASON backups of a reason class. */
export function pruneBackups(userData: string, reason: BackupReason): void {
  const dir = backupsDir(userData);
  if (!existsSync(dir)) return;
  const mine = listBackups(userData).filter((b) => b.reason === reason);
  for (const old of mine.slice(KEEP_PER_REASON)) {
    try {
      unlinkSync(join(dir, old.filename));
    } catch {
      /* best effort */
    }
  }
}

/** Newest first across all reason classes. */
export function listBackups(userData: string): BackupInfo[] {
  const dir = backupsDir(userData);
  if (!existsSync(dir)) return [];
  const out: BackupInfo[] = [];
  for (const filename of readdirSync(dir)) {
    const reason = parseReason(filename);
    if (!reason) continue;
    try {
      const st = statSync(join(dir, filename));
      out.push({ filename, reason, sizeBytes: st.size, createdAt: st.mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** PRAGMA quick_check; true when the database is structurally sound. */
export function quickCheck(dbPath: string): boolean {
  if (!existsSync(dbPath)) return true; // fresh install: nothing to check
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const r = db.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
      return r?.quick_check === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false; // unopenable → treat as corrupt
  }
}

export interface RecoveryResult {
  recovered: 'restored-backup' | 'started-fresh' | 'ok';
  corruptPath?: string;
  restoredFrom?: string;
}

/**
 * H2 boot integrity: if the DB fails quick_check, move it aside and restore the
 * newest backup (or start fresh). Returns what happened for the DB_CORRUPT dialog.
 */
export function recoverIfCorrupt(dbPath: string, userData: string, at: number = Date.now()): RecoveryResult {
  if (quickCheck(dbPath)) return { recovered: 'ok' };
  const corruptPath = join(userData, `apollo-corrupt-${isoStamp(at)}.db`);
  try {
    renameSync(dbPath, corruptPath);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) {
        try {
          renameSync(dbPath + suffix, corruptPath + suffix);
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    // if rename fails, delete so a fresh DB can be created
    try {
      unlinkSync(dbPath);
    } catch {
      /* best effort */
    }
  }
  const backups = listBackups(userData);
  const newest = backups[0];
  if (newest) {
    copyFileSync(join(backupsDir(userData), newest.filename), dbPath);
    // only accept the restore if it itself passes the check
    if (quickCheck(dbPath)) return { recovered: 'restored-backup', corruptPath, restoredFrom: newest.filename };
    try {
      unlinkSync(dbPath);
    } catch {
      /* best effort */
    }
  }
  return { recovered: 'started-fresh', corruptPath };
}
