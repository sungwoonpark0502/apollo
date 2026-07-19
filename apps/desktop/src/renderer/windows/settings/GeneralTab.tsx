import React, { useEffect, useState } from 'react';
import { Toggle } from '../../components/Toggle';
import { ProfileTab } from './ProfileTab';
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
        <Toggle checked={settings.launchAtLogin} onChange={(v: boolean) => patch({ ...settings, launchAtLogin: v })} />
      </Row>
      <Row label={STRINGS.settings.general.defaultView}>
        <select
          value={settings.workspace.defaultView}
          onChange={(e) => patch({ ...settings, workspace: { ...settings.workspace, defaultView: e.target.value as Settings['workspace']['defaultView'] } })}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="chat">{STRINGS.workspace.nav.chat}</option>
          <option value="today">{STRINGS.workspace.nav.today}</option>
          <option value="calendar">{STRINGS.workspace.nav.calendar}</option>
          <option value="notes">{STRINGS.workspace.nav.notes}</option>
        </select>
      </Row>
      <Row label={STRINGS.settings.general.chatSendOnEnter}>
        <Toggle checked={settings.chat.sendOnEnter} onChange={(v: boolean) => patch({ ...settings, chat: { ...settings.chat, sendOnEnter: v } })} />
      </Row>

      {/* Everything a first-time user does not need sits behind one fold: a
          settings page with fifteen visible knobs is itself a usability bug. */}
      <details style={{ marginTop: 'var(--sp-4)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-body)', color: 'var(--text-2)', padding: 'var(--sp-2) 0' }}>
          {STRINGS.settings.general.advanced}
        </summary>
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
      <Row label={STRINGS.settings.general.openWorkspaceOnLaunch}>
        <Toggle checked={settings.workspace.openOnLaunch} onChange={(v: boolean) => patch({ ...settings, workspace: { ...settings.workspace, openOnLaunch: v } })} />
      </Row>
      <Row label={STRINGS.settings.general.chatShowToolActivity}>
        <Toggle checked={settings.chat.showToolActivity} onChange={(v: boolean) => patch({ ...settings, chat: { ...settings.chat, showToolActivity: v } })} />
      </Row>
      <Row label={STRINGS.settings.general.chatAutoScroll}>
        <Toggle checked={settings.chat.autoScroll} onChange={(v: boolean) => patch({ ...settings, chat: { ...settings.chat, autoScroll: v } })} />
      </Row>
      <Row label={STRINGS.settings.general.quickCaptureHotkey}>
        <input
          value={settings.quickCapture.hotkey}
          onChange={(e) => patch({ ...settings, quickCapture: { ...settings.quickCapture, hotkey: e.target.value } })}
          style={{ ...inputStyle, width: 200 }}
          aria-label={STRINGS.settings.general.quickCaptureHotkey}
        />
      </Row>
      <Row label={STRINGS.settings.general.quickCaptureType}>
        <select
          value={settings.quickCapture.defaultType}
          onChange={(e) => patch({ ...settings, quickCapture: { ...settings.quickCapture, defaultType: e.target.value as 'note' | 'todo' } })}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="note">{STRINGS.quickCapture.chipNote}</option>
          <option value="todo">{STRINGS.quickCapture.chipTodo}</option>
        </select>
      </Row>
      </details>

      {/* Profile lost its own tab in the regroup; these fields power weather,
          the brief, and greetings, so they live here where both modes reach them. */}
      <h3 style={{ fontSize: 'var(--fs-title)', margin: 'var(--sp-5) 0 var(--sp-2)' }}>{STRINGS.settings.profile.title}</h3>
      <ProfileTab embedded />
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
