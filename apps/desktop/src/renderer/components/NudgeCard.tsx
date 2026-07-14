import React from 'react';
import { type SuggestionDTO } from '@apollo/shared';
import { CardView } from './cards/CardView';

/**
 * F3 nudge presentation in the orb panel. A single suggestion or a grouped
 * digest, each with its action buttons. Actions route back through
 * suggestion.action; the card's optional rich payload renders via CardView.
 */
export function NudgeCard({ suggestion, onAction }: { suggestion: SuggestionDTO; onAction: (suggestionId: string, actionId: string) => void }): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-1)' }}>{suggestion.title}</div>
      {suggestion.body ? <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginTop: 2 }}>{suggestion.body}</div> : null}
      {suggestion.card ? (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <CardView card={suggestion.card} />
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        {suggestion.actions.map((a) => (
          <button
            key={a.id}
            onClick={() => onAction(suggestion.id, a.id)}
            style={a.kind === 'primary' ? primaryBtn : ghostBtn}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NudgeGroupCard({ suggestions, onAction }: { suggestions: SuggestionDTO[]; onAction: (suggestionId: string, actionId: string) => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {suggestions.map((s) => (
        <div key={s.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 'var(--sp-3)' }}>
          <NudgeCard suggestion={s} onAction={onAction} />
        </div>
      ))}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--accent)',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
const ghostBtn: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
