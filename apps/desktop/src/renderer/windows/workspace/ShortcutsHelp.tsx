import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SHORTCUT_SCOPES, STRINGS, type ShortcutScope } from '@apollo/shared';

type Row = { scope: ShortcutScope; keys: string; description: string };

/** I6 shortcuts help sheet: renders from shortcuts.list (the single registry), grouped by scope. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void window.apollo.call('shortcuts.list', {}).then((r) => setRows(r as Row[]));
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const map = new Map<ShortcutScope, Row[]>();
    for (const r of rows) map.set(r.scope, [...(map.get(r.scope) ?? []), r]);
    return SHORTCUT_SCOPES.map((scope) => ({ scope, rows: map.get(scope) ?? [] })).filter((g) => g.rows.length > 0);
  }, [rows]);

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
    >
      <div style={{ width: 520, maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 'var(--sp-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
          <h2 style={{ fontSize: 'var(--fs-title)', margin: 0 }}>{STRINGS.shortcuts.title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 'var(--fs-title)' }}><Icon name="close" size={14} /></button>
        </div>
        {grouped.map((g) => (
          <div key={g.scope} style={{ marginBottom: 'var(--sp-4)' }}>
            <div style={{ fontSize: 'var(--fs-caption)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>
              {STRINGS.shortcuts.scopes[g.scope]}
            </div>
            {g.rows.map((r, i) => (
              <div key={`${r.keys}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-1) 0' }}>
                <span style={{ color: 'var(--text-2)' }}>{r.description}</span>
                <kbd style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-caption)', color: 'var(--text-1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 6px' }}>{r.keys}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
