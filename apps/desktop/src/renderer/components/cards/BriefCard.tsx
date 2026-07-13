import React from 'react';
import type { CardPayload } from '@apollo/shared';
import { CardView } from './CardView';

/** BriefCard (C18): a vertical stack of the sub-cards produced by brief.daily. */
export function BriefCard({ sections }: { sections: CardPayload[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {sections.map((s, i) => (
        <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)', paddingTop: i === 0 ? 0 : 'var(--sp-3)' }}>
          <CardView card={s} />
        </div>
      ))}
    </div>
  );
}
