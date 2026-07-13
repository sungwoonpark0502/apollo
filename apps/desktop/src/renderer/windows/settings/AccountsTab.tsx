import React, { useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { buttonStyle } from '../../components/cards/TimerCard';

export function AccountsTab(): React.JSX.Element {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = (): void => {
    setBusy(true);
    void window.apollo
      .call('oauth.google.start', {})
      .then((r) => {
        if (r.ok && r.address) setAddress(r.address);
      })
      .finally(() => setBusy(false));
  };

  const disconnect = (): void => {
    void window.apollo.call('oauth.google.revoke', {}).then(() => setAddress(null));
  };

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.accounts}</h2>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{STRINGS.settings.accounts.gmail}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
            {address ? STRINGS.settings.accounts.connectedAs(address) : 'Not connected'}
          </div>
        </div>
        {address ? (
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
