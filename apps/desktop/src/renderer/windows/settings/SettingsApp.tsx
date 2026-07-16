import React, { useState } from 'react';
import { STRINGS, type KeyProvider } from '@apollo/shared';
import { KeysTab } from './KeysTab';
import { VoiceTab } from './VoiceTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { AccountsTab } from './AccountsTab';
import { PrivacyTab } from './PrivacyTab';
import { GeneralTab } from './GeneralTab';
import { ProfileTab } from './ProfileTab';
import { AboutTab } from './AboutTab';
import { ProactiveTab } from './ProactiveTab';
import { useFormatInit } from '../../lib/useLive';

type TabId = keyof typeof STRINGS.settings.tabs;
const TAB_ORDER: TabId[] = ['profile', 'general', 'voice', 'proactive', 'accounts', 'keys', 'privacy', 'diagnostics', 'about'];

export function SettingsApp(): React.JSX.Element {
  useFormatInit();
  const [tab, setTab] = useState<TabId>('profile');

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      <nav style={{ width: 160, borderRight: '1px solid var(--border)', padding: 'var(--sp-4) var(--sp-2)' }}>
        {TAB_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: 'var(--sp-2) var(--sp-3)',
              marginBottom: 'var(--sp-1)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-body)',
              color: tab === id ? 'var(--text-1)' : 'var(--text-2)',
              background: tab === id ? 'var(--accent-soft)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-ctl)',
              cursor: 'pointer',
            }}
          >
            {STRINGS.settings.tabs[id]}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 'var(--sp-5)', overflowY: 'auto' }}>
        {tab === 'profile' ? (
          <ProfileTab />
        ) : tab === 'about' ? (
          <AboutTab />
        ) : tab === 'proactive' ? (
          <ProactiveTab />
        ) : tab === 'keys' ? (
          <KeysTab />
        ) : tab === 'voice' ? (
          <VoiceTab />
        ) : tab === 'diagnostics' ? (
          <DiagnosticsTab />
        ) : tab === 'accounts' ? (
          <AccountsTab />
        ) : tab === 'privacy' ? (
          <PrivacyTab />
        ) : tab === 'general' ? (
          <GeneralTab />
        ) : (
          <Placeholder tab={STRINGS.settings.tabs[tab]} />
        )}
      </main>
    </div>
  );
}

function Placeholder({ tab }: { tab: string }): React.JSX.Element {
  return <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)' }}>{tab} settings arrive in a later milestone.</div>;
}

export type { KeyProvider };
