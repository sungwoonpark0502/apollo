import React, { useEffect, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';
import { buttonStyle } from '../../components/cards/TimerCard';

interface Privacy {
  egressHosts: string[];
  memoryFacts: Array<{ id: string; category: string; fact: string }>;
}

export function PrivacyTab(): React.JSX.Element {
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wipeText, setWipeText] = useState('');
  const [newDir, setNewDir] = useState('');

  const refresh = (): void => {
    void window.apollo.call('privacy.get', {}).then(setPrivacy);
    void window.apollo.call('settings.get', {}).then(setSettings);
  };
  useEffect(refresh, []);

  const patch = (next: Settings): void => {
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };

  const deleteFact = (id: string): void => {
    void window.apollo.call('privacy.deleteMemory', { id }).then(refresh);
  };

  const wipe = (): void => {
    if (wipeText !== STRINGS.settings.privacy.wipeConfirmWord) return;
    void window.apollo.call('privacy.wipe', { confirm: 'ERASE' });
  };

  if (!privacy || !settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.privacy}</h2>

      <Row label={STRINGS.settings.privacy.history}>
        <input
          type="checkbox"
          checked={settings.history.enabled}
          onChange={(e) => patch({ ...settings, history: { enabled: e.target.checked } })}
        />
      </Row>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.memoryFacts}</h3>
        {privacy.memoryFacts.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>Nothing remembered yet.</div>
        ) : (
          privacy.memoryFacts.map((f) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-1) 0' }}>
              <span style={{ fontSize: 'var(--fs-caption)' }}>
                <span style={{ color: 'var(--text-3)' }}>{f.category}: </span>
                {f.fact}
              </span>
              <button onClick={() => deleteFact(f.id)} aria-label={STRINGS.cards.delete} style={{ ...buttonStyle, color: 'var(--danger)' }}>
                {STRINGS.cards.delete}
              </button>
            </div>
          ))
        )}
      </section>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.approvedDirs}</h3>
        {settings.approvedDirs.map((d) => (
          <div key={d} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-1) 0' }}>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{d}</span>
            <button
              onClick={() => patch({ ...settings, approvedDirs: settings.approvedDirs.filter((x) => x !== d) })}
              style={{ ...buttonStyle, color: 'var(--danger)' }}
            >
              {STRINGS.cards.delete}
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <input
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="/Users/you/Documents"
            style={inputStyle}
          />
          <button
            onClick={() => {
              if (newDir.trim()) patch({ ...settings, approvedDirs: [...settings.approvedDirs, newDir.trim()] });
              setNewDir('');
            }}
            style={buttonStyle}
          >
            Add
          </button>
        </div>
      </section>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.egress}</h3>
        <ul style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', columns: 2, listStyle: 'none', padding: 0 }}>
          {privacy.egressHosts.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--border)' }}>
        <h3 style={{ ...sectionTitle, color: 'var(--danger)' }}>{STRINGS.settings.privacy.wipe}</h3>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-2)' }}>
          {STRINGS.settings.privacy.wipeConfirmPrompt}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder={STRINGS.settings.privacy.wipeConfirmWord} style={inputStyle} />
          <button
            onClick={wipe}
            disabled={wipeText !== STRINGS.settings.privacy.wipeConfirmWord}
            style={{
              ...buttonStyle,
              color: '#fff',
              background: wipeText === STRINGS.settings.privacy.wipeConfirmWord ? 'var(--danger)' : 'var(--text-3)',
              borderColor: 'transparent',
            }}
          >
            {STRINGS.settings.privacy.wipe}
          </button>
        </div>
      </section>
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

const sectionTitle: React.CSSProperties = { fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)', color: 'var(--text-1)' };
const inputStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-caption)',
  padding: 'var(--sp-1) var(--sp-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
};
