import React, { useState } from 'react';
import { STRINGS, type KeyProvider } from '@apollo/shared';

const PROVIDERS: KeyProvider[] = ['anthropic', 'deepgram', 'brave', 'picovoice'];

interface RowState {
  value: string;
  status: { ok: boolean; message: string } | null;
  busy: boolean;
}

export function KeysTab(): React.JSX.Element {
  const [rows, setRows] = useState<Record<KeyProvider, RowState>>(
    () => Object.fromEntries(PROVIDERS.map((p) => [p, { value: '', status: null, busy: false }])) as Record<KeyProvider, RowState>,
  );

  const update = (p: KeyProvider, patch: Partial<RowState>): void =>
    setRows((r) => ({ ...r, [p]: { ...r[p], ...patch } }));

  const saveAndTest = async (p: KeyProvider): Promise<void> => {
    update(p, { busy: true, status: null });
    try {
      if (rows[p].value.trim()) {
        const saved = await window.apollo.call('keys.set', { provider: p, value: rows[p].value.trim() });
        if (!saved.ok) {
          update(p, { busy: false, status: { ok: false, message: 'Could not store the key securely.' } });
          return;
        }
        update(p, { value: '' }); // write-only: never keep it around
      }
      const res = await window.apollo.call('keys.test', { provider: p });
      update(p, { busy: false, status: res });
    } catch {
      update(p, { busy: false, status: { ok: false, message: 'Something went wrong.' } });
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.keys.title}</h2>
      {PROVIDERS.map((p) => (
        <div key={p} style={{ marginBottom: 'var(--sp-4)' }}>
          <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>
            {STRINGS.settings.keys.providers[p]}
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <input
              type="password"
              value={rows[p].value}
              onChange={(e) => update(p, { value: e.target.value })}
              placeholder="Paste key (write-only)"
              style={{
                flex: 1,
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-body)',
                padding: 'var(--sp-2) var(--sp-3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-ctl)',
                background: 'var(--surface)',
                color: 'var(--text-1)',
                outline: 'none',
              }}
            />
            <button
              onClick={() => void saveAndTest(p)}
              disabled={rows[p].busy}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-body)',
                padding: 'var(--sp-2) var(--sp-4)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-ctl)',
                background: 'var(--surface)',
                color: 'var(--text-1)',
                cursor: 'pointer',
              }}
            >
              {rows[p].busy ? '…' : STRINGS.settings.keys.test}
            </button>
          </div>
          {rows[p].status ? (
            <div
              style={{
                marginTop: 'var(--sp-1)',
                fontSize: 'var(--fs-caption)',
                color: rows[p].status.ok ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {rows[p].status.message}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
