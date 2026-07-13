import React, { useEffect, useState } from 'react';
import { STRINGS, type KeyProvider } from '@apollo/shared';
import { PlaceSearch } from '../../components/PlaceSearch';
import { type GeoResult } from '../../lib/geocode';

const KEY_PROVIDERS: Array<{ id: KeyProvider; required: boolean }> = [
  { id: 'anthropic', required: true },
  { id: 'deepgram', required: true },
  { id: 'brave', required: false },
  { id: 'picovoice', required: false },
];

export function OnboardingApp(): React.JSX.Element {
  const [step, setStep] = useState(0);

  const finish = (): void => {
    void window.apollo.call('onboarding.finish', {}).then(() => window.close());
  };

  const steps = [
    <Welcome key="w" />,
    <Profile key="pr" />,
    <Permissions key="p" />,
    <Keys key="k" />,
    <WakeWord key="wa" />,
    <TryIt key="t" onDone={finish} />,
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: 'var(--sp-6)', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <div style={{ flex: 1 }}>{steps[step]}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          {steps.map((_, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === step ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} style={ghostButton}>
              {STRINGS.onboarding.back}
            </button>
          ) : null}
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(step + 1)} style={primaryButton}>
              {STRINGS.onboarding.next}
            </button>
          ) : (
            <button onClick={finish} style={primaryButton}>
              {STRINGS.onboarding.done}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Welcome(): React.JSX.Element {
  return (
    <Panel title={STRINGS.onboarding.welcomeTitle}>
      <p style={body}>{STRINGS.onboarding.welcomeBody}</p>
    </Panel>
  );
}

function Permissions(): React.JSX.Element {
  const [mic, setMic] = useState<boolean | null>(null);
  const [ax, setAx] = useState<boolean | null>(null);
  const request = (kind: 'mic' | 'accessibility', set: (v: boolean) => void): void => {
    void window.apollo.call('permissions.request', { kind }).then((r) => set(r.granted));
  };
  return (
    <Panel title={STRINGS.onboarding.permissionsTitle}>
      <p style={body}>{STRINGS.onboarding.permissionsBody}</p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        <button onClick={() => request('mic', setMic)} style={ghostButton}>
          Microphone {mic === true ? '✓' : mic === false ? '✕' : ''}
        </button>
        <button onClick={() => request('accessibility', setAx)} style={ghostButton}>
          Accessibility {ax === true ? '✓' : ax === false ? '✕' : ''}
        </button>
      </div>
    </Panel>
  );
}

function Keys(): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, { ok: boolean; message: string }>>({});

  const saveTest = (p: KeyProvider): void => {
    const v = values[p]?.trim();
    const run = v ? window.apollo.call('keys.set', { provider: p, value: v }).then(() => window.apollo.call('keys.test', { provider: p })) : window.apollo.call('keys.test', { provider: p });
    void run.then((r) => setStatus((s) => ({ ...s, [p]: r })));
  };

  return (
    <Panel title={STRINGS.onboarding.keysTitle}>
      <p style={body}>{STRINGS.onboarding.keysBody}</p>
      {KEY_PROVIDERS.map(({ id, required }) => (
        <div key={id} style={{ marginTop: 'var(--sp-3)' }}>
          <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
            {STRINGS.settings.keys.providers[id]} {required ? '(required)' : '(optional)'}
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
            <input
              type="password"
              value={values[id] ?? ''}
              onChange={(e) => setValues((s) => ({ ...s, [id]: e.target.value }))}
              style={{ flex: 1, ...inputStyle }}
            />
            <button onClick={() => saveTest(id)} style={ghostButton}>
              {STRINGS.onboarding.test}
            </button>
          </div>
          {status[id] ? (
            <div style={{ fontSize: 'var(--fs-caption)', color: status[id].ok ? 'var(--success)' : 'var(--danger)', marginTop: 'var(--sp-1)' }}>
              {status[id].message}
            </div>
          ) : null}
        </div>
      ))}
    </Panel>
  );
}

function Profile(): React.JSX.Element {
  const [name, setName] = useState('');
  const [home, setHome] = useState<GeoResult | null>(null);

  // Load current profile so re-running onboarding shows existing values.
  useEffect(() => {
    void window.apollo.call('settings.get', {}).then((s) => {
      setName(s.profile.name);
      setHome(s.profile.homePlace);
    });
  }, []);

  const persist = (partial: { name?: string; homePlace?: GeoResult | null }): void => {
    void window.apollo.call('settings.get', {}).then((s) => {
      void window.apollo.call('settings.set', { ...s, profile: { ...s.profile, ...partial } });
    });
  };

  return (
    <Panel title={STRINGS.onboarding.profileTitle}>
      <p style={body}>{STRINGS.onboarding.profileBody}</p>
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>{STRINGS.onboarding.profileName}</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 60))}
        onBlur={() => persist({ name })}
        placeholder={STRINGS.onboarding.profileNamePlaceholder}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
      />
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>{STRINGS.onboarding.profileHome}</label>
      <PlaceSearch value={home} onSelect={(p) => { setHome(p); persist({ homePlace: p }); }} />
    </Panel>
  );
}

function WakeWord(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [sensitivity, setSensitivity] = useState(0.5);

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then((s) => {
      setEnabled(s.wake.enabled);
      setSensitivity(s.wake.sensitivity);
    });
  }, []);

  const persist = (partial: { enabled?: boolean; sensitivity?: number }): void => {
    void window.apollo.call('settings.get', {}).then((s) => {
      void window.apollo.call('settings.set', { ...s, wake: { ...s.wake, ...partial } });
    });
  };

  return (
    <Panel title={STRINGS.onboarding.wakeTitle}>
      <p style={body}>{STRINGS.onboarding.wakeBody}</p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', margin: 'var(--sp-3) 0', fontSize: 'var(--fs-body)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); persist({ enabled: e.target.checked }); }} />
        {STRINGS.onboarding.wakeToggle}
      </label>
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>{STRINGS.onboarding.wakeSensitivity}</label>
      <input
        type="range" min={0} max={1} step={0.05} value={sensitivity}
        onChange={(e) => setSensitivity(parseFloat(e.target.value))}
        onMouseUp={() => persist({ sensitivity })}
        disabled={!enabled}
        style={{ width: 240 }}
      />
    </Panel>
  );
}

function TryIt({ onDone }: { onDone: () => void }): React.JSX.Element {
  return (
    <Panel title={STRINGS.onboarding.tryTitle}>
      <p style={body}>{STRINGS.onboarding.tryBody('Option+Space')}</p>
      <button onClick={onDone} style={{ ...primaryButton, marginTop: 'var(--sp-4)' }}>
        {STRINGS.onboarding.tryFinish}
      </button>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <h1 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-3)' }}>{title}</h1>
      {children}
    </div>
  );
}

const body: React.CSSProperties = { fontSize: 'var(--fs-body)', color: 'var(--text-2)', lineHeight: 1.5 };
const primaryButton: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-5)',
  border: 'none',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
};
const ghostButton: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-4)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
  cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
};
