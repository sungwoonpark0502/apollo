import React, { useEffect, useRef, useState } from 'react';
import { STRINGS, ringState, type AlertKind } from '@apollo/shared';

export interface RingingAlert {
  kind: AlertKind;
  id: string;
  label: string | null;
  firedAt: number;
  silent: boolean;
}

const SNOOZE_PRESETS = [1, 5, 10];
const REMINDER_SNOOZE_PRESETS = [10, 30, 60];

/** H6 ringing overlay (Stage width). Plays ring.wav at earconVolume × the ramp
 *  gain; timers stop the loop after 60s, alarms ramp down until dismissed. */
export function RingingCard({ alert, earconVolume, onAction }: {
  alert: RingingAlert;
  earconVolume: number;
  onAction: (id: string, action: 'dismiss' | 'snooze' | 'complete', snoozeMin?: number) => void;
}): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const tick = (): void => setElapsed(Date.now() - alert.firedAt);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [alert.firedAt]);

  // sound loop driven by the shared ring policy
  useEffect(() => {
    // A reminder is silent by construction, so no audio element is created.
    if (alert.silent || alert.kind === 'reminder') return;
    const a = new Audio('/earcons/ring.wav');
    a.loop = true;
    audioRef.current = a;
    void a.play().catch(() => undefined);
    return () => {
      a.pause();
      audioRef.current = null;
    };
  }, [alert.silent, alert.kind]);

  useEffect(() => {
    const { looping, gain } = ringState(alert.kind, elapsed);
    const a = audioRef.current;
    if (!a) return;
    a.volume = Math.max(0, Math.min(1, earconVolume * gain));
    if (!looping && !a.paused) a.pause();
  }, [elapsed, alert.kind, earconVolume]);

  const mm = Math.floor(elapsed / 60_000);
  const ss = Math.floor((elapsed % 60_000) / 1000);
  const sinceLabel = elapsed < 1000 ? STRINGS.alerts.now : `${mm}:${String(ss).padStart(2, '0')}`;

  const isReminder = alert.kind === 'reminder';
  const kindLabel = isReminder ? STRINGS.alerts.reminder : alert.kind === 'alarm' ? STRINGS.alerts.alarm : STRINGS.alerts.timer;
  // A reminder snoozes in coarser steps than a timer: 1 minute is a stopwatch
  // affordance, not something you ask to be reminded again in.
  const snoozeOptions = isReminder ? REMINDER_SNOOZE_PRESETS : SNOOZE_PRESETS;

  return (
    <div role="alertdialog" aria-label={STRINGS.alerts.ariaRinging(alert.label ?? kindLabel)} style={{ padding: 'var(--sp-4)' }}>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {kindLabel}
      </div>
      <div style={{ fontSize: 'var(--fs-display)', fontWeight: 600, color: 'var(--text-1)', margin: 'var(--sp-1) 0' }}>
        {alert.label ?? kindLabel}
      </div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{STRINGS.alerts.since(sinceLabel)}</div>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {isReminder ? (
          // Done completes the reminder; "Not now" only closes the card, so a
          // reminder is never silently marked done by dismissing a popup.
          <>
            <button onClick={() => onAction(alert.id, 'complete')} style={primary}>{STRINGS.alerts.complete}</button>
            <button onClick={() => onAction(alert.id, 'dismiss')} style={ghost}>{STRINGS.alerts.remindLater}</button>
          </>
        ) : (
          <button onClick={() => onAction(alert.id, 'dismiss')} style={primary}>{STRINGS.alerts.dismiss}</button>
        )}
        {snoozeOptions.map((m) => (
          <button key={m} onClick={() => onAction(alert.id, 'snooze', m)} style={ghost}>
            {STRINGS.alerts.snoozeMin(m)}
          </button>
        ))}
      </div>
      {alert.silent ? <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-2)' }}>{STRINGS.alerts.dndSilent}</div> : null}
    </div>
  );
}

const primary: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--accent)',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-caption)',
};
const ghost: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 'var(--fs-caption)',
};
