import React, { useState } from 'react';
import { fireControl } from '../../lib/controlDispatch';
import { fmtDate, STRINGS, type RecallItem } from '@apollo/shared';

const KIND_ICON: Record<RecallItem['kind'], string> = { note: '📝', message: '💬', fact: '🧠' };

/** G4 recall results: kind icon + title + snippet + date. Note rows deep-link to
 *  the Workspace notes view; message/fact rows expand inline. */
export function RecallListCard({ items }: { items: RecallItem[] }): React.JSX.Element {
  if (items.length === 0) return <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)' }}>{STRINGS.recall.empty}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {STRINGS.recall.title}
      </div>
      {items.map((it) => (
        <RecallRow key={it.chunkId} item={it} />
      ))}
    </div>
  );
}

function RecallRow({ item }: { item: RecallItem }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const date = fmtDate(item.ts, 'date');

  const onClick = (): void => {
    if (item.kind === 'note') {
      void fireControl('recall.openNote', { noteId: item.refId });
    } else {
      setExpanded((v) => !v);
    }
  };

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start', textAlign: 'left',
        background: 'transparent', border: 'none', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2)',
        cursor: 'pointer', width: '100%',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: '20px' }}>{KIND_ICON[item.kind]}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
          <span style={{ fontWeight: 500, color: 'var(--text-1)', fontSize: 'var(--fs-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', flexShrink: 0 }}>{date}</span>
        </span>
        <span
          style={{
            display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginTop: 2,
            ...(expanded ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          }}
        >
          {item.snippet}
        </span>
      </span>
    </button>
  );
}
