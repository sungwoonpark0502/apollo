import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** promisify's overload resolution drops the options argument, so wrap by hand. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * L1.4 password hashing for the in-app sign-in form.
 *
 * scrypt from the Node standard library rather than an argon2 native addon:
 * this backend already avoids native deps so it builds anywhere, and scrypt
 * with these parameters is a memory-hard KDF in the same family. N=2^15 with
 * r=8 costs ~32MB and ~100ms per verification, which is deliberate — it is the
 * cost an attacker pays per guess against a stolen hash.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<hash-b64>, self-describing so the
 * parameters can be raised later without invalidating existing hashes.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/** scrypt's memory cost is derived from N and r; give it room to run. */
const MAX_MEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time verification. Returns false for a malformed record rather than
 * throwing, so a corrupt row reads as "wrong password" instead of a 500 that
 * tells an attacker the account exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, 'base64');
    expected = Buffer.from(parts[5] as string, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: MAX_MEM });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Minimum viable password policy. Length dominates every other rule for
 * offline-guessing resistance, so this checks length and rejects the handful of
 * passwords that show up first in any credential-stuffing list, rather than
 * imposing character-class rules that push users toward "Password1!".
 */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'iloveyou', 'admin123', 'letmein1', 'welcome1', 'apollo123',
]);

export function validatePassword(password: string): { ok: true } | { ok: false; reason: string } {
  if (password.length < 10) return { ok: false, reason: 'Use at least 10 characters.' };
  if (password.length > 200) return { ok: false, reason: 'Use at most 200 characters.' };
  if (COMMON.has(password.toLowerCase())) return { ok: false, reason: 'That password is too common.' };
  return { ok: true };
}

/** Emails are compared case-insensitively; store one canonical form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
