/**
 * K2 composer behavior as pure functions: send-key bindings under both
 * sendOnEnter modes, auto-grow bounds, and up-arrow history recall. The
 * Composer component consumes these so the rules are unit-testable.
 */
export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** IME composition in progress: Enter must never send mid-composition. */
  isComposing?: boolean;
}

export type ComposerAction = 'send' | 'newline' | 'historyPrev' | 'historyNext' | null;

/**
 * sendOnEnter: Enter sends, Shift+Enter newline.
 * !sendOnEnter: Mod+Enter sends, Enter newline.
 * ArrowUp on an empty composer recalls the previous user message (palette parity).
 */
export function composerKeyAction(
  e: ComposerKeyEvent,
  opts: { sendOnEnter: boolean; empty: boolean; recalling: boolean },
): ComposerAction {
  if (e.isComposing) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Enter') {
    if (opts.sendOnEnter) return e.shiftKey || mod ? 'newline' : 'send';
    return mod ? 'send' : 'newline';
  }
  if (e.key === 'ArrowUp' && (opts.empty || opts.recalling)) return 'historyPrev';
  if (e.key === 'ArrowDown' && opts.recalling) return 'historyNext';
  return null;
}

export const COMPOSER_MIN_ROWS = 1;
export const COMPOSER_MAX_ROWS = 8;

/** Auto-grow: one row per newline-separated line, clamped to [1, 8] (K2). */
export function composerRows(text: string): number {
  const lines = text.split('\n').length;
  return Math.min(COMPOSER_MAX_ROWS, Math.max(COMPOSER_MIN_ROWS, lines));
}

export interface HistoryRecallState {
  idx: number | null; // null = not recalling
  draft: string; // what was typed before recall began
}

/** Step through input history (newest first on ArrowUp). Returns the new state + text to show. */
export function recallStep(
  history: readonly string[],
  cur: HistoryRecallState,
  dir: 'prev' | 'next',
  currentText: string,
): { state: HistoryRecallState; text: string } {
  if (history.length === 0) return { state: cur, text: currentText };
  if (dir === 'prev') {
    const idx = cur.idx === null ? history.length - 1 : Math.max(0, cur.idx - 1);
    const draft = cur.idx === null ? currentText : cur.draft;
    return { state: { idx, draft }, text: history[idx] ?? '' };
  }
  if (cur.idx === null) return { state: cur, text: currentText };
  const next = cur.idx + 1;
  if (next >= history.length) return { state: { idx: null, draft: '' }, text: cur.draft };
  return { state: { ...cur, idx: next }, text: history[next] ?? '' };
}
