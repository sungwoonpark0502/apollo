import { describe, expect, it } from 'vitest';
import { formatShortcut, matchesBinding, SHORTCUT_SCOPES, SHORTCUTS, shortcut, shortcutList } from './shortcuts';

describe('I6 shortcuts registry (single source)', () => {
  it('has unique ids and only known scopes', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) expect(SHORTCUT_SCOPES).toContain(s.scope);
  });

  it('is the only source for the Workspace keyboard bindings the app matches', () => {
    // The Workspace window reads these exact ids from the registry (WorkspaceApp.isShortcut).
    for (const id of ['workspace.omnisearch', 'workspace.today', 'workspace.calendar', 'workspace.notes', 'workspace.undo', 'workspace.help']) {
      expect(shortcut(id)?.binding, `${id} must declare a binding`).toBeDefined();
    }
  });

  it('formatShortcut renders platform-correct key hints', () => {
    expect(formatShortcut('Mod+K', true)).toBe('⌘K');
    expect(formatShortcut('Mod+K', false)).toBe('Ctrl+K');
    expect(formatShortcut('Mod+Shift+N', true)).toBe('⌘⇧N');
    expect(formatShortcut('?', true)).toBe('?');
  });

  it('shortcutList produces a help payload covering every scope that has entries', () => {
    const list = shortcutList(true);
    expect(list.length).toBe(SHORTCUTS.length);
    const scopes = new Set(list.map((r) => r.scope));
    for (const s of ['Global', 'Workspace', 'Calendar', 'Notes', 'Voice'] as const) expect(scopes.has(s)).toBe(true);
  });

  it('matchesBinding respects mod and shift', () => {
    const b = shortcut('workspace.omnisearch')!.binding!;
    expect(matchesBinding(b, { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false })).toBe(true);
    expect(matchesBinding(b, { key: 'K', metaKey: false, ctrlKey: true, shiftKey: false })).toBe(true);
    expect(matchesBinding(b, { key: 'k', metaKey: false, ctrlKey: false, shiftKey: false })).toBe(false); // no mod
    const capture = shortcut('global.capture'); // no binding (OS-level)
    expect(capture?.binding).toBeUndefined();
  });
});
