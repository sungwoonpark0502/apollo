import React, { useEffect, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';

export function VoiceTab(): React.JSX.Element {
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
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.voice}</h2>

      <Row label={STRINGS.settings.voice.wake}>
        <input
          type="checkbox"
          checked={settings.wake.enabled}
          onChange={(e) => patch({ ...settings, wake: { ...settings.wake, enabled: e.target.checked } })}
        />
      </Row>

      <Row label={STRINGS.settings.voice.sensitivity}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.wake.sensitivity}
          onChange={(e) => patch({ ...settings, wake: { ...settings.wake, sensitivity: Number(e.target.value) } })}
          style={{ width: 200 }}
        />
        <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>
          {settings.wake.sensitivity.toFixed(2)}
        </span>
      </Row>

      <Row label={STRINGS.settings.voice.ptt}>
        <input
          type="checkbox"
          checked={settings.ptt.enabled}
          onChange={(e) => patch({ ...settings, ptt: { enabled: e.target.checked } })}
        />
      </Row>

      <Row label={STRINGS.settings.voice.voice}>
        <input
          type="text"
          value={settings.tts.voice}
          onChange={(e) => patch({ ...settings, tts: { voice: e.target.value } })}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-body)',
            padding: 'var(--sp-1) var(--sp-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-ctl)',
            background: 'var(--surface)',
            color: 'var(--text-1)',
            width: 220,
          }}
        />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center' }}>{children}</span>
    </div>
  );
}
