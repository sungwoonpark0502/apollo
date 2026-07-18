import React, { useEffect, useState } from 'react';
import { STRINGS } from '@apollo/shared';

/** Presentational 5s cancel bar (C8.9 / C18); shrinking bar + Cancel button. */
export function CancelWindowBar({ endsAt, onCancel }: { endsAt: number; onCancel: () => void }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const total = 5000;
  const remaining = Math.max(0, endsAt - now);
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const secs = Math.ceil(remaining / 1000);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-2) var(--sp-3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-ctl)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>
          {STRINGS.confirm.cancelWindow(secs)}
        </div>
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 100ms linear' }} />
        </div>
      </div>
      <button
        onClick={onCancel}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-caption)',
          color: 'var(--danger)',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-ctl)',
          padding: 'var(--sp-1) var(--sp-3)',
          cursor: 'pointer',
        }}
      >
        {STRINGS.confirm.cancelNow}
      </button>
    </div>
  );
}

