import { type BrowserWindow } from 'electron';
import { type AgentEvent } from '@apollo/shared';

/**
 * C18 orb behavior: click-through while idle (setIgnoreMouseEvents true with
 * forward so hover still works), interactive while a turn is active, and for
 * a linger window afterwards so cards can be pinned. Never steals focus.
 */
const LINGER_MS = 8_000;

export function createOrbController(win: BrowserWindow, opts: { lingerMs?: number } = {}) {
  const linger = opts.lingerMs ?? LINGER_MS;
  let clickThrough = true;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function setClickThrough(on: boolean): void {
    if (win.isDestroyed()) return;
    clickThrough = on;
    win.setIgnoreMouseEvents(on, { forward: true });
  }

  setClickThrough(true);

  return {
    onAgentEvent(e: AgentEvent): void {
      if (e.type === 'turnStart') {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        setClickThrough(false);
      } else if (e.type === 'done' || e.type === 'error') {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => setClickThrough(true), linger);
      }
    },
    isClickThrough(): boolean {
      return clickThrough;
    },
    dispose(): void {
      if (idleTimer) clearTimeout(idleTimer);
    },
  };
}

export type OrbController = ReturnType<typeof createOrbController>;
