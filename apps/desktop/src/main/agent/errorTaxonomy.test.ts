import { describe, expect, it } from 'vitest';
import { ERROR_CODES, STRINGS, type ErrorCode } from '@apollo/shared';
import { errorCopy } from './orchestrator';

/**
 * J6.3 error-taxonomy coverage. Every ErrorCode must map to user-facing copy;
 * no code path may surface an empty or raw-provider message. CANCELED is the one
 * intentional empty (a user cancel needs no apology).
 */
describe('J6.3 error taxonomy coverage', () => {
  it('every ErrorCode resolves to non-empty user copy via errorCopy (except CANCELED)', () => {
    for (const code of ERROR_CODES) {
      const copy = errorCopy(code);
      if (code === 'CANCELED') {
        expect(copy).toBe('');
        continue;
      }
      expect(copy, code).toBeTruthy();
      expect(copy.length, code).toBeGreaterThan(3);
      // never leak a raw error token / object to the user
      expect(copy).not.toMatch(/SQLITE_|\bundefined\b|\[object|Error:/);
    }
  });

  it('STRINGS.errors has copy for every non-parameterized error code', () => {
    const stringErrors = STRINGS.errors as Record<string, unknown>;
    // Codes with fixed (non-function) copy must be present and non-empty (except CANCELED).
    const fixedCopyCodes: ErrorCode[] = ['RATE_LIMITED', 'STT_DOWN', 'TTS_DOWN', 'LLM_DOWN', 'TIMEOUT', 'INTERNAL', 'THROTTLED', 'REAUTH_NEEDED', 'DB_CORRUPT', 'DISK_FULL'];
    for (const code of fixedCopyCodes) {
      expect(typeof stringErrors[code], code).toBe('string');
      expect((stringErrors[code] as string).length, code).toBeGreaterThan(3);
    }
  });

  it('the ErrorCode set is exhaustively handled (no unmapped fallthrough to a blank)', () => {
    // If a new code is added without copy, errorCopy falls back to INTERNAL (non-empty),
    // so assert INTERNAL itself is meaningful — the safety net can never be blank.
    expect(errorCopy('INTERNAL')).toBeTruthy();
    expect(ERROR_CODES).toContain('DISK_FULL'); // the J3 addition is wired in
  });
});
