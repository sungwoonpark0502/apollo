/**
 * H7 hotkey failure UX. When globalShortcut.register fails (conflict), Settings
 * and onboarding show an inline error naming the likely conflict and suggesting
 * an alternative. The app never silently loses its hotkey.
 */
export function hotkeyConflictAdvice(accelerator: string, platform: NodeJS.Platform): string {
  const isMac = platform === 'darwin';
  const norm = accelerator.replace(/\s/g, '').toLowerCase();
  // Windows: Alt+Space commonly opens the system window menu.
  if (!isMac && (norm === 'alt+space')) {
    return 'Alt+Space is usually taken by the Windows window menu. Try Ctrl+Alt+Space.';
  }
  if (isMac && norm === 'alt+space') {
    return 'Option+Space may be in use. Try Control+Option+Space or another combo.';
  }
  return `${accelerator} could not be registered — another app may be using it. Pick a different combination.`;
}

/** A safe fallback accelerator to offer per platform. */
export function suggestedHotkey(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'Control+Option+Space' : 'Ctrl+Alt+Space';
}
