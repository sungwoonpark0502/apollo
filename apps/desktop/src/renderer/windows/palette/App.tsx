import React from 'react';

// Empty palette shell for milestone 0.1; input wiring and streaming land in 0.6.
export function App(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--sp-4)',
        gap: 'var(--sp-3)',
      }}
    >
      <input
        autoFocus
        placeholder="Ask Apollo…"
        style={{
          fontSize: 'var(--fs-title)',
          fontFamily: 'var(--font-sans)',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text-1)',
          padding: 'var(--sp-2)',
        }}
      />
    </div>
  );
}
