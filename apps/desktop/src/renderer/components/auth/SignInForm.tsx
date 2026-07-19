import React, { useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { buttonStyle } from '../cards/TimerCard';
import { canSubmit, EMPTY_FORM, errorMessage, forSubmit, validate, type FormMode, type FormValues } from './signInModel';

/**
 * L1.4 sign-in, rendered in Apollo's own UI. Not a browser window and not an
 * embedded web view: a native form whose values go to main over IPC and from
 * there to the Apollo backend over TLS. The password lives in this component's
 * state for the duration of the keystroke-to-submit window and nowhere else —
 * it is never written to settings, never logged, and never sent to any host
 * but the backend.
 */
export function SignInForm({ busy }: { busy: boolean }): React.JSX.Element {
  const a = STRINGS.settings.account;
  const [mode, setMode] = useState<FormMode>('signIn');
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const errors = validate(values, mode);
  const submittable = canSubmit(values, mode, busy);

  const set = (patch: Partial<FormValues>): void => {
    setValues((v) => ({ ...v, ...patch }));
    setFailure(null); // a new keystroke clears the last rejection
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!submittable) {
      setTouched({ email: true, password: true });
      return;
    }
    const { email, password, name } = forSubmit(values);
    const call =
      mode === 'signUp'
        ? window.apollo.call('auth.signUpWithPassword', { email, password, ...(name ? { name } : {}) })
        : window.apollo.call('auth.signInWithPassword', { email, password });
    void call.then((res) => {
      if (res.ok) {
        // Drop the credential from memory as soon as it is no longer needed.
        setValues(EMPTY_FORM);
        return;
      }
      setFailure(errorMessage(res.error));
    });
  };

  const switchMode = (): void => {
    setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
    setFailure(null);
    setTouched({});
  };

  const showError = (field: 'email' | 'password'): string | null =>
    touched[field] && errors[field] ? (errors[field] as string) : null;

  return (
    <form onSubmit={submit} noValidate>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body)', marginBottom: 'var(--sp-4)' }}>
        {mode === 'signUp' ? a.signUpBody : a.signInBody}
      </p>

      {mode === 'signUp' ? (
        <Field label={a.nameLabel}>
          <input
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={a.namePlaceholder}
            autoComplete="name"
            style={inputStyle}
          />
        </Field>
      ) : null}

      <Field label={a.emailLabel} error={showError('email')}>
        <input
          type="email"
          value={values.email}
          onChange={(e) => set({ email: e.target.value })}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          placeholder={a.emailPlaceholder}
          autoComplete="username"
          autoFocus
          style={{ ...inputStyle, ...(showError('email') ? errorBorder : {}) }}
        />
      </Field>

      <Field label={a.passwordLabel} error={showError('password')}>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          <input
            type={reveal ? 'text' : 'password'}
            value={values.password}
            onChange={(e) => set({ password: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            placeholder={a.passwordPlaceholder}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            style={{ ...inputStyle, flex: 1, ...(showError('password') ? errorBorder : {}) }}
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-pressed={reveal}
            style={{ ...buttonStyle, whiteSpace: 'nowrap' }}
          >
            {reveal ? a.hidePassword : a.showPassword}
          </button>
        </div>
        {mode === 'signUp' && !showError('password') ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-1)' }}>{a.passwordHint}</div>
        ) : null}
      </Field>

      {failure ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-caption)', marginBottom: 'var(--sp-3)' }}>
          {failure}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <button
          type="submit"
          disabled={!submittable}
          style={{
            ...buttonStyle,
            background: 'var(--accent)',
            color: '#fff',
            borderColor: 'var(--accent)',
            opacity: submittable ? 1 : 0.6,
            cursor: submittable ? 'pointer' : 'default',
          }}
        >
          {busy ? (mode === 'signUp' ? a.creatingAccount : a.signingIn) : mode === 'signUp' ? a.createAccount : a.signIn}
        </button>
        <button type="button" onClick={switchMode} style={linkButton}>
          {mode === 'signUp' ? a.haveAccount : a.needAccount}
        </button>
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }): React.JSX.Element {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--sp-3)' }}>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>{label}</div>
      {children}
      {error ? (
        <div role="alert" style={{ fontSize: 'var(--fs-caption)', color: 'var(--danger)', marginTop: 'var(--sp-1)' }}>
          {error}
        </div>
      ) : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--sp-2)',
  borderRadius: 'var(--radius-ctl)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
  fontSize: 'var(--fs-body)',
  fontFamily: 'var(--font-sans)',
};

const errorBorder: React.CSSProperties = { borderColor: 'var(--danger)' };

const linkButton: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 'var(--fs-caption)',
  fontFamily: 'var(--font-sans)',
  padding: 0,
};
