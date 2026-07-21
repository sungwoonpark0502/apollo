import React, { useEffect, useMemo, useRef, useState } from 'react';
import { settingsTabsFor, STRINGS } from '@apollo/shared';
import { KeysTab } from './KeysTab';
import { AccountTab } from './AccountTab';
import { PrivacyTab } from './PrivacyTab';
import { GeneralTab } from './GeneralTab';
import { AboutTab } from './AboutTab';
import { CapabilitiesTab } from './CapabilitiesTab';
import { TimeFocusTab } from './TimeFocusTab';
import { CustomizeTab } from './CustomizeTab';
import { Icon } from '../../components/Icon';
import { searchSettings, type TabId } from './settingsIndex';
import { useFormatInit } from '../../lib/useLive';

/**
 * Settings, grouped by intent rather than by subsystem: General, Account,
 * Capabilities, Time and Focus, Customize, Privacy, About. The tab list comes
 * from the shared mode-aware helper so settings, readiness, and their tests can
 * never drift, and Diagnostics stays inside About because it is for us.
 *
 * The search box matches individual settings, not just section names — see
 * settingsIndex.ts.
 */
export function SettingsApp(): React.JSX.Element {
  useFormatInit();
  const [mode, setMode] = useState<'managed' | 'byok'>('managed');
  const [showKeys, setShowKeys] = useState(false);
  const [tab, setTab] = useState<TabId>('general');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.apollo.call('app.mode', {}).then(({ mode: m, showKeys: sk }) => {
      setMode(m);
      setShowKeys(sk);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const tabs = settingsTabsFor(mode, { showKeys }) as TabId[];
  const results = useMemo(() => searchSettings(query).filter((r) => tabs.includes(r.tab)), [query, tabs]);
  const searching = query.trim().length > 0;

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      <nav style={{ width: 190, flexShrink: 0, borderRight: '1px solid var(--border)', padding: 'var(--sp-4) var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
        <div style={{ position: 'relative', marginBottom: 'var(--sp-2)' }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', display: 'flex', pointerEvents: 'none' }}>
            <Icon name="search" size={14} />
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'Enter' && results[0]) {
                setTab(results[0].tab);
                setQuery('');
              }
            }}
            placeholder={STRINGS.settings.search.placeholder}
            aria-label={STRINGS.settings.search.placeholder}
            style={{
              width: '100%',
              padding: 'var(--sp-1) var(--sp-2) var(--sp-1) 26px',
              borderRadius: 'var(--radius-ctl)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-1)',
              fontSize: 'var(--fs-body)',
              fontFamily: 'var(--font-sans)',
            }}
          />
        </div>

        {searching ? (
          <div role="listbox" aria-label={STRINGS.settings.search.resultsLabel}>
            {results.length === 0 ? (
              <div style={{ padding: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
                {STRINGS.settings.search.noResults(query.trim())}
              </div>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setTab(r.tab);
                    setQuery('');
                  }}
                  style={resultStyle}
                >
                  <span style={{ display: 'block', color: 'var(--text-1)' }}>{r.label}</span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
                    {STRINGS.settings.tabs[r.tab]}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : (
          tabs.map((id) => (
            <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}>
              {STRINGS.settings.tabs[id]}
            </button>
          ))
        )}
      </nav>

      <main style={{ flex: 1, padding: 'var(--sp-5)', overflowY: 'auto' }}>
        {tab === 'general' ? (
          <GeneralTab />
        ) : tab === 'account' ? (
          <AccountTab mode={mode} />
        ) : tab === 'capabilities' ? (
          <CapabilitiesTab />
        ) : tab === 'timeFocus' ? (
          <TimeFocusTab />
        ) : tab === 'customize' ? (
          <CustomizeTab />
        ) : tab === 'privacy' ? (
          <PrivacyTab />
        ) : tab === 'keys' ? (
          <KeysTab />
        ) : (
          <AboutTab />
        )}
      </main>
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: 'var(--sp-2) var(--sp-3)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--fs-body)',
    color: active ? 'var(--text-1)' : 'var(--text-2)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-ctl)',
    cursor: 'pointer',
  };
}

const resultStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 'var(--sp-2) var(--sp-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-ctl)',
  cursor: 'pointer',
};
