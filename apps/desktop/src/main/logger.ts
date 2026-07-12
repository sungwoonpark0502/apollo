import pino, { type Logger } from 'pino';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** C20/C14.2: pino with secret redaction, 5MB rotation, 3 files kept. */
export const REDACT_PATHS = [
  '*.apiKey',
  '*.api_key',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.authorization',
  'apiKey',
  'api_key',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'email.body',
  'email.safeHtml',
];

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

export function rotateIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath) || statSync(logPath).size < MAX_BYTES) return;
    const oldest = `${logPath}.${KEEP - 1}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = KEEP - 2; i >= 1; i--) {
      if (existsSync(`${logPath}.${i}`)) renameSync(`${logPath}.${i}`, `${logPath}.${i + 1}`);
    }
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // rotation is best-effort; never block boot on it
  }
}

export interface LoggerOpts {
  logDir: string;
  dev: boolean;
}

export function createLogger(opts: LoggerOpts): Logger {
  mkdirSync(opts.logDir, { recursive: true });
  const logPath = join(opts.logDir, 'apollo.log');
  rotateIfNeeded(logPath);
  return pino(
    {
      level: opts.dev ? 'debug' : 'info',
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      base: undefined,
    },
    pino.destination({ dest: logPath, sync: false, mkdir: true }),
  );
}

/** Test hook: same redaction config, custom destination. */
export function createLoggerTo(stream: NodeJS.WritableStream): Logger {
  return pino({ level: 'debug', redact: { paths: REDACT_PATHS, censor: '[Redacted]' }, base: undefined }, stream);
}

export function logPathFor(logDir: string): string {
  return join(logDir, 'apollo.log');
}

/** Diagnostics tab: last N lines of the log (redaction already applied at write time). */
export function readLogTail(logPath: string, lines: number): string[] {
  try {
    const text = readFileSync(logPath, 'utf8');
    return text.split('\n').filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

export function ensureDirFor(p: string): void {
  mkdirSync(dirname(p), { recursive: true });
}
