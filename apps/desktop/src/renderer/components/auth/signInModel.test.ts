import { describe, expect, it } from 'vitest';
import { canSubmit, EMPTY_FORM, errorMessage, forSubmit, validate, type FormValues } from './signInModel';

const filled: FormValues = { email: 'sam@example.com', password: 'a good long password', name: 'Sam' };

describe('L1.4 sign-in form validation', () => {
  it('accepts a well-formed submission in both modes', () => {
    expect(validate(filled, 'signIn')).toEqual({});
    expect(validate(filled, 'signUp')).toEqual({});
  });

  it('rejects malformed emails', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@example.com', '@example.com']) {
      expect(validate({ ...filled, email }, 'signIn').email).toBeTruthy();
    }
  });

  it('requires a password in both modes', () => {
    expect(validate({ ...filled, password: '' }, 'signIn').password).toBeTruthy();
    expect(validate({ ...filled, password: '' }, 'signUp').password).toBeTruthy();
  });

  it('applies the length floor only when creating an account', () => {
    // An existing account may predate the rule; enforcing it at sign-in would
    // lock those users out of their own data.
    const short = { ...filled, password: 'short' };
    expect(validate(short, 'signIn').password).toBeUndefined();
    expect(validate(short, 'signUp').password).toBeTruthy();
  });

  it('tolerates surrounding whitespace on the email', () => {
    expect(validate({ ...filled, email: '  sam@example.com  ' }, 'signIn')).toEqual({});
  });
});

describe('L1.4 submit gating', () => {
  it('blocks an empty form and unblocks a valid one', () => {
    expect(canSubmit(EMPTY_FORM, 'signIn', false)).toBe(false);
    expect(canSubmit(filled, 'signIn', false)).toBe(true);
  });

  it('blocks while a request is in flight, so one Enter cannot fire twice', () => {
    expect(canSubmit(filled, 'signIn', true)).toBe(false);
  });
});

describe('L1.4 submission shaping', () => {
  it('trims the email and the name but never the password', () => {
    const out = forSubmit({ email: '  Sam@Example.com ', password: '  pad  ded  ', name: '  Sam  ' });
    expect(out.email).toBe('Sam@Example.com');
    expect(out.name).toBe('Sam');
    // Leading/trailing spaces are legitimate password characters; trimming them
    // would silently change what the user typed and break their login.
    expect(out.password).toBe('  pad  ded  ');
  });
});

describe('L1.4 error copy', () => {
  it('maps each known code to specific copy', () => {
    const codes = ['invalidCredentials', 'emailTaken', 'weakPassword', 'tooManyAttempts', 'network', 'busy'];
    const messages = codes.map(errorMessage);
    expect(new Set(messages).size).toBe(codes.length); // all distinct
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });

  it('falls back to generic copy rather than leaking a raw code', () => {
    const msg = errorMessage('some_unmapped_backend_code');
    expect(msg).not.toContain('some_unmapped_backend_code');
    expect(msg).toBe(errorMessage(undefined));
  });

  it('never tells the user whether the account exists', () => {
    // Mirrors the backend property: wrong password and unknown account are one
    // message. Copy that said "no such account" would undo it client-side.
    const msg = errorMessage('invalidCredentials').toLowerCase();
    expect(msg).not.toMatch(/no such|not found|does not exist|unregistered/);
  });
});
