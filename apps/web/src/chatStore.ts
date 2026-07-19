/**
 * Web chat history, stored in THIS browser's localStorage and nowhere else.
 *
 * This is a deliberate architecture choice, not a shortcut: the backend's
 * standing property is that it stores no user content (L0.1), and the web
 * client keeps that true. The cost is honest and shown in the UI — history
 * does not follow you across browsers or sync with the desktop app. Sync is
 * the recorded next step (HUMAN_TODO), and it is a product decision because it
 * reverses that property.
 *
 * Pure functions over an injected StorageLike, so the whole model is testable
 * without a DOM and quota errors degrade to in-memory-only rather than a crash.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WebMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface WebConversation {
  id: string;
  title: string;
  messages: WebMessage[];
  updatedAt: number;
}

const KEY = 'apollo.web.conversations.v1';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

export function loadConversations(storage: StorageLike): WebConversation[] {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shape-check each row; a corrupt entry is dropped, not fatal.
    return parsed.filter(
      (c): c is WebConversation =>
        typeof c === 'object' && c !== null &&
        typeof (c as WebConversation).id === 'string' &&
        typeof (c as WebConversation).title === 'string' &&
        Array.isArray((c as WebConversation).messages),
    );
  } catch {
    return [];
  }
}

export function saveConversations(storage: StorageLike, convs: WebConversation[]): void {
  try {
    storage.setItem(KEY, JSON.stringify(convs));
  } catch {
    // Quota exceeded: the session keeps working in memory; oldest history is
    // simply not persisted. Better than a crash mid-reply.
  }
}

export function newConversation(id: string, now: number): WebConversation {
  return { id, title: '', messages: [], updatedAt: now };
}

/** First user line names the thread, like the desktop sidebar. */
export function titleFor(conv: WebConversation): string {
  if (conv.title) return conv.title;
  const first = conv.messages.find((m) => m.role === 'user');
  return first ? first.text.slice(0, 60) : 'New chat';
}

/**
 * Appends a message, bumps recency, caps sizes, and keeps the list sorted
 * newest-first. Returns a new array — callers treat conversations as
 * immutable state.
 */
export function appendMessage(
  convs: WebConversation[],
  convId: string,
  message: WebMessage,
  now: number,
): WebConversation[] {
  const existing = convs.find((c) => c.id === convId) ?? newConversation(convId, now);
  const updated: WebConversation = {
    ...existing,
    messages: [...existing.messages, message].slice(-MAX_MESSAGES),
    updatedAt: now,
  };
  const rest = convs.filter((c) => c.id !== convId);
  return [updated, ...rest].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
}

/** Replaces the last assistant message (streaming updates land here). */
export function replaceLastAssistant(convs: WebConversation[], convId: string, text: string): WebConversation[] {
  return convs.map((c) => {
    if (c.id !== convId) return c;
    const messages = [...c.messages];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') {
        messages[i] = { role: 'assistant', text };
        break;
      }
    }
    return { ...c, messages };
  });
}

export function deleteConversation(convs: WebConversation[], convId: string): WebConversation[] {
  return convs.filter((c) => c.id !== convId);
}
