import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  deleteConversation,
  loadConversations,
  newConversation,
  replaceLastAssistant,
  saveConversations,
  titleFor,
  type StorageLike,
} from './chatStore';

function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('web chat store', () => {
  it('round-trips conversations through storage', () => {
    const storage = memStorage();
    const convs = appendMessage([], 'c1', { role: 'user', text: 'hello' }, 1000);
    saveConversations(storage, convs);
    expect(loadConversations(storage)).toEqual(convs);
  });

  it('survives corrupt storage instead of crashing the app', () => {
    expect(loadConversations(memStorage({ 'apollo.web.conversations.v1': '{not json' }))).toEqual([]);
    expect(loadConversations(memStorage({ 'apollo.web.conversations.v1': '"a string"' }))).toEqual([]);
    // A corrupt row is dropped; intact rows survive.
    const mixed = JSON.stringify([{ id: 'ok', title: '', messages: [], updatedAt: 1 }, { bogus: true }]);
    expect(loadConversations(memStorage({ 'apollo.web.conversations.v1': mixed }))).toHaveLength(1);
  });

  it('a quota error on save is swallowed, not thrown mid-reply', () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveConversations(broken, [])).not.toThrow();
  });

  it('appending creates the conversation on first use and sorts newest first', () => {
    let convs = appendMessage([], 'a', { role: 'user', text: '1' }, 100);
    convs = appendMessage(convs, 'b', { role: 'user', text: '2' }, 200);
    convs = appendMessage(convs, 'a', { role: 'assistant', text: '3' }, 300);
    expect(convs.map((c) => c.id)).toEqual(['a', 'b']);
    expect(convs[0]!.messages).toHaveLength(2);
  });

  it('caps messages per conversation and total conversations', () => {
    let convs = [newConversation('big', 0)];
    for (let i = 0; i < 210; i++) convs = appendMessage(convs, 'big', { role: 'user', text: `${i}` }, i);
    expect(convs[0]!.messages).toHaveLength(200);
    expect(convs[0]!.messages.at(-1)!.text).toBe('209'); // newest kept, oldest dropped

    let many: ReturnType<typeof appendMessage> = [];
    for (let i = 0; i < 60; i++) many = appendMessage(many, `c${i}`, { role: 'user', text: 'x' }, i);
    expect(many).toHaveLength(50);
    expect(many[0]!.id).toBe('c59');
  });

  it('titles come from the first user message, clipped', () => {
    const conv = appendMessage([], 'c', { role: 'user', text: 'x'.repeat(100) }, 1)[0]!;
    expect(titleFor(conv)).toHaveLength(60);
    expect(titleFor(newConversation('empty', 0))).toBe('New chat');
  });

  it('replaceLastAssistant rewrites only the trailing assistant message', () => {
    let convs = appendMessage([], 'c', { role: 'user', text: 'q' }, 1);
    convs = appendMessage(convs, 'c', { role: 'assistant', text: 'partial' }, 2);
    convs = replaceLastAssistant(convs, 'c', 'full reply');
    expect(convs[0]!.messages).toEqual([
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'full reply' },
    ]);
  });

  it('delete removes exactly one conversation', () => {
    let convs = appendMessage([], 'a', { role: 'user', text: '1' }, 1);
    convs = appendMessage(convs, 'b', { role: 'user', text: '2' }, 2);
    expect(deleteConversation(convs, 'a').map((c) => c.id)).toEqual(['b']);
  });
});
