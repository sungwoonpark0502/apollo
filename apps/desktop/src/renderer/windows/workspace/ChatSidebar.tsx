import React, { useEffect, useState } from 'react';
import { STRINGS } from '@apollo/shared';

export interface ConversationSummary {
  id: string;
  title: string;
  startedAt: number;
  lastTs: number;
  messageCount: number;
  pinned: boolean;
}

export interface ChatSidebarProps {
  activeConvId: string | null;
  historyEnabled: boolean;
  /** Bumped by the view when list order/titles may have changed. */
  refreshTick: number;
  onNewChat: () => void;
  onSelect: (id: string) => void;
}

/** K2 conversation sidebar (11.2 core: new chat + list + select; 11.3 adds grouping/filter/rename/delete/pin). */
export function ChatSidebar({ activeConvId, historyEnabled, refreshTick, onNewChat, onSelect }: ChatSidebarProps): React.JSX.Element {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    if (!historyEnabled) return;
    void window.apollo.call('conversations.list', { limit: 100 }).then(setConversations);
  }, [historyEnabled, refreshTick, activeConvId]);

  return (
    <aside style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 'var(--sp-3)' }}>
        <button onClick={onNewChat} style={newChatStyle}>
          + {STRINGS.workspace.chat.newChat}
        </button>
      </div>
      {!historyEnabled ? (
        <div style={{ padding: 'var(--sp-3)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', lineHeight: 1.5 }}>
          {STRINGS.workspace.chat.historyDisabled}
          <button onClick={() => void window.apollo.call('settings.open', {})} style={linkStyle}>
            {STRINGS.workspace.chat.historyDisabledLink}
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--sp-2) var(--sp-3)' }}>
          {conversations.length === 0 ? (
            <div style={{ padding: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{STRINGS.workspace.chats.empty}</div>
          ) : null}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeConvId ? 'true' : undefined}
              style={{ ...rowStyle, background: c.id === activeConvId ? 'var(--accent-soft)' : 'transparent' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

const newChatStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 'var(--sp-2)',
  border: 'none', cursor: 'pointer', padding: 'var(--sp-2)', borderRadius: 'var(--radius-ctl)',
  color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};

const linkStyle: React.CSSProperties = {
  display: 'block', marginTop: 'var(--sp-2)', border: 'none', background: 'transparent', color: 'var(--accent)',
  cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', padding: 0,
};
