import React, { useState } from 'react';
import { fireControl } from '../../lib/controlDispatch';
import { STRINGS, type ConfirmAction } from '@apollo/shared';
import { buttonStyle } from './TimerCard';

/**
 * I3 batch confirmation: one card for a Tier-3 action-set. Each row has its own
 * taint flags and a keep/deny checkbox; Approve all runs the still-checked rows,
 * Deny all rejects the set. Unchecked rows are sent as deniedIndices.
 */
export function BatchConfirmCard({
  confirmationId,
  actions,
}: {
  confirmationId: string;
  actions: ConfirmAction[];
  expiresAt: number;
}): React.JSX.Element {
  const [checked, setChecked] = useState<boolean[]>(() => actions.map(() => true));
  const [resolved, setResolved] = useState<null | 'approved' | 'denied'>(null);

  const respond = (approved: boolean): void => {
    const deniedIndices = approved ? checked.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0) : [];
    void fireControl(approved ? 'confirm.batchApprove' : 'confirm.batchDeny', { confirmationId, deniedIndices }).then(() => {
      setResolved(approved ? 'approved' : 'denied');
    });
  };

  const toggle = (i: number): void => setChecked((prev) => prev.map((c, j) => (j === i ? !c : c)));
  const anyChecked = checked.some(Boolean);

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, marginBottom: 'var(--sp-2)' }}>
        {STRINGS.confirm.askBatch(actions.length)}
      </div>
      {actions.map((action, i) => {
        const tainted = [...new Set(action.taintFlags.map((f) => f.split(':')[1]).filter((k): k is string => !!k))];
        return (
          <div key={i} style={{ display: 'flex', gap: 'var(--sp-2)', padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border)', opacity: checked[i] ? 1 : 0.5 }}>
            {!resolved ? (
              <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} aria-label={action.summary} style={{ marginTop: 3 }} />
            ) : null}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{action.toolName}</div>
              <div style={{ fontSize: 'var(--fs-body)' }}>{action.summary}</div>
              {tainted.length > 0 ? (
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--danger)' }}>
                  {tainted.map((k) => STRINGS.confirm.taintWarning(k)).join(' ')}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {resolved ? (
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-caption)', marginTop: 'var(--sp-2)' }}>
          {resolved === 'approved' ? '✓' : STRINGS.confirm.denied}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          <button
            onClick={() => respond(true)}
            disabled={!anyChecked}
            style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', opacity: anyChecked ? 1 : 0.5 }}
          >
            {STRINGS.confirm.approveAll}
          </button>
          <button onClick={() => respond(false)} style={buttonStyle}>
            {STRINGS.confirm.denyAll}
          </button>
        </div>
      )}
    </div>
  );
}
