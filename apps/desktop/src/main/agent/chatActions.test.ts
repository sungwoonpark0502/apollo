import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createChatActions } from './chatActions';

/**
 * K1/K5: regenerate drops the prior assistant turn from the thread AND the
 * memory index; editAndResend truncates from the edited message and purges
 * orphaned chunks. Both re-dispatch through the injected one-brain path.
 */
let db: Db;
let repos: Repos;
let dispatch: ReturnType<typeof vi.fn<(input: { text: string; convId: string }) => { turnId: string }>>;

const CONV = 'conv-1';

function seedThread(): { userA: string; asstA: string; userB: string; asstB: string } {
  const userA = repos.conversations.addMessage({ convId: CONV, role: 'user', content: 'set a timer for 10 minutes', ts: 100 }).id;
  const asstA = repos.conversations.addMessage({ convId: CONV, role: 'assistant', content: 'Timer set for 10 minutes.', ts: 200 }).id;
  const userB = repos.conversations.addMessage({ convId: CONV, role: 'user', content: 'what about the weather', ts: 300 }).id;
  const asstB = repos.conversations.addMessage({ convId: CONV, role: 'assistant', content: 'Sunny, 88.', ts: 400 }).id;
  // index each message the way the indexer does (kind message, refId = message id)
  for (const [id, text] of [[userA, 'set a timer for 10 minutes'], [asstA, 'Timer set for 10 minutes.'], [userB, 'what about the weather'], [asstB, 'Sunny, 88.']] as const) {
    repos.chunks.replaceForRef('message', id, [text], { convId: CONV, ts: 1 });
  }
  return { userA, asstA, userB, asstB };
}

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  repos.conversations.ensure(CONV);
  dispatch = vi.fn(() => ({ turnId: 'turn-2' }));
});

function actions() {
  return createChatActions({ repos, dispatch });
}

describe('chat.regenerate', () => {
  it('drops the assistant turn from thread and index, then re-runs the preceding user message', () => {
    const { asstB } = seedThread();
    expect(repos.chunks.count()).toBe(4);

    const res = actions().regenerate(CONV, asstB);
    expect(res.turnId).toBe('turn-2');
    expect(dispatch).toHaveBeenCalledWith({ text: 'what about the weather', convId: CONV });

    const remaining = repos.conversations.messagesOf(CONV);
    expect(remaining.map((m) => m.content)).toEqual(['set a timer for 10 minutes', 'Timer set for 10 minutes.', 'what about the weather']);
    expect(repos.chunks.count()).toBe(3); // asstB's chunk purged (K5 assert chunk count)
  });

  it('regenerating a mid-thread assistant message also drops everything after it', () => {
    const { asstA } = seedThread();
    actions().regenerate(CONV, asstA);
    expect(dispatch).toHaveBeenCalledWith({ text: 'set a timer for 10 minutes', convId: CONV });
    expect(repos.conversations.messagesOf(CONV).map((m) => m.content)).toEqual(['set a timer for 10 minutes']);
    expect(repos.chunks.count()).toBe(1);
  });

  it('throws on unknown message and when no user message precedes the target', () => {
    const asst = repos.conversations.addMessage({ convId: CONV, role: 'assistant', content: 'hello', ts: 10 }).id;
    expect(() => actions().regenerate(CONV, 'ghost')).toThrow('message not found');
    expect(() => actions().regenerate(CONV, asst)).toThrow('no user message');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('chat.editAndResend', () => {
  it('truncates from the edited user message, purges orphaned chunks, resends the new text', () => {
    const { userB } = seedThread();
    const res = actions().editAndResend(CONV, userB, 'what about tomorrow');
    expect(res.turnId).toBe('turn-2');
    expect(dispatch).toHaveBeenCalledWith({ text: 'what about tomorrow', convId: CONV });
    // userB and asstB are gone; the first exchange is intact
    expect(repos.conversations.messagesOf(CONV).map((m) => m.content)).toEqual(['set a timer for 10 minutes', 'Timer set for 10 minutes.']);
    expect(repos.chunks.count()).toBe(2);
  });

  it('refuses to edit an assistant message', () => {
    const { asstA } = seedThread();
    expect(() => actions().editAndResend(CONV, asstA, 'x')).toThrow('only user messages');
    expect(repos.conversations.messagesOf(CONV)).toHaveLength(4); // untouched
  });
});

describe('conversations repo (K2 sidebar contract)', () => {
  it('rename and pin round-trip through listSummaries; pinned sorts first', () => {
    seedThread();
    const other = 'conv-2';
    repos.conversations.ensure(other);
    repos.conversations.addMessage({ convId: other, role: 'user', content: 'newer conversation', ts: 9999 });

    repos.conversations.rename(CONV, 'Timer talk');
    repos.conversations.setPinned(CONV, true);
    const list = repos.conversations.listSummaries();
    expect(list[0]).toMatchObject({ id: CONV, title: 'Timer talk', pinned: true }); // pinned beats recency
    expect(list[1]).toMatchObject({ id: other, pinned: false });

    repos.conversations.rename(CONV, '  '); // blank reverts to derived title
    expect(repos.conversations.listSummaries().find((c) => c.id === CONV)?.title).toBe('set a timer for 10 minutes');
  });

  it('messagesOf exposes stable message ids in order', () => {
    const { userA, asstA } = seedThread();
    const ids = repos.conversations.messagesOf(CONV).map((m) => m.id);
    expect(ids.slice(0, 2)).toEqual([userA, asstA]);
    expect(new Set(ids).size).toBe(4);
  });
});
