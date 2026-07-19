import React, { useEffect, useState } from 'react';
import { fmtDate, fmtNumber, STRINGS, type AuthStatus } from '@apollo/shared';
import { buttonStyle } from '../../components/cards/TimerCard';

interface AuthUser {
  name: string;
  email: string;
  plan: string;
}

/**
 * L5 Account tab (managed mode only, first in the list): who is signed in,
 * usage this period with its reset date, plan management, and sign out.
 * Tokens never reach the renderer — this reads status/profile/usage only.
 */
export function AccountTab({ mode }: { mode: 'managed' | 'byok' }): React.JSX.Element {
  const a = STRINGS.settings.account;
  const [status, setStatus] = useState<AuthStatus>('signedOut');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number; resetIso: string } | null>(null);

  useEffect(() => {
    const off = window.apollo.on('auth.state', (s) => {
      setStatus(s.status);
      setUser(s.user ?? null);
    });
    return off;
  }, []);

  // Clear stale usage on a status change during render (no cascading effect),
  // then fetch fresh usage only while signed in.
  const [lastStatus, setLastStatus] = useState<AuthStatus>(status);
  if (lastStatus !== status) {
    setLastStatus(status);
    if (status !== 'signedIn') setUsage(null);
  }

  useEffect(() => {
    if (status !== 'signedIn') return;
    void window.apollo.call('auth.usage', {}).then(setUsage);
  }, [status]);

  if (mode === 'byok') {
    return (
      <div>
        <h2 style={heading}>{a.title}</h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body)' }}>{a.byokNotice}</p>
      </div>
    );
  }

  if (status !== 'signedIn') {
    return (
      <div>
        <h2 style={heading}>{a.title}</h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body)', marginBottom: 'var(--sp-4)' }}>{a.signInBody}</p>
        <button
          onClick={() => void window.apollo.call('auth.signIn', {})}
          disabled={status === 'signingIn'}
          style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}
        >
          {status === 'signingIn' ? a.signingIn : a.signIn}
        </button>
      </div>
    );
  }

  const overLimit = usage !== null && usage.limit > 0 && usage.used >= usage.limit;
  const nearLimit = usage !== null && usage.limit > 0 && !overLimit && usage.used / usage.limit >= 0.8;

  return (
    <div>
      <h2 style={heading}>{a.title}</h2>
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{user?.name}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{a.signedInAs(user?.email ?? '')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{a.plan(user?.plan ?? '')}</div>
      </div>

      {usage && usage.limit > 0 ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>
            {a.usage(Number(fmtNumber(usage.used)), Number(fmtNumber(usage.limit)))}
          </div>
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', margin: 'var(--sp-1) 0' }}>
            <div
              style={{
                width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                height: '100%',
                background: overLimit ? 'var(--danger)' : 'var(--accent)',
              }}
            />
          </div>
          {usage.resetIso ? (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
              {a.usageResets(fmtDate(Date.parse(usage.resetIso), 'date'))}
            </div>
          ) : null}
          {overLimit ? <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--danger)' }}>{a.overLimit}</div> : null}
          {nearLimit ? <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{a.nearLimit}</div> : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        <button onClick={() => void window.apollo.call('auth.signOut', {})} style={buttonStyle}>
          {a.signOut}
        </button>
      </div>
    </div>
  );
}

const heading: React.CSSProperties = { fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' };
