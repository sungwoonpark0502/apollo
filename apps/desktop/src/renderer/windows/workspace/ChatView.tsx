import React, { useCallback, useEffect, useRef, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';
import { ChatThread } from '../../components/chat/ChatThread';
import { Composer } from '../../components/chat/Composer';
import {
  applyAgentEvent,
  loadThread,
  syncPersisted,
  emptyThread,
  type PersistedMessage,
  type ThreadState,
} from '../../components/chat/threadModel';
import { ChatSidebar } from './ChatSidebar';

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
    });
  }, []);

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

  const name = settings?.profile.name ?? '';
  const emptyState = (
    <div style={{ textAlign: 'center', marginTop: '18vh' }}>
      <div style={{ fontSize: 'var(--fs-display)', color: 'var(--text-1)', marginBottom: 'var(--sp-4)' }}>
        {STRINGS.workspace.chat.emptyGreeting(name)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', justifyContent: 'center' }}>
        {STRINGS.workspace.chat.examples.map((ex) => (
          <button key={ex} onClick={() => setText(ex)} style={chipStyle}>
            {ex}
          </button>
        ))}
      </div>
    </div>
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
        <ChatThread
          thread={thread}
          showToolActivity={settings?.chat.showToolActivity ?? true}
          autoScroll={settings?.chat.autoScroll ?? true}
          onCancelWindow={() => onStop()}
          emptyState={emptyState}
        />
        <Composer
          sendOnEnter={settings?.chat.sendOnEnter ?? true}
          streaming={thread.streaming}
          inputHistory={inputHistory}
          onSend={onSend}
          onStop={onStop}
          degraded={degraded}
          text={text}
          onTextChange={setText}
        />
      </div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)',
  borderRadius: 999, padding: 'var(--sp-2) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
