import React, { useState } from 'react';
import { STRINGS, type ConfirmAction } from '@apollo/shared';
import { buttonStyle } from './TimerCard';

export function ConfirmCard({
  confirmationId,
  action,
}: {
  confirmationId: string;
  action: ConfirmAction;
  expiresAt: number;
}): React.JSX.Element {
  const [resolved, setResolved] = useState<null | 'approved' | 'denied'>(null);

  const respond = (approved: boolean): void => {
    void window.apollo.call('agent.confirm', { confirmationId, approved }).then(() => {
      setResolved(approved ? 'approved' : 'denied');
    });
  };

  const tainted = new Set(action.taintFlags.map((f) => f.split(':')[1]));

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{action.toolName}</div>
      <div style={{ margin: 'var(--sp-2) 0', fontSize: 'var(--fs-body)' }}>{action.summary}</div>
      <table style={{ fontSize: 'var(--fs-caption)', borderCollapse: 'collapse', marginBottom: 'var(--sp-3)' }}>
        <tbody>
          {Object.entries(action.args).map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: 'var(--text-3)', paddingRight: 'var(--sp-3)', verticalAlign: 'top' }}>{k}</td>
              <td style={{ color: tainted.has(k) ? 'var(--danger)' : 'var(--text-2)', fontWeight: tainted.has(k) ? 600 : 400 }}>
                {typeof v === 'string' ? v : JSON.stringify(v)}
                {tainted.has(k) ? ` — ${STRINGS.confirm.taintWarning(k)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {resolved ? (
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>
          {resolved === 'approved' ? '✓' : STRINGS.confirm.denied}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button onClick={() => respond(true)} style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
            {STRINGS.confirm.approve}
          </button>
          <button onClick={() => respond(false)} style={buttonStyle}>
            {STRINGS.confirm.deny}
          </button>
        </div>
      )}
    </div>
  );
}
