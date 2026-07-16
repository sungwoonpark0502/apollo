import React, { useEffect, useState } from 'react';
import { fmtRelative, STRINGS, type CalendarCollection } from '@apollo/shared';
import { buttonStyle } from '../../components/cards/TimerCard';
import { useSettings } from '../../lib/useLive';

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
      <GoogleCalendarSection />
    </div>
  );
}

/** I7 Google Calendar sync: connect, pick calendars + direction, sync now, disconnect. */
function GoogleCalendarSection(): React.JSX.Element {
  const g = STRINGS.gcal;
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ calendars: CalendarCollection[] } | null>(null);
  const [direction, setDirection] = useState<'read-only' | 'two-way'>('read-only');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<{ status: 'idle' | 'syncing' | 'error'; lastSyncTs: number | null } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => window.apollo.on('google.state', (s) => setState(s)), []);

  const gc = settings?.googleCalendar;
  const connected = !!gc?.enabled;

  const connect = (): void => {
    setBusy(true);
    setError(null);
    void window.apollo.call('google.connect', {}).then((r) => {
      setBusy(false);
      if (r.ok && r.calendars) {
        setPicker({ calendars: r.calendars });
        setSelected(new Set(r.calendars.filter((c) => !c.readOnly).map((c) => c.id)));
      } else {
        setError(g.connectError);
      }
    });
  };

  const apply = (): void => {
    if (!picker) return;
    const chosen = picker.calendars.filter((c) => selected.has(c.id));
    void window.apollo.call('google.applySelection', { calendars: chosen, direction }).then(() => setPicker(null));
  };

  const syncNow = (): void => void window.apollo.call('google.sync', {});
  const disconnect = (keepLocal: boolean): void => {
    void window.apollo.call('google.disconnect', { keepLocal }).then(() => setConfirmDisconnect(false));
  };

  return (
    <div style={{ marginTop: 'var(--sp-5)' }}>
      <h3 style={{ fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)' }}>{g.title}</h3>

      {!connected && !picker ? (
        <>
          <button onClick={connect} disabled={busy} style={buttonStyle}>{busy ? g.connecting : g.connect}</button>
          {error ? <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)', marginTop: 'var(--sp-2)' }}>{error}</div> : null}
        </>
      ) : null}

      {picker ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 'var(--sp-3)' }}>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>{g.chooseCalendars}</div>
          {picker.calendars.map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-1) 0' }}>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
              />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.color }} />
              {c.name}{c.readOnly ? ` (${g.readOnly})` : ''}
            </label>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', margin: 'var(--sp-3) 0' }}>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{g.direction}:</span>
            <button onClick={() => setDirection('read-only')} style={{ ...buttonStyle, ...(direction === 'read-only' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>{g.readOnly}</button>
            <button onClick={() => setDirection('two-way')} style={{ ...buttonStyle, ...(direction === 'two-way' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>{g.twoWay}</button>
          </div>
          <button onClick={apply} style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>{STRINGS.settings.accounts.connect}</button>
        </div>
      ) : null}

      {connected ? (
        <div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>
            {state?.status === 'syncing' ? g.syncing : state?.status === 'error' ? g.syncError : gc?.lastSyncTs ? g.lastSync(fmtRelative(gc.lastSyncTs)) : g.neverSynced}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button onClick={syncNow} style={buttonStyle}>{g.syncNow}</button>
            <button onClick={() => setConfirmDisconnect(true)} style={{ ...buttonStyle, color: 'var(--danger)' }}>{g.disconnect}</button>
          </div>
          {confirmDisconnect ? (
            <div style={{ marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
              <div style={{ marginBottom: 'var(--sp-2)' }}>{g.disconnectPrompt}</div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <button onClick={() => disconnect(true)} style={buttonStyle}>{g.keepLocal}</button>
                <button onClick={() => disconnect(false)} style={{ ...buttonStyle, color: 'var(--danger)' }}>{g.removeAll}</button>
                <button onClick={() => setConfirmDisconnect(false)} style={buttonStyle}>{g.cancel}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
