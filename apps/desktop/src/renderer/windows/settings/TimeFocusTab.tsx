import React, { useEffect, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';
import { ToggleRow } from '../../components/Toggle';
import { Slider } from '../../components/Slider';

/**
 * When Apollo may interrupt, and when it must stay quiet.
 *
 * Quiet hours already existed in the settings schema (`dnd`) and the FSM
 * honored it, but there was no screen anywhere to set it — the defaults were
 * unreachable. Break reminders are new and deliberately default to off: an
 * assistant that interrupts on a timer nobody asked for is the behavior people
 * uninstall over.
 */
export function TimeFocusTab(): React.JSX.Element {
  const t = STRINGS.settings.timeFocus;
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then(setSettings);
  }, []);

  const patch = (next: Settings): void => {
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };

  if (!settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;

  const dnd = settings.dnd;
  const breaks = settings.breaks;

  return (
    <div>
      <h2 style={heading}>{t.title}</h2>
      <p style={subtitle}>{t.subtitle}</p>

      <Section title={t.quietHours} body={t.quietHoursBody}>
        <ToggleRow
          label={t.quietHours}
          checked={dnd.enabled}
          onChange={(v) => patch({ ...settings, dnd: { ...dnd, enabled: v } })}
        />
        <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center', opacity: dnd.enabled ? 1 : 0.5 }}>
          <HourField
            label={t.quietFrom}
            value={dnd.startHH}
            disabled={!dnd.enabled}
            onChange={(v) => patch({ ...settings, dnd: { ...dnd, startHH: v } })}
          />
          <HourField
            label={t.quietTo}
            value={dnd.endHH}
            disabled={!dnd.enabled}
            onChange={(v) => patch({ ...settings, dnd: { ...dnd, endHH: v } })}
          />
        </div>
      </Section>

      <Section title={t.breaks} body={t.breaksBody}>
        <ToggleRow
          label={t.breaks}
          checked={breaks.enabled}
          onChange={(v) => patch({ ...settings, breaks: { ...breaks, enabled: v } })}
        />
        <div style={{ opacity: breaks.enabled ? 1 : 0.5 }}>
          <Row label={t.breakEvery}>
            <Slider
              min={15}
              max={240}
              step={15}
              value={breaks.everyMin}
              disabled={!breaks.enabled}
              onChange={(v) => patch({ ...settings, breaks: { ...breaks, everyMin: v } })}
              ariaLabel={t.breakEvery}
              valueLabel={t.minutes(breaks.everyMin)}
            />
          </Row>
          <ToggleRow
            label={t.breakOnlyActive}
            description={t.breakOnlyActiveHint}
            checked={breaks.onlyWhenActive}
            disabled={!breaks.enabled}
            onChange={(v) => patch({ ...settings, breaks: { ...breaks, onlyWhenActive: v } })}
          />
        </div>
      </Section>

      <Section title={t.dailyBrief} body={t.dailyBriefBody}>
        <Row label={t.briefTime}>
          <input
            type="time"
            value={settings.brief.timeHHMM}
            onChange={(e) => patch({ ...settings, brief: { timeHHMM: e.target.value } })}
            aria-label={t.briefTime}
            style={field}
          />
        </Row>
      </Section>

      <Section title={t.followUp} body={t.followUpBody}>
        <Row label={t.followUp}>
          <Slider
            min={0}
            max={15}
            step={1}
            value={settings.voice.followupWindowSec}
            onChange={(v) => patch({ ...settings, voice: { ...settings.voice, followupWindowSec: v } })}
            ariaLabel={t.followUp}
            valueLabel={settings.voice.followupWindowSec === 0 ? STRINGS.settings.voice.off : `${settings.voice.followupWindowSec}s`}
          />
        </Row>
      </Section>
    </div>
  );
}

/** 0-23 as a labelled hour, so "22" reads as 10 PM rather than a raw number. */
function HourField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)' }}>{label}</span>
      <select
        className="apollo-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...field, width: 110 }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
    </label>
  );
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}

export function Section({ title, body, children }: { title: string; body?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section style={{ marginBottom: 'var(--sp-5)' }}>
      <h3 style={{ fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-1)' }}>{title}</h3>
      {body ? <p style={{ ...subtitle, marginBottom: 'var(--sp-2)' }}>{body}</p> : null}
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0' }}>
      <span style={{ flex: 1, fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{label}</span>
      {children}
    </div>
  );
}

const heading: React.CSSProperties = { fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-1)' };
const subtitle: React.CSSProperties = { fontSize: 'var(--fs-body)', color: 'var(--text-2)', margin: '0 0 var(--sp-4)' };
const field: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-2)',
  borderRadius: 'var(--radius-ctl)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
  fontSize: 'var(--fs-body)',
  fontFamily: 'var(--font-sans)',
};
