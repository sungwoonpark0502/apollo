import { describe, expect, it } from 'vitest';
import {
  applyAgentEvent,
  emptyThread,
  isPinnedToBottom,
  loadThread,
  localStreamId,
  syncPersisted,
  THREAD_WINDOW,
  truncateFrom,
  usedToolNamespaces,
  visibleSlice,
  type PersistedMessage,
  type ThreadState,
} from './threadModel';

const label = (t: string): string => `Working: ${t}`;

function apply(s: ThreadState, e: Parameters<typeof applyAgentEvent>[1]): ReturnType<typeof applyAgentEvent> {
  return applyAgentEvent(s, e, label);
}

const msgs = (s: ThreadState): Array<{ role: string; content: string }> =>
  s.items.filter((i): i is Extract<ThreadState['items'][number], { kind: 'msg' }> => i.kind === 'msg').map((m) => ({ role: m.role, content: m.content }));

describe('K2 thread reducer — streaming', () => {
  it('turnStart opens a streaming assistant row; tokens accumulate; done finalizes', () => {
    let s = loadThread('c1', []);
    let r = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' });
    expect(r.needsSync).toBe(true); // user row persisted before turnStart
    s = r.state;
    expect(s.streaming).toBe(true);
    s = apply(s, { type: 'token', text: 'Sure, ' }).state;
    s = apply(s, { type: 'token', text: 'done.' }).state;
    expect(msgs(s)).toEqual([{ role: 'assistant', content: 'Sure, done.' }]);
    r = apply(s, { type: 'done', turnId: 't1' });
    expect(r.state.streaming).toBe(false);
    expect(r.needsSync).toBe(true); // assistant row persisted at done
  });

  it('a turn with no text drops the empty streaming row on done', () => {
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' }).state;
    s = apply(s, { type: 'card', card: { kind: 'text', body: 'Timer set' } }).state;
    s = apply(s, { type: 'done', turnId: 't1' }).state;
    expect(msgs(s)).toEqual([]); // no phantom empty reply
    expect(s.items.some((i) => i.kind === 'card')).toBe(true);
  });

  it('a turn for another conversation asks the caller to switch', () => {
    const s = loadThread('c1', []);
    const r = apply(s, { type: 'turnStart', turnId: 't9', convId: 'c2' });
    expect(r.needsSwitch).toBe('c2');
    expect(r.state).toBe(s); // untouched until the caller reloads
  });

  it('cards insert before the streaming reply so the answer reads last', () => {
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' }).state;
    s = apply(s, { type: 'token', text: 'Here is your day.' }).state;
    s = apply(s, { type: 'card', card: { kind: 'text', body: 'Agenda' } }).state;
    const kinds = s.items.map((i) => i.kind);
    expect(kinds).toEqual(['card', 'msg']);
  });

  it('tool activity sets the label and accumulates the used-tools chip exactly once per tool', () => {
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' }).state;
    s = apply(s, { type: 'toolStart', tool: 'calendar.list' }).state;
    expect(s.activity).toBe('Working: calendar.list');
    s = apply(s, { type: 'toolResult', tool: 'calendar.list', ok: true }).state;
    expect(s.activity).toBeNull();
    s = apply(s, { type: 'toolStart', tool: 'calendar.list' }).state;
    s = apply(s, { type: 'toolResult', tool: 'calendar.list', ok: true }).state;
    s = apply(s, { type: 'toolStart', tool: 'weather.now' }).state;
    expect(s.usedTools).toEqual(['calendar.list', 'weather.now']);
  });

  it('error drops the empty streaming row and appends an error item', () => {
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' }).state;
    s = apply(s, { type: 'error', code: 'LLM_DOWN', userMessage: 'Brain offline.' }).state;
    expect(s.streaming).toBe(false);
    expect(s.items.map((i) => i.kind)).toEqual(['error']);
  });
});

describe('K2 thread reducer — persisted sync (shared thread)', () => {
  it('appends the just-persisted user row while keeping the streaming reply last', () => {
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' }).state;
    const persisted: PersistedMessage[] = [{ id: 'm1', role: 'user', content: 'hi apollo', ts: 1 }];
    s = syncPersisted(s, persisted);
    expect(msgs(s)).toEqual([
      { role: 'user', content: 'hi apollo' },
      { role: 'assistant', content: '' },
    ]);
    expect(s.items.at(-1)).toMatchObject({ streaming: true });
  });

  it('the finalized streaming row adopts the persisted assistant id instead of duplicating', () => {
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 't1', convId: 'c1' }).state;
    s = syncPersisted(s, [{ id: 'm1', role: 'user', content: 'hi', ts: 1 }]);
    s = apply(s, { type: 'token', text: 'Hello James.' }).state;
    s = apply(s, { type: 'done', turnId: 't1' }).state;
    s = syncPersisted(s, [
      { id: 'm1', role: 'user', content: 'hi', ts: 1 },
      { id: 'm2', role: 'assistant', content: 'Hello James.', ts: 2 },
    ]);
    expect(msgs(s)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello James.' },
    ]);
    const asst = s.items.find((i) => i.kind === 'msg' && i.role === 'assistant');
    expect(asst && 'id' in asst ? asst.id : '').toBe('m2'); // adopted, not local-t1
  });

  it('is idempotent: syncing the same messages twice adds nothing', () => {
    let s = loadThread('c1', [{ id: 'm1', role: 'user', content: 'a', ts: 1 }]);
    s = syncPersisted(s, [{ id: 'm1', role: 'user', content: 'a', ts: 1 }]);
    expect(s.items).toHaveLength(1);
  });

  it('a voice turn arriving with no chat input shows both rows live (one-brain proof shape)', () => {
    // Simulates: Chat tab open on c1, user SPEAKS; orchestrator persists the
    // transcript then streams. The thread must show user + assistant rows.
    let s = loadThread('c1', []);
    s = apply(s, { type: 'turnStart', turnId: 'voice-t', convId: 'c1' }).state;
    s = syncPersisted(s, [{ id: 'vm1', role: 'user', content: 'set a timer for 5 minutes', ts: 5 }]);
    s = apply(s, { type: 'card', card: { kind: 'text', body: 'Timer' } }).state;
    s = apply(s, { type: 'token', text: 'Timer set.' }).state;
    s = apply(s, { type: 'done', turnId: 'voice-t' }).state;
    expect(s.items.map((i) => i.kind)).toEqual(['msg', 'card', 'msg']);
    expect(msgs(s)).toEqual([
      { role: 'user', content: 'set a timer for 5 minutes' },
      { role: 'assistant', content: 'Timer set.' },
    ]);
  });
});

describe('K5 virtualization + auto-scroll', () => {
  it('renders a bounded window of a 1000-message thread and reveals more per page', () => {
    const many = Array.from({ length: 1000 }, (_, i) => i);
    const p1 = visibleSlice(many, 1);
    expect(p1.visible.length).toBe(THREAD_WINDOW);
    expect(p1.hidden).toBe(1000 - THREAD_WINDOW);
    expect(p1.visible.at(-1)).toBe(999); // newest kept
    const p3 = visibleSlice(many, 3);
    expect(p3.visible.length).toBe(THREAD_WINDOW * 3);
    expect(visibleSlice(many, 999).visible.length).toBe(1000); // clamped
  });

  it('pinned-to-bottom detaches on scroll-up and reattaches near the bottom', () => {
    const el = { scrollHeight: 2000, clientHeight: 600 };
    expect(isPinnedToBottom({ ...el, scrollTop: 1400 })).toBe(true); // at bottom
    expect(isPinnedToBottom({ ...el, scrollTop: 1360 })).toBe(true); // within slack
    expect(isPinnedToBottom({ ...el, scrollTop: 900 })).toBe(false); // scrolled up → detached
  });
});

describe('helpers', () => {
  it('localStreamId is stable per turn', () => {
    expect(localStreamId('t1')).toBe('local-t1');
    expect(emptyThread().items).toEqual([]);
  });
});

describe('K5 message actions — local truncation + used-tools chip', () => {
  it('truncateFrom drops the message and everything after it (regenerate/edit mirror)', () => {
    let s = loadThread('c1', [
      { id: 'm1', role: 'user', content: 'a', ts: 1 },
      { id: 'm2', role: 'assistant', content: 'b', ts: 2 },
      { id: 'm3', role: 'user', content: 'c', ts: 3 },
      { id: 'm4', role: 'assistant', content: 'd', ts: 4 },
    ]);
    s = truncateFrom(s, 'm3');
    expect(msgs(s).map((m) => m.content)).toEqual(['a', 'b']);
    expect(truncateFrom(s, 'ghost')).toBe(s); // unknown id is a no-op
  });

  it('usedToolNamespaces dedupes to namespaces in first-use order', () => {
    expect(usedToolNamespaces(['calendar.list', 'calendar.create', 'weather.now'])).toEqual(['calendar', 'weather']);
    expect(usedToolNamespaces([])).toEqual([]);
  });
});
