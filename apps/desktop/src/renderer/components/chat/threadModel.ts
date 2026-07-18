import { type AgentEvent, type CardPayload } from '@apollo/shared';

/**
 * K2 Chat thread state, kept as pure reducer logic so streaming, card
 * interleaving, reconciliation with persisted history, and auto-scroll rules
 * are unit-testable without React. The thread is the transcript: persisted
 * messages plus this session's live items (cards, streaming reply, errors).
 */
export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export type ThreadItem =
  | { kind: 'msg'; id: string; role: 'user' | 'assistant'; content: string; ts: number; streaming: boolean }
  | { kind: 'card'; id: string; card: CardPayload }
  | { kind: 'error'; id: string; text: string };

export interface ThreadState {
  convId: string | null;
  items: ThreadItem[];
  turnId: string | null;
  streaming: boolean;
  activity: string | null; // I5 tool-activity line while a tool runs
  usedTools: string[]; // tools that ran this turn (collapse chip, K2)
  cancelWindow: { confirmationId: string; endsAt: number } | null;
}

export function emptyThread(convId: string | null = null): ThreadState {
  return { convId, items: [], turnId: null, streaming: false, activity: null, usedTools: [], cancelWindow: null };
}

/** The local id a streaming assistant row uses until the persisted id is adopted. */
export function localStreamId(turnId: string): string {
  return `local-${turnId}`;
}

let localSeq = 0;
function nextLocalId(prefix: string): string {
  localSeq += 1;
  return `${prefix}-${localSeq}`;
}

/** Load a conversation transcript (switching or first mount). Live items reset. */
export function loadThread(convId: string, messages: PersistedMessage[]): ThreadState {
  return {
    ...emptyThread(convId),
    items: messages.map((m) => ({ kind: 'msg' as const, id: m.id, role: m.role, content: m.content, ts: m.ts, streaming: false })),
  };
}

export interface ApplyResult {
  state: ThreadState;
  /** The event belongs to another conversation: caller must load it, then re-apply. */
  needsSwitch?: string;
  /** Persisted rows changed (user row on turnStart, assistant row on done): caller should sync. */
  needsSync?: boolean;
}

/** Applies one agent event to the thread (toolActivity label already resolved by the caller). */
export function applyAgentEvent(s: ThreadState, e: AgentEvent, toolLabel: (tool: string) => string): ApplyResult {
  switch (e.type) {
    case 'turnStart': {
      if (s.convId !== null && e.convId !== s.convId) return { state: s, needsSwitch: e.convId };
      const convId = s.convId ?? e.convId;
      // A fresh streaming assistant row goes at the tail; cards insert before it.
      const items: ThreadItem[] = [
        ...s.items,
        { kind: 'msg', id: localStreamId(e.turnId), role: 'assistant', content: '', ts: Date.now(), streaming: true },
      ];
      return {
        state: { ...s, convId, items, turnId: e.turnId, streaming: true, activity: null, usedTools: [], cancelWindow: null },
        needsSync: true, // the user row was persisted just before turnStart
      };
    }
    case 'token': {
      const items = s.items.map((it) =>
        it.kind === 'msg' && it.streaming ? { ...it, content: it.content + e.text } : it,
      );
      return { state: { ...s, items } };
    }
    case 'toolStart':
      return { state: { ...s, activity: toolLabel(e.tool), usedTools: s.usedTools.includes(e.tool) ? s.usedTools : [...s.usedTools, e.tool] } };
    case 'toolResult':
      return { state: { ...s, activity: null } };
    case 'card': {
      // Insert before the streaming row so the final reply reads last.
      const streamIdx = s.items.findIndex((it) => it.kind === 'msg' && it.streaming);
      const card: ThreadItem = { kind: 'card', id: nextLocalId('card'), card: e.card };
      const items = streamIdx >= 0 ? [...s.items.slice(0, streamIdx), card, ...s.items.slice(streamIdx)] : [...s.items, card];
      return { state: { ...s, items } };
    }
    case 'confirmRequest':
      return { state: s }; // the confirm card arrives as its own card event
    case 'cancelWindow':
      return { state: { ...s, cancelWindow: { confirmationId: e.confirmationId, endsAt: Date.now() + e.ms } } };
    case 'done': {
      // Finalize the streaming row; drop it when the turn produced no text.
      const items = s.items
        .filter((it) => !(it.kind === 'msg' && it.streaming && it.content === ''))
        .map((it) => (it.kind === 'msg' && it.streaming ? { ...it, streaming: false } : it));
      return { state: { ...s, items, streaming: false, activity: null, cancelWindow: null }, needsSync: true };
    }
    case 'error': {
      const items: ThreadItem[] = [
        ...s.items.filter((it) => !(it.kind === 'msg' && it.streaming && it.content === '')),
        ...(e.userMessage ? [{ kind: 'error' as const, id: nextLocalId('err'), text: e.userMessage }] : []),
      ].map((it) => (it.kind === 'msg' && it.streaming ? { ...it, streaming: false } : it));
      return { state: { ...s, items, streaming: false, activity: null, cancelWindow: null } };
    }
    default:
      return { state: s };
  }
}

/**
 * Reconcile with persisted history: append rows the thread has not seen. The
 * just-finalized streaming row (local id) adopts the persisted assistant row's
 * id/content so it is never duplicated.
 */
export function syncPersisted(s: ThreadState, messages: PersistedMessage[]): ThreadState {
  const known = new Set(s.items.filter((it): it is Extract<ThreadItem, { kind: 'msg' }> => it.kind === 'msg').map((it) => it.id));
  let items = s.items;
  for (const m of messages) {
    if (known.has(m.id)) continue;
    if (m.role === 'assistant') {
      // Adopt into a finalized local streaming row when present (same turn's reply).
      const localIdx = items.findIndex((it) => it.kind === 'msg' && it.role === 'assistant' && it.id.startsWith('local-') && !it.streaming);
      if (localIdx >= 0) {
        items = items.map((it, i) => (i === localIdx && it.kind === 'msg' ? { ...it, id: m.id, content: m.content, ts: m.ts } : it));
        known.add(m.id);
        continue;
      }
      // A live streaming row for this reply exists: leave it; it will adopt on done.
      if (items.some((it) => it.kind === 'msg' && it.streaming)) continue;
    }
    // New user (or off-screen assistant) row: insert before the live tail so the
    // streaming reply stays last.
    const streamIdx = items.findIndex((it) => it.kind === 'msg' && it.streaming);
    const row: ThreadItem = { kind: 'msg', id: m.id, role: m.role, content: m.content, ts: m.ts, streaming: false };
    items = streamIdx >= 0 ? [...items.slice(0, streamIdx), row, ...items.slice(streamIdx)] : [...items, row];
    known.add(m.id);
  }
  return { ...s, items };
}

// ---- Virtualization (K5: 1000 messages render within budget) ----

export const THREAD_WINDOW = 60;

/** Progressive reveal: render only the last `THREAD_WINDOW * pages` items. */
export function visibleSlice<T>(items: readonly T[], pages: number): { hidden: number; visible: readonly T[] } {
  const count = Math.min(items.length, THREAD_WINDOW * Math.max(1, pages));
  return { hidden: items.length - count, visible: items.slice(items.length - count) };
}

// ---- Auto-scroll (K2: follow while pinned to bottom; detach on scroll-up) ----

const BOTTOM_SLACK_PX = 48;

/** Pinned when the viewport is within slack of the bottom. */
export function isPinnedToBottom(m: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return m.scrollHeight - (m.scrollTop + m.clientHeight) <= BOTTOM_SLACK_PX;
}
