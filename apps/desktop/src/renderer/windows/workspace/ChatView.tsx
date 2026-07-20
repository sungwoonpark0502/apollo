import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { STRINGS, type Settings } from '@apollo/shared';
import { ChatThread } from '../../components/chat/ChatThread';
import { Composer } from '../../components/chat/Composer';
import { ModelPicker } from '../../components/chat/ModelPicker';
import {
  applyAgentEvent,
  loadThread,
  syncPersisted,
  emptyThread,
  truncateFrom,
  type PersistedMessage,
  type ThreadItem,
  type ThreadState,
} from '../../components/chat/threadModel';
import { ChatSidebar } from './ChatSidebar';

type MsgItem = Extract<ThreadItem, { kind: 'msg' }>;

export interface ChatViewProps {
  settings: Settings | null;
  /** Deep-link target conversation (K3 "Open in chat"). */
  initialConvId?: string;
}

/**
 * K2 Chat tab: conversation sidebar + message thread + composer. Dispatches
 * through chat.send (the identical one-brain agent path as voice) and follows
 * live turns via agent.events — a voice exchange appears here in real time.
 */
export function ChatView({ settings, initialConvId }: ChatViewProps): React.JSX.Element {
  const [thread, setThread] = useState<ThreadState>(emptyThread());
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [degraded, setDegraded] = useState<string | null>(null);
  const [sidebarTick, setSidebarTick] = useState(0); // bump to refresh the conversation list
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [micState, setMicState] = useState<'idle' | 'dictating' | 'unavailable'>('idle');
  const dictBaseRef = useRef('');
  const threadRef = useRef(thread);
  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const fetchMessages = useCallback(async (convId: string): Promise<PersistedMessage[]> => {
    const r = await window.apollo.call('conversations.get', { id: convId });
    return r.messages;
  }, []);

  const openConversation = useCallback(
    async (convId: string, setActive: boolean): Promise<void> => {
      if (setActive) await window.apollo.call('conversations.setActive', { id: convId });
      const messages = await fetchMessages(convId).catch(() => []);
      setThread(loadThread(convId, messages));
    },
    [fetchMessages],
  );

  // Initial load: deep-link target or the shared active conversation (H5/K2).
  useEffect(() => {
    void (async () => {
      if (initialConvId) {
        await openConversation(initialConvId, true);
      } else {
        const { id } = await window.apollo.call('conversations.active', {});
        if (id) await openConversation(id, false);
      }
    })();
  }, [initialConvId, openConversation]);

  // I6-style degradation notice: name what is limited instead of failing silently.
  useEffect(() => {
    void window.apollo.call('keys.info', {}).then((info) => {
      const has = (p: string): boolean => info.some((k) => k.provider === p && k.configured);
      setDegraded(has('anthropic') ? null : STRINGS.workspace.chat.degradedBanner(STRINGS.workspace.chat.degradedLlm));
      if (!has('deepgram')) setMicState('unavailable'); // K2: disabled mic with tooltip
    });
  }, []);

  // K2 dictation stream: transcripts land in the composer, never auto-send.
  useEffect(() => {
    const off = window.apollo.on('dictation.text', ({ text: t, final }) => {
      const base = dictBaseRef.current;
      const joined = base ? `${base}${base.endsWith(' ') ? '' : ' '}${t}` : t;
      setText(final ? `${joined} ` : joined);
      if (final) setMicState((m) => (m === 'dictating' ? 'idle' : m));
    });
    return off;
  }, []);

  const toggleDictation = (): void => {
    if (micState === 'dictating') {
      void window.apollo.call('dictation.stop', {});
      setMicState('idle');
      return;
    }
    dictBaseRef.current = text;
    void window.apollo.call('dictation.start', {}).then(({ ok }) => setMicState(ok ? 'dictating' : 'unavailable'));
  };

  // Live agent events: the shared thread follows voice and typed turns alike.
  useEffect(() => {
    const off = window.apollo.on('agent.events', (e) => {
      const cur = threadRef.current;
      const r = applyAgentEvent(cur, e, (tool) => STRINGS.toolActivity(tool));
      if (r.needsSwitch) {
        // The turn belongs to another conversation (voice rotated or a new chat):
        // load it, then re-apply this event on the fresh thread.
        void fetchMessages(r.needsSwitch)
          .catch(() => [] as PersistedMessage[])
          .then((messages) => {
            const loaded = loadThread(e.type === 'turnStart' ? e.convId : r.needsSwitch!, messages);
            const r2 = applyAgentEvent(loaded, e, (tool) => STRINGS.toolActivity(tool));
            setThread(r2.state);
          });
        return;
      }
      setThread(r.state);
      if (r.needsSync && cur.convId) {
        const convId = cur.convId;
        void fetchMessages(convId).then((messages) => {
          setThread((s) => (s.convId === convId ? syncPersisted(s, messages) : s));
          setSidebarTick((t) => t + 1); // list order/titles may have changed
        });
      }
    });
    return off;
  }, [fetchMessages]);

  const onSend = (t: string): void => {
    setInputHistory((h) => [...h.filter((x) => x !== t), t].slice(-50));
    setText('');
    void window.apollo.call('chat.send', { text: t, convId: thread.convId ?? '' });
  };

  const onStop = (): void => {
    if (thread.turnId) void window.apollo.call('chat.stop', { turnId: thread.turnId });
  };

  const onNewChat = (): void => {
    void window.apollo.call('conversations.new', {}).then(({ id }) => {
      setThread(loadThread(id, []));
      setSidebarTick((t) => t + 1);
    });
  };

  // ---- K2 per-message actions (11.4) ----
  const isPersisted = (id: string): boolean => !id.startsWith('local-') && !id.startsWith('card-') && !id.startsWith('err-');
  const lastAssistantId = [...thread.items].reverse().find((i): i is MsgItem => i.kind === 'msg' && i.role === 'assistant')?.id;

  const copyMessage = (m: MsgItem): void => {
    void navigator.clipboard.writeText(m.content).then(() => {
      setCopiedId(m.id);
      window.setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1500);
    });
  };

  const regenerate = (m: MsgItem): void => {
    if (!thread.convId || !isPersisted(m.id)) return;
    setThread((s) => truncateFrom(s, m.id)); // optimistic; the new turn streams in
    void window.apollo.call('chat.regenerate', { convId: thread.convId, messageId: m.id });
  };

  const saveEdit = (): void => {
    if (!editing || !thread.convId) return;
    const { id, text: newText } = editing;
    const trimmed = newText.trim();
    setEditing(null);
    if (!trimmed) return;
    setThread((s) => truncateFrom(s, id));
    void window.apollo.call('chat.editAndResend', { convId: thread.convId, messageId: id, newText: trimmed });
  };

  const speakThis = (m: MsgItem): void => {
    void window.apollo.call('tts.speak', { text: m.content });
  };

  const c = STRINGS.workspace.chat;
  // Icon affordances rather than a row of words: the labels survive as tooltips
  // and aria-labels, so nothing is lost for screen readers or keyboard users.
  const renderMessageActions = (m: MsgItem): React.ReactNode => (
    <>
      {m.role === 'assistant' ? (
        <button style={actionBtn} onClick={() => copyMessage(m)} title={copiedId === m.id ? c.copied : c.copy} aria-label={c.copy}>
          <Icon name="copy" size={15} />
        </button>
      ) : null}
      <button style={actionBtn} onClick={() => speakThis(m)} title={c.speakThis} aria-label={c.speakThis}>
        <Icon name="speak" size={15} />
      </button>
      {m.role === 'assistant' && m.id === lastAssistantId && isPersisted(m.id) && !thread.streaming ? (
        <button style={actionBtn} onClick={() => regenerate(m)} title={c.regenerate} aria-label={c.regenerate}>
          <Icon name="retry" size={15} />
        </button>
      ) : null}
      {m.role === 'user' && isPersisted(m.id) && !thread.streaming ? (
        <button style={actionBtn} onClick={() => setEditing({ id: m.id, text: m.content })} title={c.edit} aria-label={c.edit}>
          <Icon name="edit" size={15} />
        </button>
      ) : null}
    </>
  );

  const renderMessage = (m: MsgItem): React.ReactNode | null => {
    if (!editing || editing.id !== m.id) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', alignItems: 'flex-end' }}>
        <textarea
          autoFocus
          value={editing.text}
          onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
            else if (e.key === 'Escape') setEditing(null);
          }}
          rows={Math.min(8, editing.text.split('\n').length + 1)}
          style={editAreaStyle}
        />
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{c.editDiscardNote}</span>
          <button style={actionBtn} onClick={saveEdit}>{c.editSave}</button>
          <button style={actionBtn} onClick={() => setEditing(null)}>{c.editCancel}</button>
        </div>
      </div>
    );
  };

  const name = settings?.profile.name ?? '';
  const heroGreeting = (
    <div style={{ textAlign: 'center' }}>
      <div style={heroHeadingStyle}>
        <span className="apollo-spark" aria-hidden="true" style={{ fontSize: '0.85em' }}>
          ✳
        </span>
        <span>{STRINGS.workspace.chat.emptyGreeting(name)}</span>
      </div>
    </div>
  );

  const exampleChips = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', justifyContent: 'center', marginTop: 'var(--sp-3)' }}>
      {STRINGS.workspace.chat.examples.map((ex) => (
        <button key={ex} onClick={() => setText(ex)} style={chipStyle}>
          {ex}
        </button>
      ))}
    </div>
  );

  // The composer is built once and placed by the branch below, so switching out
  // of the hero on first send never remounts it (draft text and history recall
  // would be lost mid-turn).
  const isEmpty = thread.items.length === 0 && !thread.streaming;
  const composer = (
    <Composer
      sendOnEnter={settings?.chat.sendOnEnter ?? true}
      streaming={thread.streaming}
      inputHistory={inputHistory}
      onSend={onSend}
      onStop={onStop}
      mic={{ state: micState, onToggle: toggleDictation }}
      degraded={degraded}
      text={text}
      onTextChange={setText}
      hero={isEmpty}
      footerLeft={settings ? <ModelPicker settings={settings} onPatch={(next) => void window.apollo.call('settings.set', next)} /> : null}
    />
  );

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', minHeight: 0 }}>
      <ChatSidebar
        activeConvId={thread.convId}
        historyEnabled={settings?.history.enabled ?? true}
        refreshTick={sidebarTick}
        onNewChat={onNewChat}
        onSelect={(id) => void openConversation(id, true)}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {isEmpty ? (
          // Hero: greeting and composer sit together in the middle of the pane,
          // rather than a greeting stranded above a docked composer bar.
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'var(--sp-6) var(--sp-4)', overflowY: 'auto' }}>
            {heroGreeting}
            <div style={{ marginTop: 'var(--sp-5)' }}>{composer}</div>
            {exampleChips}
          </div>
        ) : (
          <>
            <ChatThread
              thread={thread}
              showToolActivity={settings?.chat.showToolActivity ?? true}
              autoScroll={settings?.chat.autoScroll ?? true}
              renderMessageActions={renderMessageActions}
              renderMessage={renderMessage}
              onCancelWindow={() => onStop()}
              emptyState={null}
            />
            {composer}
          </>
        )}
      </div>
    </div>
  );
}

const heroHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 400,
  color: 'var(--text-1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 'var(--sp-3)', lineHeight: 1.15,
};

const chipStyle: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)',
  borderRadius: 999, padding: 'var(--sp-2) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};

const actionBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 'var(--radius-ctl)', padding: 0,
};

const editAreaStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  lineHeight: 1.5, padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-card)',
  background: 'var(--surface)', color: 'var(--text-1)', outline: 'none',
};
