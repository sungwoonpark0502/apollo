import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolveModelChoice, type AvailableModels, type LlmProviderId } from '@apollo/shared';
import { chatTurn, fetchModels } from './api';
import {
  appendMessage,
  deleteConversation,
  loadConversations,
  replaceLastAssistant,
  saveConversations,
  titleFor,
  type WebConversation,
} from './chatStore';

/**
 * The web chat surface: sidebar of browser-local conversations, streamed
 * replies, provider/model picker. Deliberately chat-only — notes, calendar,
 * voice, and every tool live on the device with the desktop app, and v1 says
 * so in the header rather than half-implying otherwise.
 */
const SYSTEM = `You are Apollo, a personal assistant, currently running in a web browser.

Replies: plain language, tight, no corporate tone, no filler like "Certainly!".

You have NO tools in this session: no access to the user's notes, calendar, reminders, files, email, or the web. If asked for those, say the Apollo desktop app handles them, in one clause, and answer what you can from the conversation itself. Never invent the contents of the user's data.`;

export function ChatApp({ user, onSignedOut }: { user: { name: string; email: string; plan: string }; onSignedOut: () => void }): React.JSX.Element {
  const [convs, setConvs] = useState<WebConversation[]>(() => loadConversations(localStorage));
  const [activeId, setActiveId] = useState<string | null>(convs[0]?.id ?? null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [models, setModels] = useState<AvailableModels>({ providers: [] });
  const [choice, setChoice] = useState<{ provider: LlmProviderId; model: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Chrome-extension deep link: /?q=… prefills the composer. Prefill ONLY —
  // auto-sending would let any page a user clicks from spend their quota.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) {
      setDraft(q.slice(0, 4000));
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    void fetchModels().then((m) => {
      setModels(m);
      const first = m.providers[0];
      if (first) setChoice({ provider: first.id, model: first.defaultModel });
    });
  }, []);

  useEffect(() => {
    saveConversations(localStorage, convs);
  }, [convs]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [convs, activeId]);

  const active = useMemo(() => convs.find((c) => c.id === activeId) ?? null, [convs, activeId]);

  const send = (): void => {
    const text = draft.trim();
    if (!text || streaming || !choice) return;
    const convId = activeId ?? crypto.randomUUID();
    setActiveId(convId);
    setDraft('');
    setNotice(null);

    // Optimistic user row + empty assistant row that streaming fills in.
    let next = appendMessage(convs, convId, { role: 'user', text }, Date.now());
    const history = next.find((c) => c.id === convId)!.messages;
    next = appendMessage(next, convId, { role: 'assistant', text: '' }, Date.now());
    setConvs(next);
    setStreaming(true);

    let streamed = '';
    void chatTurn({
      system: SYSTEM,
      messages: history.map((m) => ({ role: m.role, content: [{ type: 'text' as const, text: m.text }] })),
      ...resolveModelChoice(choice.provider, choice.model),
      onText: (delta) => {
        streamed += delta;
        setConvs((cs) => replaceLastAssistant(cs, convId, streamed));
      },
    }).then((res) => {
      setStreaming(false);
      if (!res.ok) {
        const msg =
          res.error === 'auth' ? 'Your session expired. Sign in again.' :
          res.error === 'quota' ? "You've used this period's requests." :
          'Apollo is unreachable right now. Your message is kept below.';
        setNotice(msg);
        setConvs((cs) => replaceLastAssistant(cs, convId, streamed || '…'));
        if (res.error === 'auth') onSignedOut();
      }
    });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: 'var(--sp-3)' }}>
        <button onClick={() => setActiveId(null)} style={newChatBtn}>New chat</button>
        <div style={{ flex: 1, overflowY: 'auto', marginTop: 'var(--sp-3)' }}>
          {convs.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => setActiveId(c.id)}
                style={{ ...convRow, background: c.id === activeId ? 'var(--accent-soft)' : 'transparent' }}
              >
                {titleFor(c)}
              </button>
              <button
                aria-label="Delete conversation"
                onClick={() => {
                  setConvs((cs) => deleteConversation(cs, c.id));
                  if (activeId === c.id) setActiveId(null);
                }}
                style={deleteBtn}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          History stays in this browser.
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ padding: 'var(--sp-3) var(--sp-4)', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          Chat, notes, and calendar follow your account. Voice and your local files live in the desktop app.
        </header>

        <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-4)' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {!active || active.messages.length === 0 ? (
              <p style={{ color: 'var(--text-3)', textAlign: 'center', marginTop: 'var(--sp-6)' }}>
                {user.name ? `Hi ${user.name}. ` : ''}Ask anything to start.
              </p>
            ) : (
              active.messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 'var(--sp-3)' }}>
                  <div style={m.role === 'user' ? userBubble : assistantBubble}>
                    {m.text || (streaming && i === active.messages.length - 1 ? '…' : m.text)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <footer style={{ borderTop: '1px solid var(--border)', padding: 'var(--sp-3) var(--sp-4)' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {notice ? (
              <div role="status" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
                {notice}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Message Apollo"
                rows={Math.min(8, Math.max(1, draft.split('\n').length))}
                style={textarea}
              />
              <button onClick={send} disabled={streaming || !draft.trim()} style={{ ...sendBtn, opacity: streaming || !draft.trim() ? 0.5 : 1 }}>
                Send
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 'var(--sp-1)' }}>
              {models.providers.length > 0 && choice ? (
                <select
                  value={`${choice.provider}:${choice.model}`}
                  onChange={(e) => {
                    const [provider, model] = e.target.value.split(':') as [LlmProviderId, string];
                    setChoice({ provider, model });
                  }}
                  aria-label="Model"
                  style={picker}
                >
                  {models.providers.map((p) => (
                    <optgroup key={p.id} label={p.label}>
                      {p.models.map((m) => (
                        <option key={m.id} value={`${p.id}:${m.id}`}>{m.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : null}
              <span style={{ flex: 1, textAlign: 'right', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
                Enter to send · Shift+Enter for a new line
              </span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

const newChatBtn: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2) var(--sp-3)', cursor: 'pointer',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)', width: '100%',
};
const convRow: React.CSSProperties = {
  flex: 1, minWidth: 0, textAlign: 'left', border: 'none', cursor: 'pointer',
  padding: 'var(--sp-2)', borderRadius: 'var(--radius-ctl)', color: 'var(--text-1)',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const deleteBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 'var(--sp-1)',
};
const userBubble: React.CSSProperties = {
  maxWidth: '80%', background: 'var(--accent-soft)', color: 'var(--text-1)',
  borderRadius: 'var(--radius-card)', padding: 'var(--sp-2) var(--sp-3)', whiteSpace: 'pre-wrap',
};
const assistantBubble: React.CSSProperties = {
  maxWidth: '80%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)',
  borderRadius: 'var(--radius-card)', padding: 'var(--sp-2) var(--sp-3)', whiteSpace: 'pre-wrap',
};
const textarea: React.CSSProperties = {
  flex: 1, resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', lineHeight: 1.5,
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
  background: 'var(--surface)', color: 'var(--text-1)', outline: 'none',
};
const sendBtn: React.CSSProperties = {
  border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const picker: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', background: 'var(--surface)',
  color: 'var(--text-2)', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', padding: '2px var(--sp-2)',
};
