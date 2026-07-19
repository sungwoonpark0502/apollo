import React, { useEffect, useState } from 'react';
import { fireControl } from '../../lib/controlDispatch';
import { STRINGS } from '@apollo/shared';

function fmt(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function TimerCard({ id, label, endsAt }: { id: string; label: string | null; endsAt: number }): React.JSX.Element {
  const [left, setLeft] = useState<number | null>(null);
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    const update = (): void => setLeft(endsAt - Date.now());
    const raf = requestAnimationFrame(update); // first paint without a sync set
    const t = setInterval(update, 250);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, [endsAt]);

  const cancel = (): void => {
    void fireControl('timer.cancel', { id: id }).then(() => setCanceled(true));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
      <div>
        {label ? <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{label}</div> : null}
        <div style={{ fontSize: 'var(--fs-display)', fontVariantNumeric: 'tabular-nums', color: canceled ? 'var(--text-3)' : 'var(--text-1)' }}>
          {canceled ? STRINGS.spoken.timerCanceled : left === null ? '' : fmt(left)}
        </div>
      </div>
      {!canceled && (left === null || left > 0) ? (
        <button onClick={cancel} style={buttonStyle}>
          {STRINGS.cards.cancel}
        </button>
      ) : null}
    </div>
  );
}

export const buttonStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-2)',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-1) var(--sp-3)',
  cursor: 'pointer',
};
