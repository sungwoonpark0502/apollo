import React from 'react';
import { STRINGS } from '@apollo/shared';
import { buttonStyle } from './TimerCard';

/** I4 link preview: title, site name, 2-sentence summary, Open button. */
export function LinkPreviewCard({ url, title, summary, siteName }: { url: string; title: string; summary: string; siteName: string }): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{siteName}</div>
      <div style={{ fontSize: 'var(--fs-title)', fontWeight: 500, margin: 'var(--sp-1) 0' }}>{title}</div>
      {summary ? <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', marginBottom: 'var(--sp-3)' }}>{summary}</div> : null}
      <a href={url} target="_blank" rel="noreferrer" style={{ ...buttonStyle, display: 'inline-block', textDecoration: 'none' }}>
        {STRINGS.cards.open}
      </a>
    </div>
  );
}
