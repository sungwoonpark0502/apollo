import React, { useEffect, useRef, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { useStore } from '../../state/store';
import { CardShell, CardView } from '../../components/cards/CardView';

export function App(): React.JSX.Element {
  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const s = useStore();

  useEffect(() => {
    const off = window.apollo.on('agent.events', (e) => useStore.getState().applyEvent(e));
    return off;
  }, []);

  const submit = (): void => {
    const text = input.trim();
    if (!text || s.streaming) return;
    s.pushHistory(text);
    setHistoryIdx(null);
    setInput('');
    s.beginTurn();
    void window.apollo.call('agent.userMessage', { text, source: 'text', convId: s.convId });
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') window.close();
    else if (e.key === 'ArrowUp') {
      const h = s.inputHistory;
      if (h.length === 0) return;
      const idx = historyIdx === null ? h.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setInput(h[idx] ?? '');
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && historyIdx !== null) {
      const h = s.inputHistory;
      const idx = historyIdx + 1;
      if (idx >= h.length) {
        setHistoryIdx(null);
        setInput('');
      } else {
        setHistoryIdx(idx);
        setInput(h[idx] ?? '');
      }
      e.preventDefault();
    } else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      setInput('');
      s.reset();
      e.preventDefault();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: 'var(--sp-4)', gap: 'var(--sp-3)', maxHeight: '100vh' }}>
      <input
        ref={inputRef}
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={STRINGS.app.palettePlaceholder}
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

      {s.reply || s.streaming ? (
        <div style={{ padding: '0 var(--sp-2)', fontSize: 'var(--fs-body)', color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
          {s.reply}
          {s.streaming ? <span style={{ color: 'var(--text-3)' }}> ▌</span> : null}
        </div>
      ) : null}

      {s.errorCopy ? (
        <div style={{ padding: '0 var(--sp-2)', fontSize: 'var(--fs-body)', color: 'var(--danger)' }}>{s.errorCopy}</div>
      ) : null}

      {s.cards.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', overflowY: 'auto' }}>
          {s.cards.map(({ id, card }) => (
            <CardShell key={id}>
              <CardView card={card} />
            </CardShell>
          ))}
        </div>
      ) : null}
    </div>
  );
}
