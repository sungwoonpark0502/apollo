import React, { useCallback, useEffect, useRef, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { CardShell, CardView } from '../cards/CardView';
import { CancelWindowBar } from '../ConfirmBar';
import { isPinnedToBottom, usedToolNamespaces, visibleSlice, type ThreadItem, type ThreadState } from './threadModel';

const CONTENT_MAX_W = 720;

export interface ChatThreadProps {
  thread: ThreadState;
  showToolActivity: boolean;
  autoScroll: boolean;
  /** Per-message hover actions (11.4); rendered under assistant/user rows. */
  renderMessageActions?: (item: Extract<ThreadItem, { kind: 'msg' }>) => React.ReactNode;
  /** Full row override (11.4 inline edit); return null for the default rendering. */
  renderMessage?: (item: Extract<ThreadItem, { kind: 'msg' }>) => React.ReactNode | null;
  onCancelWindow?: (confirmationId: string) => void;
  /** Empty-state extras (greeting + example chips) rendered when there are no items. */
  emptyState?: React.ReactNode;
}

/**
 * K2 message thread: user rows right-aligned in an accent-soft bubble,
 * assistant rows plain on surface, cards inline at full content width,
 * streaming cursor, dim tool-activity line, auto-scroll with detach +
 * jump-to-latest, and windowed rendering for long threads.
 */
export function ChatThread({ thread, showToolActivity, autoScroll, renderMessageActions, renderMessage, onCancelWindow, emptyState }: ChatThreadProps): React.JSX.Element {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [pages, setPages] = useState(1);
  const [lastConvId, setLastConvId] = useState(thread.convId);

  // Reset windowing + pin when switching conversations (adjust-during-render).
  if (lastConvId !== thread.convId) {
    setLastConvId(thread.convId);
    setPages(1);
    setPinned(true);
  }
  const { hidden, visible } = visibleSlice(thread.items, pages);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(isPinnedToBottom(el));
  }, []);

  // Follow the stream while pinned (K2, honors chat.autoScroll).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll && pinned) el.scrollTop = el.scrollHeight;
  }, [thread.items, thread.activity, autoScroll, pinned]);

  const jumpToLatest = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setPinned(true);
  };

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-4)' }}>
        <div style={{ maxWidth: CONTENT_MAX_W, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {thread.items.length === 0 && emptyState ? emptyState : null}
          {hidden > 0 ? (
            <button onClick={() => setPages((p) => p + 1)} style={showEarlierStyle}>
              {STRINGS.workspace.chat.showEarlier(hidden)}
            </button>
          ) : null}
          {visible.map((item) => (
            <ThreadRow key={item.id} item={item} renderMessageActions={renderMessageActions} renderMessage={renderMessage} />
          ))}
          {showToolActivity && thread.activity ? (
            <div role="status" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', fontStyle: 'italic' }}>{thread.activity}</div>
          ) : null}
          {showToolActivity && !thread.streaming && thread.usedTools.length > 0 ? (
            <button onClick={() => setToolsExpanded((v) => !v)} style={usedChipStyle} aria-expanded={toolsExpanded}>
              {toolsExpanded
                ? thread.usedTools.map((t) => STRINGS.toolActivity(t).replace(/…$/, '')).join(' · ')
                : STRINGS.workspace.chat.usedTools(usedToolNamespaces(thread.usedTools))}
            </button>
          ) : null}
          {thread.streaming && !thread.activity && !visible.some((i) => i.kind === 'msg' && i.streaming && i.content !== '') ? (
            <div role="status" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', fontStyle: 'italic' }}>{STRINGS.workspace.chat.thinking}</div>
          ) : null}
          {thread.cancelWindow && onCancelWindow ? (
            <CancelWindowBar endsAt={thread.cancelWindow.endsAt} onCancel={() => onCancelWindow(thread.cancelWindow!.confirmationId)} />
          ) : null}
        </div>
      </div>
      {!pinned ? (
        <button onClick={jumpToLatest} style={jumpPillStyle}>
          ↓ {STRINGS.workspace.chat.jumpToLatest}
        </button>
      ) : null}
    </div>
  );
}

function ThreadRow({ item, renderMessageActions, renderMessage }: {
  item: ThreadItem;
  renderMessageActions?: (m: Extract<ThreadItem, { kind: 'msg' }>) => React.ReactNode;
  renderMessage?: (m: Extract<ThreadItem, { kind: 'msg' }>) => React.ReactNode | null;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  if (item.kind === 'card') {
    return (
      <CardShell>
        <CardView card={item.card} />
      </CardShell>
    );
  }
  if (item.kind === 'error') {
    return <div role="alert" style={{ fontSize: 'var(--fs-body)', color: 'var(--danger)' }}>{item.text}</div>;
  }
  const override = renderMessage?.(item);
  if (override) return <>{override}</>;
  const isUser = item.role === 'user';
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'stretch' }}>
      <div
        style={
          isUser
            ? { background: 'var(--accent-soft)', color: 'var(--text-1)', borderRadius: 'var(--radius-card)', padding: 'var(--sp-2) var(--sp-3)', maxWidth: '85%', whiteSpace: 'pre-wrap', fontSize: 'var(--fs-body)', lineHeight: 1.5 }
            : { color: 'var(--text-1)', whiteSpace: 'pre-wrap', fontSize: 'var(--fs-body)', lineHeight: 1.6 }
        }
      >
        {item.content}
        {item.streaming ? <span aria-hidden style={{ color: 'var(--text-3)' }}>▌</span> : null}
      </div>
      {renderMessageActions && hover && !item.streaming ? (
        <div style={{ marginTop: 2, display: 'flex', gap: 'var(--sp-2)', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>{renderMessageActions(item)}</div>
      ) : null}
    </div>
  );
}

const showEarlierStyle: React.CSSProperties = {
  alignSelf: 'center', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};

const usedChipStyle: React.CSSProperties = {
  alignSelf: 'flex-start', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)',
  borderRadius: 999, padding: '1px var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};

const jumpPillStyle: React.CSSProperties = {
  position: 'absolute', bottom: 'var(--sp-3)', left: '50%', transform: 'translateX(-50%)',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)',
  borderRadius: 999, padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-caption)',
  fontFamily: 'var(--font-sans)', boxShadow: 'var(--shadow-card)',
};
