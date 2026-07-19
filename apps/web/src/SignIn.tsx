import React, { useState } from 'react';
import { login, signup, type AuthResult } from './api';

/**
 * Web sign-in: the same native email/password form as the desktop's Settings →
 * Account, posting to the same backend routes, with the same property that the
 * copy never reveals whether an address is registered.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (user: { name: string; email: string; plan: string }) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setFailure(null);
    const call: Promise<AuthResult> =
      mode === 'signUp' ? signup(email.trim(), password, name.trim() || undefined) : login(email.trim(), password);
    void call.then((res) => {
      setBusy(false);
      if (res.ok) onSignedIn(res.user);
      else setFailure(MESSAGES[res.error] ?? MESSAGES['generic']!);
    });
  };

  return (
    <div style={{ display: 'grid', placeContent: 'center', height: '100%', padding: 'var(--sp-5)' }}>
      <form onSubmit={submit} style={{ width: 340, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 'var(--sp-5)', boxShadow: 'var(--shadow-card)' }}>
        <h1 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-1)' }}>Apollo</h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', margin: '0 0 var(--sp-4)' }}>
          {mode === 'signUp' ? 'Create an account to chat from any browser.' : 'Sign in to your Apollo account.'}
        </p>

        {mode === 'signUp' ? (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="name" style={field} />
        ) : null}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          autoFocus
          style={field}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          style={field}
        />
        {mode === 'signUp' ? (
          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', margin: '0 0 var(--sp-3)' }}>
            At least 10 characters. A few plain words beat one clever word.
          </p>
        ) : null}

        {failure ? (
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-caption)', marginBottom: 'var(--sp-3)' }}>
            {failure}
          </div>
        ) : null}

        <button type="submit" disabled={busy} style={{ ...primary, width: '100%', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Signing in…' : mode === 'signUp' ? 'Create account' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
            setFailure(null);
          }}
          style={link}
        >
          {mode === 'signUp' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}

const MESSAGES: Record<string, string> = {
  invalidCredentials: 'That email and password do not match.',
  emailTaken: 'That email cannot be used. Try signing in instead.',
  weakPassword: 'Use at least 10 characters.',
  tooManyAttempts: 'Too many attempts. Try again in 15 minutes.',
  network: 'Could not reach Apollo. Check your connection and try again.',
  malformed: 'Sign-in failed. Try again.',
  generic: 'Sign-in failed. Try again.',
};

const field: React.CSSProperties = {
  width: '100%', padding: 'var(--sp-2) var(--sp-3)', marginBottom: 'var(--sp-3)',
  borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};

const primary: React.CSSProperties = {
  border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};

const link: React.CSSProperties = {
  display: 'block', margin: 'var(--sp-3) auto 0', border: 'none', background: 'transparent',
  color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
