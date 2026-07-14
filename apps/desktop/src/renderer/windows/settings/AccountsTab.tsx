import React, { useEffect, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { buttonStyle } from '../../components/cards/TimerCard';

export function AccountsTab(): React.JSX.Element {
  const [address, setAddress] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = (): void => {
    void window.apollo.call('oauth.google.status', {}).then((s) => {
      setAddress(s.connected ? s.address : null);
      setNeedsReauth(s.needsReauth);
    });
  };
  useEffect(refresh, []);

  const connect = (): void => {
    setBusy(true);
    void window.apollo
      .call('oauth.google.start', {})
      .then((r) => {
        if (r.ok && r.address) setAddress(r.address);
        setNeedsReauth(false);
      })
      .finally(() => setBusy(false));
  };

  const disconnect = (): void => {
    void window.apollo.call('oauth.google.revoke', {}).then(() => {
      setAddress(null);
      setNeedsReauth(false);
    });
  };

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.accounts}</h2>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)', display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            {STRINGS.settings.accounts.gmail}
            {needsReauth ? (
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-ctl)', padding: '0 var(--sp-2)' }}>
                {STRINGS.settings.accounts.reauthBadge}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
            {address ? STRINGS.settings.accounts.connectedAs(address) : 'Not connected'}
          </div>
        </div>
        {needsReauth ? (
          <button onClick={connect} disabled={busy} style={buttonStyle}>
            {busy ? '…' : STRINGS.settings.accounts.reconnect}
          </button>
        ) : address ? (
          <button onClick={disconnect} style={buttonStyle}>
            {STRINGS.settings.accounts.disconnect}
          </button>
        ) : (
          <button onClick={connect} disabled={busy} style={buttonStyle}>
            {busy ? '…' : STRINGS.settings.accounts.connect}
          </button>
        )}
      </div>
    </div>
  );
}
