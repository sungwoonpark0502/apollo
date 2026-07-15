import { describe, expect, it } from 'vitest';
import { hotkeyConflictAdvice, suggestedHotkey } from './hotkeyAdvice';

describe('hotkey conflict advice (H7)', () => {
  it('names the Windows Alt+Space window-menu conflict and suggests Ctrl+Alt+Space', () => {
    const msg = hotkeyConflictAdvice('Alt+Space', 'win32');
    expect(msg).toContain('Windows');
    expect(msg).toContain('Ctrl+Alt+Space');
  });

  it('gives a macOS-appropriate hint for Option+Space', () => {
    expect(hotkeyConflictAdvice('Alt+Space', 'darwin')).toContain('Option+Space');
  });

  it('falls back to a generic message for other accelerators', () => {
    expect(hotkeyConflictAdvice('CommandOrControl+J', 'darwin')).toContain('CommandOrControl+J');
  });

  it('suggests a safe platform-specific fallback', () => {
    expect(suggestedHotkey('win32')).toBe('Ctrl+Alt+Space');
    expect(suggestedHotkey('darwin')).toBe('Control+Option+Space');
  });
});
