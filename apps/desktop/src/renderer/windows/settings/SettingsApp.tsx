import React, { useEffect, useState } from 'react';
import { settingsTabsFor, STRINGS, type KeyProvider } from '@apollo/shared';
import { KeysTab } from './KeysTab';
import { VoiceTab } from './VoiceTab';
import { AccountTab } from './AccountTab';
import { AccountsTab } from './AccountsTab';
import { PrivacyTab } from './PrivacyTab';
import { GeneralTab } from './GeneralTab';
import { CalendarsTab } from './CalendarsTab';
import { ProfileTab } from './ProfileTab';
import { AboutTab } from './AboutTab';
import { ProactiveTab } from './ProactiveTab';
import { useFormatInit } from '../../lib/useLive';

type TabId = keyof typeof STRINGS.settings.tabs;

/**
 * L5: a normal (managed) user sees only what they need — Account first, no Keys
 * tab, no top-level Diagnostics (it lives under About). BYOK builds swap
 * Account for Keys. The tab list comes from the shared mode-aware helper so
 * settings, readiness, and its tests can never drift.
 */
export function SettingsApp(): React.JSX.Element {
  useFormatInit();
  const [mode, setMode] = useState<'managed' | 'byok'>('managed');
  const [tab, setTab] = useState<TabId>('account');

  useEffect(() => {
    void window.apollo.call('app.mode', {}).then(({ mode: m }) => {
      setMode(m);
      setTab(m === 'managed' ? 'account' : 'profile');
    });
  }, []);

  const tabs = settingsTabsFor(mode) as TabId[];

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      <nav style={{ width: 160, borderRight: '1px solid var(--border)', padding: 'var(--sp-4) var(--sp-2)' }}>
        {tabs.map((id) => (
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
        {tab === 'account' ? (
          <AccountTab mode={mode} />
        ) : tab === 'profile' ? (
          <ProfileTab />
        ) : tab === 'about' ? (
          <AboutTab />
        ) : tab === 'assistant' ? (
          <ProactiveTab />
        ) : tab === 'keys' ? (
          <KeysTab />
        ) : tab === 'voice' ? (
          <VoiceTab />
        ) : tab === 'accounts' ? (
          <AccountsTab />
        ) : tab === 'privacy' ? (
          <PrivacyTab />
        ) : tab === 'general' ? (
          <GeneralTab />
        ) : (
          <CalendarsTab />
        )}
      </main>
    </div>
  );
}

export type { KeyProvider };
