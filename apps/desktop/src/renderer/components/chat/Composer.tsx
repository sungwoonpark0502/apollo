import React, { useRef, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { composerKeyAction, composerRows, recallStep, type HistoryRecallState } from './composerModel';

export interface ComposerProps {
  sendOnEnter: boolean;
  streaming: boolean;
  inputHistory: readonly string[];
  onSend: (text: string) => void;
  onStop: () => void;
  /** 11.5 dictation-into-composer; absent = mic hidden, disabled = keyless tooltip. */
  mic?: { state: 'idle' | 'dictating' | 'unavailable'; onToggle: () => void };
  /** Degraded-state banner text (missing keys / offline); null = healthy. */
  degraded?: string | null;
  /** Controlled text override (dictation streams into the composer). */
  text: string;
  onTextChange: (text: string) => void;
  /** Footer accessory (the model picker); rendered left of the send hint. */
  footerLeft?: React.ReactNode;
}

/**
 * K2 composer: sticky bottom, auto-growing 1–8 rows, Enter/Shift+Enter per
 * sendOnEnter (hint line shows the active binding), up-arrow history recall,
 * mic on the left, Send/Stop on the right.
 */
export function Composer(p: ComposerProps): React.JSX.Element {
  const [recall, setRecall] = useState<HistoryRecallState>({ idx: null, draft: '' });
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const isMac = navigator.platform.toUpperCase().includes('MAC');

  const send = (): void => {
    const text = p.text.trim();
    if (!text || p.streaming) return;
    setRecall({ idx: null, draft: '' });
    p.onSend(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const action = composerKeyAction(
      { key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing },
      { sendOnEnter: p.sendOnEnter, empty: p.text === '', recalling: recall.idx !== null },
    );
    if (action === 'send') {
      e.preventDefault();
      send();
    } else if (action === 'historyPrev' || action === 'historyNext') {
      e.preventDefault();
      const r = recallStep(p.inputHistory, recall, action === 'historyPrev' ? 'prev' : 'next', p.text);
      setRecall(r.state);
      p.onTextChange(r.text);
    }
    // 'newline' falls through to the textarea default
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {p.degraded ? (
          <div role="status" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
            {p.degraded}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)' }}>
          {p.mic ? (
            <button
              onClick={p.mic.state === 'unavailable' ? undefined : p.mic.onToggle}
              disabled={p.mic.state === 'unavailable'}
              title={p.mic.state === 'unavailable' ? STRINGS.workspace.chat.dictateUnavailable : p.mic.state === 'dictating' ? STRINGS.workspace.chat.dictating : STRINGS.workspace.chat.dictate}
              aria-label={STRINGS.workspace.chat.dictate}
              style={{ ...roundBtn, color: p.mic.state === 'dictating' ? 'var(--accent)' : 'var(--text-2)', opacity: p.mic.state === 'unavailable' ? 0.4 : 1, cursor: p.mic.state === 'unavailable' ? 'not-allowed' : 'pointer' }}
            >
              ●
            </button>
          ) : null}
          <textarea
            ref={areaRef}
            value={p.text}
            rows={composerRows(p.text)}
            onChange={(e) => { p.onTextChange(e.target.value); if (recall.idx !== null) setRecall({ idx: null, draft: '' }); }}
            onKeyDown={onKeyDown}
            placeholder={STRINGS.workspace.chat.composerPlaceholder}
            style={textareaStyle}
          />
          {p.streaming ? (
            <button onClick={p.onStop} title={STRINGS.workspace.chat.stop} aria-label={STRINGS.workspace.chat.stop} style={{ ...roundBtn, color: 'var(--danger)' }}>
              ■
            </button>
          ) : (
            <button onClick={send} disabled={!p.text.trim()} title={STRINGS.workspace.chat.send} aria-label={STRINGS.workspace.chat.send} style={{ ...roundBtn, color: p.text.trim() ? 'var(--accent)' : 'var(--text-3)', cursor: p.text.trim() ? 'pointer' : 'default' }}>
              ➤
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginTop: 'var(--sp-1)' }}>
          {p.footerLeft}
          <div style={{ flex: 1, textAlign: 'right', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
            {p.sendOnEnter ? STRINGS.workspace.chat.sendHintEnter : STRINGS.workspace.chat.sendHintModEnter(isMac ? '⌘' : 'Ctrl')}
          </div>
        </div>
      </div>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  flex: 1, resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', lineHeight: 1.5,
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
  background: 'var(--surface)', color: 'var(--text-1)', outline: 'none',
};

const roundBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface)',
  fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};
