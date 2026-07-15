import { describe, expect, it, vi } from 'vitest';
import { createConversationManager } from './conversationManager';

describe('conversation rotation (H5)', () => {
  it('keeps the same conversation within 30 minutes (29 min boundary)', () => {
    let t = 1_000_000;
    const cm = createConversationManager({ now: () => t });
    const first = cm.forTurn();
    t += 29 * 60_000;
    expect(cm.forTurn()).toBe(first);
  });

  it('rotates to a new conversation after 30 minutes (31 min boundary)', () => {
    let t = 1_000_000;
    const cm = createConversationManager({ now: () => t });
    const first = cm.forTurn();
    t += 31 * 60_000;
    const second = cm.forTurn();
    expect(second).not.toBe(first);
  });

  it('the very first turn never rotates regardless of clock', () => {
    let t = 5_000_000_000;
    const cm = createConversationManager({ now: () => t });
    const id = cm.current();
    t += 10 * 60 * 60_000; // 10 hours later, but no prior activity
    expect(cm.forTurn()).toBe(id);
  });

  it('startNew forces a fresh conversation and fires onRotate', () => {
    const onRotate = vi.fn();
    const cm = createConversationManager({ onRotate });
    const before = cm.current();
    const after = cm.startNew();
    expect(after).not.toBe(before);
    expect(onRotate).toHaveBeenCalledWith(after);
  });

  it('setActive continues a specific conversation and resets the activity clock', () => {
    let t = 1_000_000;
    const cm = createConversationManager({ now: () => t });
    cm.forTurn();
    cm.setActive('conv-xyz');
    expect(cm.current()).toBe('conv-xyz');
    t += 31 * 60_000; // would rotate, but only if lastActivity is stale — setActive refreshed it minus this gap
    // after 31 min it rotates away from the set one (expected: stale)
    expect(cm.forTurn()).not.toBe('conv-xyz');
  });
});
