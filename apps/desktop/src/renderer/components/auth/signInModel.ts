import { STRINGS } from '@apollo/shared';

/**
 * L1.4 sign-in form logic, kept pure so it is testable without a DOM (the
 * renderer suite has no jsdom; models are tested, components stay thin).
 *
 * Client-side validation exists to give fast feedback, never as the check that
 * matters — the backend re-validates everything and is the only authority on
 * whether an account exists or a password is correct.
 */
export type FormMode = 'signIn' | 'signUp';

export interface FormValues {
  email: string;
  password: string;
  name: string;
}

export interface FieldErrors {
  email?: string;
  password?: string;
}

export const EMPTY_FORM: FormValues = { email: '', password: '', name: '' };

/** Same shape the backend accepts; deliberately permissive beyond that. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(values: FormValues, mode: FormMode): FieldErrors {
  const errors: FieldErrors = {};
  const a = STRINGS.settings.account;
  if (!EMAIL_RE.test(values.email.trim())) errors.email = a.errEmailInvalid;
  if (values.password.length === 0) errors.password = a.errPasswordRequired;
  // The length floor is only enforced when creating an account. Applying it at
  // sign-in would lock out anyone whose existing password predates the rule.
  else if (mode === 'signUp' && values.password.length < 10) errors.password = a.errPasswordShort;
  return errors;
}

export function canSubmit(values: FormValues, mode: FormMode, busy: boolean): boolean {
  return !busy && Object.keys(validate(values, mode)).length === 0;
}

/**
 * Maps a code from main to display copy. Unknown codes fall back to the generic
 * failure rather than surfacing a raw identifier.
 */
export function errorMessage(code: string | undefined): string {
  const a = STRINGS.settings.account;
  switch (code) {
    case 'invalidCredentials':
      return a.errInvalidCredentials;
    case 'emailTaken':
      return a.errEmailTaken;
    case 'weakPassword':
      return a.errPasswordShort;
    case 'tooManyAttempts':
      return a.errTooManyAttempts;
    case 'network':
      return a.errNetwork;
    case 'busy':
      return a.errBusy;
    default:
      return a.errGeneric;
  }
}

/** Trimmed values for submission; the password is never trimmed. */
export function forSubmit(values: FormValues): { email: string; password: string; name: string } {
  return { email: values.email.trim(), password: values.password, name: values.name.trim() };
}
