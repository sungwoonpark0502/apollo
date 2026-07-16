import React, { useEffect, useMemo, useState } from 'react';
import { fmtDateTime, STRINGS } from '@apollo/shared';

interface ConvSummary { id: string; title: string; startedAt: number; lastTs: number; messageCount: number }
interface Msg { role: 'user' | 'assistant'; content: string; ts: number }

/** H5 Chats view: left conversation list (filterable), right read-only transcript. */
export function ChatsView(): React.JSX.Element {
  const [list, setList] = useState<ConvSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);

  const refresh = (): void => {
    void window.apollo.call('conversations.list', { limit: 100 }).then(setList);
  };
  useEffect(refresh, []);

  useEffect(() => {
    if (!selected) return;
    void window.apollo.call('conversations.get', { id: selected }).then((r) => setMessages(r.messages));
  }, [selected]);

  const shownMessages = selected ? messages : [];

  const filtered = useMemo(
    () => (filter.trim() ? list.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase())) : list),
    [list, filter],
  );

  const del = (id: string): void => {
    if (!window.confirm(STRINGS.workspace.chats.deleteConfirm)) return;
    void window.apollo.call('conversations.delete', { id }).then(() => {
      if (selected === id) setSelected(null);
      refresh();
    });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 280, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={STRINGS.workspace.chats.filter}
          style={{ margin: 'var(--sp-3)', padding: 'var(--sp-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', background: 'var(--surface)', color: 'var(--text-1)', outline: 'none' }}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 'var(--sp-4)', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>{STRINGS.workspace.chats.empty}</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', padding: 'var(--sp-3)', background: selected === c.id ? 'var(--accent-soft)' : 'transparent' }}
              >
                <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{fmtDateTime(c.lastTs, { dateStyle: 'weekday-date' })} · {c.messageCount}</div>
              </button>
            ))
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', padding: 'var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => void window.apollo.call('conversations.setActive', { id: selected })} style={pillBtn}>{STRINGS.workspace.chats.continue}</button>
              <button onClick={() => del(selected)} style={{ ...pillBtn, color: 'var(--danger)' }}>{STRINGS.workspace.chats.delete}</button>
            </div>
            <div style={{ overflowY: 'auto', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {shownMessages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 2 }}>{m.role}</div>
                  <div style={{ padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-card)', background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ margin: 'auto', color: 'var(--text-3)' }}>{STRINGS.workspace.chats.selectHint}</div>
        )}
      </div>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  fontSize: 'var(--fs-caption)', padding: 'var(--sp-1) var(--sp-3)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer',
};
