import React, { useEffect, useState } from 'react';
import { Toggle } from '../../components/Toggle';
import { Slider } from '../../components/Slider';
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
        <Toggle checked={settings.wake.enabled} onChange={(v: boolean) => patch({ ...settings, wake: { ...settings.wake, enabled: v } })} />
      </Row>

      <Row label={STRINGS.settings.voice.sensitivity}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={settings.wake.sensitivity}
          onChange={(v) => patch({ ...settings, wake: { ...settings.wake, sensitivity: v } })}
          ariaLabel={STRINGS.settings.voice.sensitivity}
          valueLabel={settings.wake.sensitivity.toFixed(2)}
          width={200}
        />
        <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>
          {settings.wake.sensitivity.toFixed(2)}
        </span>
      </Row>

      <Row label={STRINGS.settings.voice.ptt}>
        <Toggle checked={settings.ptt.enabled} onChange={(v: boolean) => patch({ ...settings, ptt: { enabled: v } })} />
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
        <Slider min={0.8} max={1.5} step={0.05} value={settings.voice.ttsRate}
          onChange={(v) => patch({ ...settings, voice: { ...settings.voice, ttsRate: v } })}
          ariaLabel={STRINGS.settings.voice.ttsRate} valueLabel={`${settings.voice.ttsRate.toFixed(2)}×`} width={160} />
      </Row>

      <Row label={STRINGS.settings.voice.earconVolume}>
        <Slider min={0} max={1} step={0.05} value={settings.voice.earconVolume}
          onChange={(v) => patch({ ...settings, voice: { ...settings.voice, earconVolume: v } })}
          ariaLabel={STRINGS.settings.voice.earconVolume} valueLabel={`${Math.round(settings.voice.earconVolume * 100)}%`} width={160} />
      </Row>

      <Row label={STRINGS.settings.voice.followup}>
        <Slider min={0} max={15} step={1} value={settings.voice.followupWindowSec}
          onChange={(v) => patch({ ...settings, voice: { ...settings.voice, followupWindowSec: v } })}
          ariaLabel={STRINGS.settings.voice.followup}
          valueLabel={settings.voice.followupWindowSec === 0 ? STRINGS.settings.voice.off : `${settings.voice.followupWindowSec}s`} width={160} />
      </Row>

      <Row label={STRINGS.settings.voice.pauseWakeOnBattery}>
        <Toggle checked={settings.voice.pauseWakeOnBattery} onChange={(v: boolean) => patch({ ...settings, voice: { ...settings.voice, pauseWakeOnBattery: v } })} />
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
