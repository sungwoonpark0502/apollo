import { describe, expect, it } from 'vitest';
import { hashPassword, normalizeEmail, validatePassword, verifyPassword } from './password';

describe('L1.4 password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const rec = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', rec)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', rec)).toBe(false);
    expect(await verifyPassword('', rec)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same password here'), hashPassword('same password here')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password here', a)).toBe(true);
    expect(await verifyPassword('same password here', b)).toBe(true);
  });

  it('records its parameters, so they can be raised without breaking old hashes', async () => {
    const rec = await hashPassword('a password value');
    const [algo, n, r, p] = rec.split('$');
    expect(algo).toBe('scrypt');
    expect(Number(n)).toBe(32768);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('never stores the password itself', async () => {
    const rec = await hashPassword('literal-secret-value');
    expect(rec).not.toContain('literal-secret-value');
  });

  it('normalizes unicode, so the same typed password verifies across input methods', async () => {
    // "é" as one code point vs "e" + combining accent.
    const composed = 'café password';
    const decomposed = 'café password';
    const rec = await hashPassword(composed);
    expect(await verifyPassword(decomposed, rec)).toBe(true);
  });

  it('treats a malformed or corrupt record as a failed verification, not an error', async () => {
    for (const bad of ['', 'garbage', 'scrypt$x$8$1$c2FsdA==$aGFzaA==', 'scrypt$32768$8$1', 'bcrypt$1$2$3$4$5', 'scrypt$32768$8$1$$']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('accepts long passphrases', async () => {
    const long = 'a fairly long passphrase that a person might actually choose to use';
    expect(await verifyPassword(long, await hashPassword(long))).toBe(true);
  });
});

describe('L1.4 password policy', () => {
  it('requires length over character classes', () => {
    expect(validatePassword('Ab1!efg').ok).toBe(false); // 7 chars, "complex"
    expect(validatePassword('several plain words').ok).toBe(true);
  });

  it('rejects the passwords that lead every stuffing list', () => {
    for (const p of ['password123', 'PASSWORD123', '1234567890', 'apollo123']) {
      expect(validatePassword(p).ok).toBe(false);
    }
  });

  it('rejects an absurdly long password rather than paying to hash it', () => {
    expect(validatePassword('x'.repeat(201)).ok).toBe(false);
  });

  it('gives a reason a person can act on', () => {
    const r = validatePassword('short');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/10 characters/);
  });
});

describe('L1.4 email normalization', () => {
  it('lowercases and trims so one address is one account', () => {
    expect(normalizeEmail('  James@Example.COM ')).toBe('james@example.com');
  });
});
