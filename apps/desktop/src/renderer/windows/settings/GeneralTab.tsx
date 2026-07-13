import React, { useEffect, useState } from 'react';
import { STRINGS, orbEdgeSchema, type Settings } from '@apollo/shared';

const EDGES = orbEdgeSchema.options;

export function GeneralTab(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then(setSettings);
  }, []);

  const patch = (next: Settings): void => {
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };

  if (!settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.general}</h2>

      <Row label={STRINGS.settings.general.launchAtLogin}>
        <input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => patch({ ...settings, launchAtLogin: e.target.checked })} />
      </Row>

      <Row label={STRINGS.settings.general.hotkey}>
        <input
          value={settings.hotkey}
          onChange={(e) => patch({ ...settings, hotkey: e.target.value })}
          style={{ ...inputStyle, width: 160 }}
          aria-label={STRINGS.settings.general.hotkey}
        />
      </Row>

      <Row label={STRINGS.settings.general.orbEdge}>
        <select
          value={settings.orb.edge}
          onChange={(e) => patch({ ...settings, orb: { ...settings.orb, edge: e.target.value as Settings['orb']['edge'] } })}
          style={{ ...inputStyle, width: 160 }}
        >
          {EDGES.map((edge) => (
            <option key={edge} value={edge}>
              {edge}
            </option>
          ))}
        </select>
      </Row>

      <Row label={STRINGS.settings.general.homeLocation}>
        <input
          value={settings.home?.name ?? ''}
          onChange={(e) => {
            const name = e.target.value;
            patch({ ...settings, home: name ? { name, lat: settings.home?.lat ?? 0, lon: settings.home?.lon ?? 0 } : null });
          }}
          placeholder="City name"
          style={{ ...inputStyle, width: 220 }}
        />
      </Row>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-2)' }}>
        Ask Apollo "set my home to Portland" to set exact coordinates automatically.
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{label}</span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  padding: 'var(--sp-1) var(--sp-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
};
