import { Icon } from '../../components/Icon';
import React, { useEffect, useRef, useState } from 'react';
import { fmtRelative, STRINGS } from '@apollo/shared';
import { filterConversations, groupConversations, type ConversationSummary } from '../../components/chat/sidebarModel';

export type { ConversationSummary };

export interface ChatSidebarProps {
  activeConvId: string | null;
  historyEnabled: boolean;
  /** Bumped by the view when list order/titles may have changed. */
  refreshTick: number;
  onNewChat: () => void;
  onSelect: (id: string) => void;
}

const COLLAPSE_KEY = 'apollo.chat.sidebarCollapsed';

/**
 * K2 conversation sidebar: New chat, filter, grouped list (Pinned/Today/
 * Yesterday/Previous 7 days/Older), per-row Rename/Pin/Delete, collapsible
 * (persisted), and the history-disabled notice.
 */
export function ChatSidebar({ activeConvId, historyEnabled, refreshTick, onNewChat, onSelect }: ChatSidebarProps): React.JSX.Element {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reload = (): void => {
    void window.apollo.call('conversations.list', { limit: 100 }).then(setConversations);
  };

  useEffect(() => {
    if (historyEnabled) reload();
  }, [historyEnabled, refreshTick, activeConvId]);

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  const s = STRINGS.workspace.chat;

  if (collapsed) {
    return (
      <aside style={{ width: 44, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 'var(--sp-3)', gap: 'var(--sp-2)' }}>
        <button onClick={toggleCollapsed} title={s.expandSidebar} aria-label={s.expandSidebar} style={iconBtn}>»</button>
        <button onClick={onNewChat} title={s.newChat} aria-label={s.newChat} style={iconBtn}>+</button>
      </aside>
    );
  }

  const rename = (id: string, title: string): void => {
    void window.apollo.call('conversations.rename', { id, title }).then(() => {
      setRenaming(null);
      reload();
    });
  };
  const setPinned = (id: string, pinned: boolean): void => {
    void window.apollo.call('conversations.pin', { id, pinned }).then(reload);
  };
  const del = (id: string): void => {
    void window.apollo.call('conversations.delete', { id }).then(() => {
      setConfirmDelete(null);
      reload();
    });
  };

  const groups = groupConversations(filterConversations(conversations, filter));

  return (
    <aside style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', padding: 'var(--sp-3) var(--sp-3) var(--sp-2)' }}>
        <button onClick={onNewChat} style={newChatStyle}>+ {s.newChat}</button>
        <button onClick={toggleCollapsed} title={s.collapseSidebar} aria-label={s.collapseSidebar} style={iconBtn}>«</button>
      </div>
      {!historyEnabled ? (
        <div style={{ padding: 'var(--sp-3)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', lineHeight: 1.5 }}>
          {s.historyDisabled}
          <button onClick={() => void window.apollo.call('settings.open', {})} style={linkStyle}>{s.historyDisabledLink}</button>
        </div>
      ) : (
        <>
          <div style={{ padding: '0 var(--sp-3) var(--sp-2)' }}>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={STRINGS.workspace.chats.filter} aria-label={STRINGS.workspace.chats.filter} style={filterStyle} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--sp-2) var(--sp-3)' }}>
            {groups.length === 0 ? (
              <div style={{ padding: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{STRINGS.workspace.chats.empty}</div>
            ) : null}
            {groups.map((g) => (
              <div key={g.label}>
                <div style={groupLabelStyle}>{g.label}</div>
                {g.conversations.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      position: 'relative',
                      // The highlight belongs to the whole row. It used to live on
                      // the button alone, which excluded the timestamp line below
                      // and left the pill visibly clipped at the bottom.
                      background: c.id === activeConvId ? 'var(--accent-soft)' : 'transparent',
                      borderRadius: 'var(--radius-ctl)',
                      padding: 'var(--sp-1) 0',
                      marginBottom: 2,
                    }}
                  >
                    {renaming?.id === c.id ? (
                      <input
                        autoFocus
                        value={renaming.title}
                        aria-label={s.renamePrompt}
                        onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') rename(c.id, renaming.title);
                          else if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => setRenaming(null)}
                        style={{ ...filterStyle, margin: 'var(--sp-1) 0' }}
                      />
                    ) : (
                      <button
                        onClick={() => onSelect(c.id)}
                        onContextMenu={(e) => { e.preventDefault(); setMenuFor(c.id); }}
                        aria-current={c.id === activeConvId ? 'true' : undefined}
                        style={rowStyle}
                      >
                        {c.pinned ? (
                          <span style={{ color: 'var(--accent)', display: 'flex' }} title={s.groupPinned}>
                            <Icon name="pin" size={13} filled />
                          </span>
                        ) : null}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                          {c.title}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={s.rowMenu}
                          onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === c.id ? null : c.id); }}
                          style={{ color: 'var(--text-3)', padding: '0 var(--sp-1)' }}
                        >
                          ⋯
                        </span>
                      </button>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '0 var(--sp-2)' }}>
                      {/* Just the time. A message count is bookkeeping the user
                          never asked for and cannot act on. */}
                      {fmtRelative(c.lastTs)}
                    </div>
                    {menuFor === c.id ? (
                      <div ref={menuRef} style={menuStyle}>
                        <button style={menuItem} onClick={() => { setMenuFor(null); setRenaming({ id: c.id, title: c.title }); }}>{s.rename}</button>
                        <button style={menuItem} onClick={() => { setMenuFor(null); setPinned(c.id, !c.pinned); }}>{c.pinned ? s.unpin : s.pin}</button>
                        <button style={{ ...menuItem, color: 'var(--danger)' }} onClick={() => { setMenuFor(null); setConfirmDelete(c.id); }}>{STRINGS.workspace.chats.delete}</button>
                      </div>
                    ) : null}
                    {confirmDelete === c.id ? (
                      <div style={{ padding: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
                        {STRINGS.workspace.chats.deleteConfirm}
                        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
                          <button style={{ ...menuItem, color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)' }} onClick={() => del(c.id)}>{STRINGS.workspace.chats.delete}</button>
                          <button style={{ ...menuItem, border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)' }} onClick={() => setConfirmDelete(null)}>{STRINGS.gcal.cancel}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

const newChatStyle: React.CSSProperties = {
  flex: 1, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)',
  borderRadius: 'var(--radius-ctl)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', flexShrink: 0,
};

const filterStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-caption)',
  padding: 'var(--sp-1) var(--sp-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};

const groupLabelStyle: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-2) var(--sp-1)', fontSize: 10, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

const rowStyle: React.CSSProperties = {
  display: 'flex', width: '100%', alignItems: 'center', gap: 'var(--sp-1)',
  border: 'none', cursor: 'pointer', padding: '2px var(--sp-2)', borderRadius: 'var(--radius-ctl)',
  color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)', background: 'transparent',
};

const menuStyle: React.CSSProperties = {
  position: 'absolute', right: 4, top: 26, zIndex: 20, background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', boxShadow: 'var(--shadow-card)',
  display: 'flex', flexDirection: 'column', minWidth: 120,
};

const menuItem: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--text-1)', textAlign: 'left',
  padding: 'var(--sp-1) var(--sp-2)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};

const linkStyle: React.CSSProperties = {
  display: 'block', marginTop: 'var(--sp-2)', border: 'none', background: 'transparent', color: 'var(--accent)',
  cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', padding: 0,
};
