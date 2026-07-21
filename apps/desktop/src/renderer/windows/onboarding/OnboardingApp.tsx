import React, { useEffect, useState } from 'react';
import { SignInForm } from '../../components/auth/SignInForm';
import { Slider } from '../../components/Slider';
import { STRINGS, type KeyProvider, type AuthStatus } from '@apollo/shared';
import { LocationPicker } from '../../components/LocationPicker';

const KEY_PROVIDERS: Array<{ id: KeyProvider; required: boolean }> = [
  { id: 'anthropic', required: true },
  { id: 'deepgram', required: true },
  { id: 'brave', required: false },
  { id: 'picovoice', required: false },
];

/**
 * L1.4: in managed mode sign-in comes first and there is no separate Profile
 * step — the name is part of creating an account, and an existing account
 * already has one, so asking again was redundant data entry before the user had
 * seen anything work. Location is optional and lives in Settings.
 *
 * BYOK has no account, so it keeps the Profile step to collect a name.
 */

export function OnboardingApp(): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [mode, setMode] = useState<'managed' | 'byok'>('managed');
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then((s) => setProfileName(s.profile.name));
    void window.apollo.call('app.mode', {}).then((m) => {
      setMode(m.mode);
      setShowKeys(m.showKeys);
    });
  }, []);

  const finish = (): void => {
    void window.apollo.call('onboarding.finish', {}).then(() => window.close());
  };

  const steps =
    mode === 'byok'
      ? [
          <Welcome key="w" />,
          <Profile key="pr" onNameChange={setProfileName} />,
          <Permissions key="p" />,
          // The credentials step is developer setup, not onboarding: keys come
          // from the environment, and a first-run screen listing vendor names
          // and "API key" fields is plumbing shown to a user. Revealed only
          // with APOLLO_SHOW_KEYS.
          ...(showKeys ? [<Keys key="k" />] : []),
          <WakeWord key="wa" />,
          <TryIt key="t" onDone={finish} />,
        ]
      : [
          <Welcome key="w" />,
          <AccountStep key="a" />,
          <Permissions key="p" />,
          <WakeWord key="wa" />,
          <TryIt key="t" onDone={finish} />,
        ];

  // H/E6 override: BYOK still requires a name before leaving its Profile step.
  const nameMissing = mode === 'byok' && step === 1 && !profileName.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: 'var(--sp-6)', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <div style={{ flex: 1 }}>{steps[step]}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
            {steps.map((_, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === step ? 'var(--accent)' : 'var(--border)' }} />
            ))}
          </div>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{STRINGS.onboarding.stepIndicator(step + 1, steps.length)}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} style={ghostButton}>
              {STRINGS.onboarding.back}
            </button>
          ) : null}
          {step < steps.length - 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <button onClick={() => setStep(step + 1)} disabled={nameMissing} style={{ ...primaryButton, ...(nameMissing ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
                {STRINGS.onboarding.next}
              </button>
              {nameMissing ? <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--danger)' }}>{STRINGS.onboarding.profileNameMissing}</span> : null}
            </div>
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

/**
 * L1.4 onboarding sign-in. Reuses the Settings form so there is one sign-in
 * implementation, and stays skippable — every local feature (notes, calendar,
 * timers, reminders) works signed out.
 */
function AccountStep(): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('signedOut');
  useEffect(() => {
    void window.apollo.call('auth.status', {}).then((s) => setStatus(s.status));
    return window.apollo.on('auth.state', (s) => setStatus(s.status));
  }, []);
  return (
    <Panel title={STRINGS.onboarding.accountTitle}>
      <p style={body}>{STRINGS.onboarding.accountBody}</p>
      {status === 'signedIn' ? (
        <p style={{ ...body, color: 'var(--accent)' }}>{STRINGS.onboarding.accountSignedIn}</p>
      ) : (
        <SignInForm busy={status === 'signingIn'} />
      )}
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

function Profile({ onNameChange }: { onNameChange: (name: string) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [home, setHome] = useState<{ label: string } | null>(null);

  // Load current profile so re-running onboarding shows existing values.
  useEffect(() => {
    void window.apollo.call('settings.get', {}).then((s) => {
      setName(s.profile.name);
      onNameChange(s.profile.name);
      setHome(s.profile.homePlace);
    });
  }, [onNameChange]);

  const persist = (partial: { name?: string; homePlace?: { label: string; lat: number; lon: number; tz: string } | null }): void => {
    void window.apollo.call('settings.get', {}).then((s) => {
      void window.apollo.call('settings.set', { ...s, profile: { ...s.profile, ...partial } });
    });
  };

  const onNameEdit = (v: string): void => {
    const next = v.slice(0, 60);
    setName(next);
    onNameChange(next); // live-gates the Next button
  };

  return (
    <Panel title={STRINGS.onboarding.profileTitle}>
      <p style={body}>{STRINGS.onboarding.profileBody}</p>
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>{STRINGS.onboarding.profileName}</label>
      <input
        value={name}
        onChange={(e) => onNameEdit(e.target.value)}
        onBlur={() => persist({ name })}
        placeholder={STRINGS.onboarding.profileNamePlaceholder}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', ...(name.trim() ? {} : { borderColor: 'var(--danger)' }) }}
      />
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>{STRINGS.onboarding.profileHome}</label>
      {home ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{home.label}</span>
          <button onClick={() => { setHome(null); persist({ homePlace: null }); }} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-caption)' }}>{STRINGS.settings.profile.clearHome}</button>
        </div>
      ) : null}
      <LocationPicker onSelect={(place) => { const hp = { label: place.label, lat: place.lat, lon: place.lon, tz: place.tz }; setHome(hp); persist({ homePlace: hp }); }} />
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
      <Slider
        min={0}
        max={1}
        step={0.05}
        value={sensitivity}
        disabled={!enabled}
        // Persist on release, not per frame: dragging fires continuously and
        // each step would be a settings write.
        onChange={(v) => {
          setSensitivity(v);
          persist({ sensitivity: v });
        }}
        ariaLabel={STRINGS.onboarding.wakeSensitivity}
        valueLabel={sensitivity.toFixed(2)}
        width={240}
      />
    </Panel>
  );
}

function TryIt({ onDone }: { onDone: () => void }): React.JSX.Element {
  return (
    <Panel title={STRINGS.onboarding.tryTitle}>
      <p style={body}>{STRINGS.onboarding.tryBody}</p>
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
