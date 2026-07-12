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

export function toErrorCode(err: unknown): ErrorCode {
  return err instanceof AppError ? err.code : 'INTERNAL';
}
