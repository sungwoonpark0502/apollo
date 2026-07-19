/**
 * I6 shortcuts registry: the single place keyboard/voice shortcuts are declared.
 * The help sheet renders from shortcuts.list (built here) and keyboard windows
 * match key events against the same `binding`, so help and behavior can never
 * drift. Voice/global entries have no in-window binding (handled by the OS
 * hotkey or the voice fast paths).
 */
export type ShortcutScope = 'Global' | 'Workspace' | 'Calendar' | 'Notes' | 'Voice';

export interface KeyBinding {
  key: string; // KeyboardEvent.key, lowercased for letters (e.g. 'k', '/', '1')
  mod?: boolean; // Cmd on macOS / Ctrl on Windows-Linux
  shift?: boolean;
}

export interface Shortcut {
  id: string; // stable id, e.g. 'workspace.omnisearch'
  scope: ShortcutScope;
  keys: string; // canonical display template, e.g. "Mod+K", "?", "Say 'Apollo'"
  description: string;
  binding?: KeyBinding; // present only for in-window keyboard shortcuts
}

export const SHORTCUTS: readonly Shortcut[] = [
  // Global (OS-level hotkeys, registered in main; not matched inside a window)
  // PART K: the palette hotkey is gone; Alt+Space is now push-to-talk only.
  { id: 'global.ptt', scope: 'Global', keys: 'Alt+Space', description: 'Push to talk' },
  { id: 'global.capture', scope: 'Global', keys: 'Mod+Shift+N', description: 'Quick capture a note or to-do' },

  // Workspace (L2 supersedes K2: Today is first in the rail; Mod+1 = Today)
  { id: 'workspace.omnisearch', scope: 'Workspace', keys: 'Mod+K', description: 'Search everything', binding: { key: 'k', mod: true } },
  { id: 'workspace.today', scope: 'Workspace', keys: 'Mod+1', description: 'Go to Today', binding: { key: '1', mod: true } },
  { id: 'workspace.chat', scope: 'Workspace', keys: 'Mod+2', description: 'Go to Chat', binding: { key: '2', mod: true } },
  { id: 'workspace.calendar', scope: 'Workspace', keys: 'Mod+3', description: 'Go to Calendar', binding: { key: '3', mod: true } },
  { id: 'workspace.notes', scope: 'Workspace', keys: 'Mod+4', description: 'Go to Notes', binding: { key: '4', mod: true } },
  { id: 'workspace.undo', scope: 'Workspace', keys: 'Mod+Z', description: 'Undo the last change', binding: { key: 'z', mod: true } },
  { id: 'workspace.help', scope: 'Workspace', keys: '?', description: 'Show keyboard shortcuts', binding: { key: '?' } },
  { id: 'workspace.helpAlt', scope: 'Workspace', keys: 'Mod+/', description: 'Show keyboard shortcuts', binding: { key: '/', mod: true } },

  // Calendar
  { id: 'calendar.today', scope: 'Calendar', keys: 'T', description: 'Jump to today', binding: { key: 't' } },

  // Notes
  { id: 'notes.new', scope: 'Notes', keys: 'Mod+N', description: 'New note', binding: { key: 'n', mod: true } },

  // Voice (handled by wake word + fast paths, no in-window binding)
  { id: 'voice.wake', scope: 'Voice', keys: "Say 'Apollo'", description: 'Start talking to Apollo' },
  { id: 'voice.stop', scope: 'Voice', keys: "Say 'stop'", description: 'Stop Apollo talking' },
  { id: 'voice.undo', scope: 'Voice', keys: "Say 'undo'", description: 'Undo the last action' },
  { id: 'voice.repeat', scope: 'Voice', keys: "Say 'repeat that'", description: 'Repeat the last reply' },
  { id: 'voice.retry', scope: 'Voice', keys: "Say 'try again'", description: 'Retry the last failed action' },
  { id: 'voice.newConv', scope: 'Voice', keys: "Say 'new conversation'", description: 'Start a fresh conversation' },
];

export const SHORTCUT_SCOPES: readonly ShortcutScope[] = ['Global', 'Workspace', 'Calendar', 'Notes', 'Voice'];

/** Human key display for a platform (⌘ on macOS, Ctrl elsewhere; ⇧ for shift). */
export function formatShortcut(keys: string, isMac: boolean): string {
  return keys
    .replace(/\bMod\b/g, isMac ? '⌘' : 'Ctrl')
    .replace(/\bShift\b/g, isMac ? '⇧' : 'Shift')
    .replace(/\bAlt\b/g, isMac ? '⌥' : 'Alt')
    .replace(/⌘\+/g, '⌘')
    .replace(/⇧\+/g, '⇧')
    .replace(/⌥\+/g, '⌥');
}

/** The shortcuts.list IPC payload for a platform: {scope, keys, description}[]. */
export function shortcutList(isMac: boolean): Array<{ scope: ShortcutScope; keys: string; description: string }> {
  return SHORTCUTS.map((s) => ({ scope: s.scope, keys: formatShortcut(s.keys, isMac), description: s.description }));
}

/** True when a keyboard event matches a shortcut's binding. */
export function matchesBinding(
  b: KeyBinding,
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!!b.mod !== mod) return false;
  if (!!b.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === b.key.toLowerCase();
}

/** Look up a shortcut by id (windows read their binding from here). */
export function shortcut(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}
