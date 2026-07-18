import { z } from 'zod';

export const ERROR_CODES = [
  'KEY_MISSING',
  'KEY_INVALID',
  'RATE_LIMITED',
  'OFFLINE',
  'STT_DOWN',
  'TTS_DOWN',
  'LLM_DOWN',
  'TOOL_FAIL',
  'TIMEOUT',
  'CANCELED',
  'INTERNAL',
  'THROTTLED',
  'REAUTH_NEEDED',
  'DB_CORRUPT',
  'DISK_FULL',
  // L1/L0.1 managed mode: signed-out and quota states get their own friendly
  // copy — never a keys request, never a raw provider error.
  'AUTH_REQUIRED',
  'QUOTA_EXCEEDED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

/** Internal error carrying a user-mappable code. Raw messages never reach the user (C16). */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public override readonly cause?: unknown,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

/** J3: SQLite write failures that mean "the disk can't accept this write". */
const DISK_FULL_SQLITE_CODES = new Set(['SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_IOERR_WRITE', 'SQLITE_READONLY_DBMOVED']);

/** True when a raw error looks like a disk-full / write-failure from better-sqlite3. */
export function isDiskFullError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DISK_FULL_SQLITE_CODES.has(code);
}

export function toErrorCode(err: unknown): ErrorCode {
  if (err instanceof AppError) return err.code;
  if (isDiskFullError(err)) return 'DISK_FULL'; // never a silent loss / raw crash (J3)
  return 'INTERNAL';
}
