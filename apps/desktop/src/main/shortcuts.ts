import { globalShortcut } from 'electron';

/** Registers the global palette hotkey; re-registers on settings change. */
export function registerHotkey(accelerator: string, onTrigger: () => void, log: (msg: string) => void): boolean {
  globalShortcut.unregisterAll();
  try {
    const ok = globalShortcut.register(accelerator, onTrigger);
    if (!ok) log(`hotkey ${accelerator} could not be registered (in use by another app?)`);
    return ok;
  } catch (e) {
    log(`hotkey registration failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
}
