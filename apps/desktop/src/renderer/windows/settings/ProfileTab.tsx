import React, { useEffect, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';
import { PlaceSearch } from '../../components/PlaceSearch';

/** E7 Profile tab: name, home location (autocomplete), units, time format, week start. */
export function ProfileTab(): React.JSX.Element {
  const p = STRINGS.settings.profile;
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then(setSettings);
  }, []);

  if (!settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;

  const patch = (partial: Partial<Settings['profile']>): void => {
    const next = { ...settings, profile: { ...settings.profile, ...partial } };
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };

  const prof = settings.profile;

  return (
    <div style={{ maxWidth: 460 }}>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{p.title}</h2>

      <Field label={p.name}>
        <input
          value={prof.name}
          onChange={(e) => patch({ name: e.target.value.slice(0, 60) })}
          placeholder={p.namePlaceholder}
          style={input}
        />
      </Field>

      <Field label={p.homeLocation}>
        <PlaceSearch
          value={prof.homePlace}
          onSelect={(place) => patch({ homePlace: place })}
        />
        {prof.homePlace ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{prof.homePlace.label} · {prof.homePlace.tz}</span>
            <button onClick={() => patch({ homePlace: null })} style={linkBtn}>{p.clearHome}</button>
          </div>
        ) : null}
      </Field>

      <Field label={p.units}>
        <Segmented
          options={[{ v: 'imperial', label: p.imperial }, { v: 'metric', label: p.metric }]}
          value={prof.units}
          onChange={(v) => patch({ units: v as 'imperial' | 'metric' })}
        />
      </Field>

      <Field label={p.timeFormat}>
        <Segmented
          options={[{ v: '12h', label: p.h12 }, { v: '24h', label: p.h24 }]}
          value={prof.timeFormat}
          onChange={(v) => patch({ timeFormat: v as '12h' | '24h' })}
        />
      </Field>

      <Field label={p.weekStart}>
        <Segmented
          options={[{ v: 'sunday', label: p.sunday }, { v: 'monday', label: p.monday }]}
          value={prof.weekStart}
          onChange={(v) => patch({ weekStart: v as 'monday' | 'sunday' })}
        />
      </Field>
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: Array<{ v: string; label: string }>; value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', overflow: 'hidden' }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            padding: 'var(--sp-2) var(--sp-4)', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
            background: value === o.v ? 'var(--accent)' : 'transparent', color: value === o.v ? '#fff' : 'var(--text-1)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 'var(--sp-4)' }}>
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>{label}</label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
