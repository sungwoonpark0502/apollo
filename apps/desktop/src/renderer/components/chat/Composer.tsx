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
  /** Footer accessory (the model picker); rendered inside the card, by Send. */
  footerLeft?: React.ReactNode;
  /** Empty-state variant: the card floats mid-screen under the greeting. */
  hero?: boolean;
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
    <div style={{ padding: p.hero ? 0 : 'var(--sp-2) var(--sp-4) var(--sp-3)', background: 'transparent' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {p.degraded ? (
          <div role="status" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
            {p.degraded}
          </div>
        ) : null}
        {/* One rounded card holds everything — the textarea rides on top, the
            controls sit in a row inside the card, Claude-style. */}
        <div style={cardStyle}>
          <textarea
            ref={areaRef}
            value={p.text}
            rows={Math.max(p.hero ? 2 : 1, composerRows(p.text))}
            onChange={(e) => { p.onTextChange(e.target.value); if (recall.idx !== null) setRecall({ idx: null, draft: '' }); }}
            onKeyDown={onKeyDown}
            placeholder={p.hero ? STRINGS.workspace.chat.composerPlaceholderHero : STRINGS.workspace.chat.composerPlaceholder}
            style={textareaStyle}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '0 var(--sp-2) var(--sp-2)' }}>
            {p.mic ? (
              <button
                onClick={p.mic.state === 'unavailable' ? undefined : p.mic.onToggle}
                disabled={p.mic.state === 'unavailable'}
                title={p.mic.state === 'unavailable' ? STRINGS.workspace.chat.dictateUnavailable : p.mic.state === 'dictating' ? STRINGS.workspace.chat.dictating : STRINGS.workspace.chat.dictate}
                aria-label={STRINGS.workspace.chat.dictate}
                style={{ ...inlineBtn, color: p.mic.state === 'dictating' ? 'var(--accent)' : 'var(--text-2)', opacity: p.mic.state === 'unavailable' ? 0.4 : 1, cursor: p.mic.state === 'unavailable' ? 'not-allowed' : 'pointer' }}
              >
                ●
              </button>
            ) : null}
            <div style={{ flex: 1 }} />
            {p.footerLeft}
            {p.streaming ? (
              <button onClick={p.onStop} title={STRINGS.workspace.chat.stop} aria-label={STRINGS.workspace.chat.stop} style={{ ...sendStyle, background: 'var(--danger)' }}>
                ■
              </button>
            ) : (
              <button onClick={send} disabled={!p.text.trim()} title={STRINGS.workspace.chat.send} aria-label={STRINGS.workspace.chat.send} style={{ ...sendStyle, opacity: p.text.trim() ? 1 : 0.45, cursor: p.text.trim() ? 'pointer' : 'default' }}>
                ↑
              </button>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 'var(--sp-1)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          {p.sendOnEnter ? STRINGS.workspace.chat.sendHintEnter : STRINGS.workspace.chat.sendHintModEnter(isMac ? '⌘' : 'Ctrl')}
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20,
  boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column',
};

const textareaStyle: React.CSSProperties = {
  resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', lineHeight: 1.5,
  padding: 'var(--sp-3) var(--sp-4) var(--sp-2)', border: 'none', borderRadius: 20,
  background: 'transparent', color: 'var(--text-1)', outline: 'none',
};

const inlineBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent',
  fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};

const sendStyle: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--accent)', color: '#fff',
  fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};
