import React from 'react';

export function TextCard({ body }: { body: string }): React.JSX.Element {
  return <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{body}</div>;
}
