import React, { useState } from 'react';
import { fmtDateTime, STRINGS } from '@apollo/shared';
import { buttonStyle } from './TimerCard';

/** I7.4 conflict card: local vs remote for a synced event; Keep mine / theirs / both. */
export function SyncConflictCard({
  eventId,
  localTitle,
  localStart,
  remoteTitle,
  remoteStart,
}: {
  eventId: string;
  localTitle: string;
  localStart: number;
  remoteTitle: string;
  remoteStart: number;
}): React.JSX.Element {
  const [resolved, setResolved] = useState(false);
  const c = STRINGS.gcal.conflict;

  const resolve = (choice: 'mine' | 'theirs' | 'both'): void => {
    void window.apollo.call('google.resolveConflict', { eventId, choice }).then(() => setResolved(true));
  };

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>{c.title}</div>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{c.mine}</div>
          <div style={{ fontWeight: 500 }}>{localTitle}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{fmtDateTime(localStart, { dateStyle: 'weekday-date' })}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{c.theirs}</div>
          <div style={{ fontWeight: 500 }}>{remoteTitle}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{fmtDateTime(remoteStart, { dateStyle: 'weekday-date' })}</div>
        </div>
      </div>
      {resolved ? (
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>{c.resolved}</div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button onClick={() => resolve('mine')} style={buttonStyle}>{c.keepMine}</button>
          <button onClick={() => resolve('theirs')} style={buttonStyle}>{c.keepTheirs}</button>
          <button onClick={() => resolve('both')} style={buttonStyle}>{c.keepBoth}</button>
        </div>
      )}
    </div>
  );
}
