import React, { useEffect, useRef, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { useStore } from '../../state/store';
import { CardShell, CardView } from '../../components/cards/CardView';
import { ConfirmBar } from '../../components/ConfirmBar';
import { useFormatInit } from '../../lib/useLive';

export function App(): React.JSX.Element {
  useFormatInit();
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
    } else if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
      // H5: start a new conversation (backend rotates; palette clears its thread)
      setInput('');
      s.reset();
      void window.apollo.call('conversations.new', {}).catch(() => undefined);
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

      {s.streaming && (s.activity || !s.reply) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '0 var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
          <span>{s.activity ?? STRINGS.a11y.voiceState.thinking}</span>
          {s.turnId ? (
            <button
              onClick={() => { if (s.turnId) void window.apollo.call('agent.cancel', { turnId: s.turnId }); }}
              style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-1)', borderRadius: 'var(--radius-ctl)', padding: '0 var(--sp-2)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)' }}
            >
              {STRINGS.orbControls.cancel}
            </button>
          ) : null}
        </div>
      ) : null}

      {s.reply || s.streaming ? (
        <div style={{ padding: '0 var(--sp-2)', fontSize: 'var(--fs-body)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', position: 'relative' }}>
          {s.reply}
          {s.streaming ? <span style={{ color: 'var(--text-3)' }}> ▌</span> : null}
          {s.reply && !s.streaming ? (
            <button
              aria-label="Copy reply"
              title="Copy"
              onClick={() => void navigator.clipboard.writeText(s.reply)}
              style={{ marginLeft: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              ⧉
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmBar />

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
