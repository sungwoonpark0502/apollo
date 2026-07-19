import { type AgentEvent, type VoiceState } from '@apollo/shared';

/**
 * C18 orb behavior plus the L3.1 visibility fix.
 *
 * Visibility (L3.1): the orb is FULLY HIDDEN when idle by default. It appears
 * only when the user summons it (wake word or push-to-talk) or when something
 * needs to surface (a proactive nudge, a ringing alert), and hides again once
 * the interaction ends and the card linger elapses. Hidden ≠ not listening:
 * wake-word detection keeps running in the audio worker regardless, because
 * that lives in the worker, not in this window.
 *
 * `voice.orbIdleMode: 'dot'` opts into the old always-present dot.
 *
 * Click-through (C18): while visible and idle the window forwards mouse events
 * so it never eats clicks; it becomes interactive during a turn and for the
 * linger window afterwards so cards can be clicked.
 */
const LINGER_MS = 8_000;

/** The slice of BrowserWindow we use, so the controller is testable without Electron. */
export interface OrbWindowLike {
  isDestroyed(): boolean;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  showInactive(): void;
  hide(): void;
  isVisible(): boolean;
}

export type OrbIdleMode = 'hidden' | 'dot';

export interface OrbControllerOpts {
  lingerMs?: number;
  /** Read live so a settings change takes effect without a restart. */
  idleMode?: () => OrbIdleMode;
}

/** Voice states in which the orb must be on screen. */
const ACTIVE_VOICE: ReadonlySet<VoiceState> = new Set<VoiceState>(['listening', 'thinking', 'speaking', 'followup']);

export function createOrbController(win: OrbWindowLike, opts: OrbControllerOpts = {}) {
  const linger = opts.lingerMs ?? LINGER_MS;
  const idleMode = opts.idleMode ?? ((): OrbIdleMode => 'hidden');
  let clickThrough = true;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Something is holding the orb open: a live turn, active voice, or an alert. */
  let turnActive = false;
  let voiceActive = false;
  let attention = false;

  function setClickThrough(on: boolean): void {
    if (win.isDestroyed()) return;
    clickThrough = on;
    win.setIgnoreMouseEvents(on, { forward: true });
  }

  function shouldBeVisible(): boolean {
    return turnActive || voiceActive || attention || idleMode() === 'dot';
  }

  /** Applies visibility now. Never steals focus (showInactive). */
  function applyVisibility(): void {
    if (win.isDestroyed()) return;
    const want = shouldBeVisible();
    if (want && !win.isVisible()) win.showInactive();
    else if (!want && win.isVisible()) win.hide();
  }

  function clearIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  /** Hold the orb interactive + visible for the linger, then settle back. */
  function startLinger(): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      setClickThrough(true);
      applyVisibility(); // hides unless something still holds it open
    }, linger);
  }

  setClickThrough(true);
  applyVisibility(); // boot: hidden by default

  return {
    onAgentEvent(e: AgentEvent): void {
      if (e.type === 'turnStart') {
        clearIdleTimer();
        turnActive = true;
        setClickThrough(false);
        applyVisibility();
      } else if (e.type === 'done' || e.type === 'error') {
        turnActive = false;
        startLinger();
      }
    },

    /** L3.1: wake word and PTT both arrive here as a non-idle voice state. */
    onVoiceState(state: VoiceState): void {
      const active = ACTIVE_VOICE.has(state);
      if (active) {
        clearIdleTimer();
        voiceActive = true;
        setClickThrough(false);
        applyVisibility();
      } else if (voiceActive) {
        voiceActive = false;
        startLinger();
      }
    },

    /**
     * A nudge or a ringing alert needs to surface. Stays up (and interactive)
     * until released, since the user has to be able to click its actions.
     */
    setAttention(on: boolean): void {
      attention = on;
      if (on) {
        clearIdleTimer();
        setClickThrough(false);
        applyVisibility();
      } else {
        startLinger();
      }
    },

    /** Re-evaluate after a settings change (orbIdleMode hidden ↔ dot). */
    refresh(): void {
      applyVisibility();
    },

    isClickThrough(): boolean {
      return clickThrough;
    },
    isVisible(): boolean {
      return !win.isDestroyed() && win.isVisible();
    },
    dispose(): void {
      clearIdleTimer();
    },
  };
}

export type OrbController = ReturnType<typeof createOrbController>;
