import React, { useEffect, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';

interface Dev { deviceId: string; label: string }

export function VoiceTab(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<{ inputs: Dev[]; outputs: Dev[] }>({ inputs: [], outputs: [] });

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then(setSettings);
    void window.apollo.call('devices.list', {}).then(setDevices);
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

      <Row label={STRINGS.settings.voice.pttHotkey}>
        <input
          value={settings.voice.pttHotkey}
          onChange={(e) => patch({ ...settings, voice: { ...settings.voice, pttHotkey: e.target.value } })}
          style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', padding: 'var(--sp-1) var(--sp-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', background: 'var(--surface)', color: 'var(--text-1)', width: 160 }}
          aria-label={STRINGS.settings.voice.pttHotkey}
        />
      </Row>

      <Row label={STRINGS.settings.voice.voice}>
        <input
          type="text"
          value={settings.tts.voice}
          onChange={(e) => patch({ ...settings, tts: { voice: e.target.value } })}
          style={inputStyle}
        />
      </Row>

      <Row label={STRINGS.settings.voice.inputDevice}>
        <select value={settings.voice.inputDeviceId ?? ''} onChange={(e) => patch({ ...settings, voice: { ...settings.voice, inputDeviceId: e.target.value || null } })} style={inputStyle}>
          <option value="">{STRINGS.settings.voice.systemDefault}</option>
          {devices.inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </Row>

      <Row label={STRINGS.settings.voice.outputDevice}>
        <select value={settings.voice.outputDeviceId ?? ''} onChange={(e) => patch({ ...settings, voice: { ...settings.voice, outputDeviceId: e.target.value || null } })} style={inputStyle}>
          <option value="">{STRINGS.settings.voice.systemDefault}</option>
          {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </Row>

      <Row label={STRINGS.settings.voice.ttsRate}>
        <input type="range" min={0.8} max={1.5} step={0.05} value={settings.voice.ttsRate}
          onChange={(e) => patch({ ...settings, voice: { ...settings.voice, ttsRate: Number(e.target.value) } })} style={{ width: 160 }} />
        <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>{settings.voice.ttsRate.toFixed(2)}×</span>
      </Row>

      <Row label={STRINGS.settings.voice.earconVolume}>
        <input type="range" min={0} max={1} step={0.05} value={settings.voice.earconVolume}
          onChange={(e) => patch({ ...settings, voice: { ...settings.voice, earconVolume: Number(e.target.value) } })} style={{ width: 160 }} />
        <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>{Math.round(settings.voice.earconVolume * 100)}%</span>
      </Row>

      <Row label={STRINGS.settings.voice.followup}>
        <input type="range" min={0} max={15} step={1} value={settings.voice.followupWindowSec}
          onChange={(e) => patch({ ...settings, voice: { ...settings.voice, followupWindowSec: Number(e.target.value) } })} style={{ width: 160 }} />
        <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>{settings.voice.followupWindowSec === 0 ? STRINGS.settings.voice.off : `${settings.voice.followupWindowSec}s`}</span>
      </Row>

      <Row label={STRINGS.settings.voice.pauseWakeOnBattery}>
        <input type="checkbox" checked={settings.voice.pauseWakeOnBattery}
          onChange={(e) => patch({ ...settings, voice: { ...settings.voice, pauseWakeOnBattery: e.target.checked } })} />
      </Row>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', padding: 'var(--sp-1) var(--sp-2)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', background: 'var(--surface)', color: 'var(--text-1)', width: 220,
};

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center' }}>{children}</span>
    </div>
  );
}
