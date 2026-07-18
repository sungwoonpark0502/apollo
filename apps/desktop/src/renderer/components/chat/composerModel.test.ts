import { describe, expect, it } from 'vitest';
import { composerKeyAction, composerRows, recallStep, type HistoryRecallState } from './composerModel';

const key = (k: string, mods: Partial<{ shift: boolean; meta: boolean; ctrl: boolean; composing: boolean }> = {}) => ({
  key: k,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  isComposing: mods.composing ?? false,
});

describe('K5 composer key bindings — sendOnEnter mode', () => {
  const opts = { sendOnEnter: true, empty: false, recalling: false };
  it('Enter sends, Shift+Enter newline, Mod+Enter newline', () => {
    expect(composerKeyAction(key('Enter'), opts)).toBe('send');
    expect(composerKeyAction(key('Enter', { shift: true }), opts)).toBe('newline');
    expect(composerKeyAction(key('Enter', { meta: true }), opts)).toBe('newline');
  });
  it('never sends mid-IME-composition', () => {
    expect(composerKeyAction(key('Enter', { composing: true }), opts)).toBeNull();
  });
});

describe('K5 composer key bindings — inverted mode', () => {
  const opts = { sendOnEnter: false, empty: false, recalling: false };
  it('Enter newline, Cmd/Ctrl+Enter sends', () => {
    expect(composerKeyAction(key('Enter'), opts)).toBe('newline');
    expect(composerKeyAction(key('Enter', { meta: true }), opts)).toBe('send');
    expect(composerKeyAction(key('Enter', { ctrl: true }), opts)).toBe('send');
  });
});

describe('K5 up-arrow history recall', () => {
  it('ArrowUp recalls only on an empty composer (or while already recalling)', () => {
    expect(composerKeyAction(key('ArrowUp'), { sendOnEnter: true, empty: true, recalling: false })).toBe('historyPrev');
    expect(composerKeyAction(key('ArrowUp'), { sendOnEnter: true, empty: false, recalling: false })).toBeNull();
    expect(composerKeyAction(key('ArrowUp'), { sendOnEnter: true, empty: false, recalling: true })).toBe('historyPrev');
    expect(composerKeyAction(key('ArrowDown'), { sendOnEnter: true, empty: false, recalling: true })).toBe('historyNext');
    expect(composerKeyAction(key('ArrowDown'), { sendOnEnter: true, empty: true, recalling: false })).toBeNull();
  });

  it('steps newest-first, clamps at the oldest, and restores the draft walking forward', () => {
    const history = ['first', 'second', 'third'];
    let st: HistoryRecallState = { idx: null, draft: '' };
    let r = recallStep(history, st, 'prev', 'my draft');
    expect(r.text).toBe('third');
    st = r.state;
    r = recallStep(history, st, 'prev', r.text);
    expect(r.text).toBe('second');
    st = r.state;
    r = recallStep(history, st, 'prev', r.text);
    expect(r.text).toBe('first');
    st = r.state;
    r = recallStep(history, st, 'prev', r.text); // clamped at oldest
    expect(r.text).toBe('first');
    st = r.state;
    r = recallStep(history, st, 'next', r.text);
    expect(r.text).toBe('second');
    st = r.state;
    r = recallStep(history, st, 'next', r.text);
    expect(r.text).toBe('third');
    st = r.state;
    r = recallStep(history, st, 'next', r.text); // past newest → draft restored
    expect(r.text).toBe('my draft');
    expect(r.state.idx).toBeNull();
  });

  it('empty history is inert', () => {
    const r = recallStep([], { idx: null, draft: '' }, 'prev', 'typed');
    expect(r.text).toBe('typed');
    expect(r.state.idx).toBeNull();
  });
});

describe('K5 auto-grow bounds', () => {
  it('grows one row per line, clamped to 1..8', () => {
    expect(composerRows('')).toBe(1);
    expect(composerRows('one line')).toBe(1);
    expect(composerRows('a\nb\nc')).toBe(3);
    expect(composerRows(Array.from({ length: 20 }, () => 'x').join('\n'))).toBe(8);
  });
});
